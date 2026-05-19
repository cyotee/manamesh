# Poker Betting Architecture: Off-Chain Gameplay, On-Chain Settlement

## Overview

Poker betting in ManaMesh uses a hybrid architecture:
- **Gameplay** (betting, pot tracking, hand evaluation) runs off-chain in boardgame.io
- **Chip escrow and settlement** runs on-chain in `GameVault.sol`

This split is necessary because:
1. **Speed**: Poker requires ~30+ betting actions per hand. On-chain = ~100k gas per action + block time = unusable
2. **Cost**: A 6-player hand with 30 bets would cost ~$50+ in gas if every action were on-chain
3. **UX**: Players expect instant feedback. Waiting for block confirmations breaks the game feel
4. **Complexity**: Side pots, pot odds, and hand evaluation are deterministic but complex. No need for expensive on-chain computation.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRE-GAME                                      │
│  Players deposit chips → GameVault.joinGame()                     │
│  Chips locked in escrow per-player                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EACH HAND (off-chain)                        │
│                                                                  │
│  1. Post blinds (boardgame.io flow)                            │
│  2. Betting rounds: check, call, raise, fold, all-in          │
│     - Each action updates G.pot, G.sidePots, G.playerBets        │
│  3. At showdown: evaluate hands, compute deltas                 │
│  4. buildHandResult() → { gameId, handId, players, deltas }     │
│  5. All players sign the HandResult (EIP-712)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SETTLEMENT (on-chain)                         │
│                                                                  │
│  Host/guest calls GameVault.settleHands()                       │
│  → Chips distributed per deltas                                  │
│  → Escrowed balances updated                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WITHDRAWAL (anytime)                         │
│  Players call GameVault.withdraw() to reclaim chips              │
└─────────────────────────────────────────────────────────────────┘
```

## Existing Smart Contract Infrastructure

### ChipToken.sol
- ERC-20 with ETH 1:1 backing
- Users deposit ETH → mint chips
- Withdraw burns chips → return ETH
- ERC-2612 permit for gasless deposits

### ChipTokenFactory.sol
- Deploys per-asset chip tokens via Crane DFPkg
- Each underlying (ETH, USDC, etc.) gets its own chip token
- Factory is owner of all chip tokens (can mint/burn)

### GameVault.sol
Core settlement contract handling:
- **Escrow**: `joinGame()`, `leaveGame()`, `withdraw()`
- **Settlement**: `settleHands()` - batch settle multiple hands with signatures
- **Abandonment**: `claimAbandonment()` - redistribute abandoned stake after timeout
- **Disputes**: `disputeHand()` - challenge settlement via bet chain verification

### SignatureVerifier.sol
EIP-712 typed data signatures for:
- `Bet` - individual betting actions
- `HandResult` - final hand outcome with per-player deltas
- `FoldAuth` - fold authorization for settlement without folded player
- `Abandonment` - abandonment claim with split distribution

## Data Structures

### HandResult (on-chain)
```solidity
struct HandResult {
    bytes32 gameId;        // Unique game identifier
    bytes32 handId;        // Unique hand identifier
    bytes32 finalBetHash;  // Hash of all bets in this hand
    address[] players;     // Players in this hand
    int256[] deltas;      // Net change per player (winners positive)
}
```

### Deltas Example (conservation: sum = 0)

Given players A, B, C with contributions:
- A contributed 100 (winner)
- B contributed 50 (folded pre-flop)
- C contributed 100 (lost at showdown)
- Total pot = 250

Deltas:
- A: +150 (wins pot)
- B: -50 (loses contribution)
- C: -100 (loses contribution)

Sum: +150 - 50 - 100 = 0 ✓

### Bet Chain (for disputes)
```solidity
struct Bet {
    bytes32 handId;
    address bettor;
    uint256 betIndex;
    uint8 action;      // 0=fold, 1=check, 2=call, 3=raise, 4=all-in
    uint256 amount;
    bytes32 previousBetHash;  // Chain linkage
}
```

## Edge Cases

### Fold Mid-Hand
- Player signs `FoldAuth` = authorization to settle without them
- Others call `settleHands()` without that player's signature
- Folded player's chips stay in escrow for the hand

### Abandonment
- If a player goes offline mid-hand
- After `abandonmentTimeout` (10 min default)
- Remaining players call `claimAbandonment()`
- Abandoned player's chips distributed per agreed split

### Disputes
- Any player challenges via `disputeHand()`
- Submits full bet chain (each bet signed by bettor)
- On-chain replays bet chain to detect fraud
- Fraud detected = settlement reversed + penalties

## Implementation Tasks

### Phase 1: Frontend Integration (boardgame.io)

1. **`buildHandResult()` in poker module**
   - Compute per-player deltas at showdown
   - Hash all bets into `finalBetHash`
   - Return signed `HandResult` structure

2. **EIP-712 Signing Integration**
   - Sign `HandResult` and `FoldAuth` with players' wallets
   - Use viem's `signTypedData` or wallet signature

3. **Abandonment Timer UI**
   - Track when a player goes inactive
   - Enable "Claim Abandonment" button after timeout

4. **`settleHands()` caller**
   - Either host or guest can call (guest's call is gasless if host pays)
   - Collect signatures from all players before calling

### Phase 2: Smart Contract Extensions (optional)

1. **Poker-specific bet limits**
   - Add `minBet`, `maxBet`, `rake` parameters to game setup

2. ** tournament mode**
   - Table stakes, rebuy handling, knockout tracking

3. **Ring game enhancements**
   - Session tracking, rake calculation, loyalty rewards

## Betting Actions (boardgame.io moves)

| Move | Description | On-Chain Impact |
|------|-------------|----------------|
| `postBlind` | Post small/big blind | No (off-chain tracking) |
| `check` | Match current bet, no raise | No |
| `call` | Match current bet | No (tracked in G.pot) |
| `raise` | Increase bet above call | No (updates G.bet) |
| `fold` | Surrender hand | Signs FoldAuth if called |
| `allIn` | Bet all remaining chips | Creates side pot if others have more |
| `showdown` | Reveal hands, evaluate | Triggers buildHandResult() |

## Files to Modify

### Frontend
- `src/game/modules/poker/game.ts` - Add `buildHandResult()`, `settleHand()` moves
- `src/game/modules/poker/crypto.ts` - Ensure ZK proofs don't interfere with betting
- `src/game/modules/poker/betting.ts` - Pot/side pot calculation (may already exist)
- `src/game/modules/poker/hands.ts` - Hand evaluation (likely exists)
- `src/components/PokerBoard.tsx` - Add settlement UI, abandonment buttons

### Smart Contracts
- No changes needed for basic betting
- Optional: `PokerVault.sol` for poker-specific extensions

## Security Considerations

1. **Betting actions are off-chain**: Players can sign anything. Signatures are verified on-chain at settlement.
2. **Host is authoritative**: boardgame.io host runs game logic. No on-chain verification of bet validity.
3. **Dispute resolution**: Bet chain submission allows on-chain fraud detection.
4. **ZK proofs** (already implemented): Provide additional cryptographic fairness for hidden cards.

## Open Questions

1. **Who calls `settleHands()`?** Host should call to avoid gas for guests. Need to handle case where host goes offline.
2. **When to settle?** After each hand (simple) or batch multiple hands (cheaper)?
3. **Leave game mid-session?** Players can leave between hands via `leaveGame()`. Chips remain in escrow.
4. **Rebuy/add chips?** Player calls `joinGame()` again to add more chips to escrow.
