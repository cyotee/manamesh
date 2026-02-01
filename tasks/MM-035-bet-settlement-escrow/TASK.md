# Task MM-035: Bet Settlement & Escrow Vault

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-31
**Dependencies:** MM-034
**Worktree:** `feature/bet-settlement-escrow`

---

## Description

Implement a universal game settlement system with chip tokens and escrow vault. Users deposit ETH/ERC-20 to mint chip tokens, lock chips to games, play off-chain with signed bets organized into hands, and batch-settle hands to release winnings. Supports fold authorization (player exits hand gracefully) and abandonment claims (player disconnects mid-hand with timeout).

This task supersedes the poker-specific settlement in MM-031 with a game-agnostic approach.

## Dependencies

- MM-034: Ethereum Wallet Integration - for wallet connection and EIP-712 signing utilities

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CHIP TOKENS                              │
│  User deposits ETH/ERC-20 → Receives Chip tokens (1:1 or rate)  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        GAME ESCROW                               │
│  User locks chips to gameId → chips held until game settles     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OFF-CHAIN GAMEPLAY                          │
│  Hands (atomic) → Bets (signed, chained) → HandResult (signed)  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ON-CHAIN SETTLEMENT                           │
│  Batch HandResults + FoldAuths → Verify sigs → Release chips    │
└─────────────────────────────────────────────────────────────────┘
```

## User Stories

### US-MM-035.1: Chip Token Minting

As a player, I want to deposit ETH to receive chip tokens so that I can use a unified currency across all games.

**Acceptance Criteria:**
- [ ] ChipToken.sol is ERC-20 with ERC-2612 permit support
- [ ] `deposit()` accepts ETH, mints chips 1:1
- [ ] `depositToken(token, amount)` accepts ERC-20, mints chips at configured rate
- [ ] `withdraw(amount)` burns chips, returns ETH
- [ ] Chips are backed by deposited assets in contract
- [ ] Events: Deposited, Withdrawn
- [ ] Tests cover deposit, withdraw, and permit flows

### US-MM-035.2: Game Escrow

As a player, I want to lock chips to a specific game so that my stake is secured for that game session.

**Acceptance Criteria:**
- [ ] `joinGame(gameId, amount)` transfers chips to vault escrow
- [ ] `joinGameWithPermit(gameId, amount, permit)` gasless escrow via permit
- [ ] Escrow tracked: `gameId → player → amount`
- [ ] Cannot withdraw escrowed chips during active game
- [ ] `leaveGame(gameId)` returns chips if game not started or player eliminated
- [ ] Events: PlayerJoined, PlayerLeft
- [ ] Tests cover escrow deposit and tracking

### US-MM-035.3: Signed Bet Chain

As a player, I want my bets signed and chained so that the action history is verifiable.

**Acceptance Criteria:**
- [ ] EIP-712 Bet type: handId, betIndex, action, amount, previousBetHash
- [ ] Each bet references previous bet hash (tamper-evident chain)
- [ ] `signBet()` utility function in frontend
- [ ] `verifyBetChain()` utility validates signature chain
- [ ] Bets shared P2P between players during gameplay
- [ ] Tests cover bet signing and chain verification

### US-MM-035.4: Hand Result Signatures

As a player, I want to sign hand results so that winners can be determined by consensus.

**Acceptance Criteria:**
- [ ] EIP-712 HandResult type: gameId, handId, winner, potAmount, finalBetHash
- [ ] All active players must sign for consensus settlement
- [ ] `signHandResult()` utility function
- [ ] Winner collects all signatures from other players
- [ ] HandResults can be batched for game settlement
- [ ] Tests cover hand result signing and collection

### US-MM-035.5: Fold Authorization

As a player, I want to sign a fold authorization so that I can exit a hand without staying online.

**Acceptance Criteria:**
- [ ] EIP-712 FoldAuth type: handId, foldingPlayer, authorizedSettlers[]
- [ ] Folding player signs FoldAuth, shares with remaining players
- [ ] Remaining players can settle hand WITHOUT folded player's HandResult sig
- [ ] FoldAuth is verifiable on-chain during settlement
- [ ] Tests cover fold flow and settlement without folded player

### US-MM-035.6: Batch Hand Settlement

As a player, I want to submit a batch of signed hands to settle my game winnings.

**Acceptance Criteria:**
- [ ] `settleHands(gameId, hands[], signatures[][], folds[], foldSigs[])`
- [ ] Verifies each HandResult has required signatures (accounting for folds)
- [ ] Calculates net balance changes per player
- [ ] Updates escrow balances (add winnings, subtract losses)
- [ ] Emits HandSettled events for each hand
- [ ] Gas-efficient batch verification
- [ ] Tests cover batch settlement with multiple hands

### US-MM-035.7: Abandonment Claims

As a player, I want to claim an abandoned player's stake after timeout so that games can complete.

**Acceptance Criteria:**
- [ ] EIP-712 Abandonment type: gameId, handId, abandonedPlayer, abandonedAt, splitRecipients[], splitAmounts[]
- [ ] Configurable timeout period (default: 10 minutes)
- [ ] `claimAbandonment(gameId, claim, signatures[])` after timeout
- [ ] Verifies: timeout elapsed, all remaining players signed
- [ ] Distributes abandoned player's current hand pot + remaining escrow
- [ ] Emits PlayerAbandoned, EscrowDistributed events
- [ ] Tests cover timeout and distribution

### US-MM-035.8: Withdraw Settled Chips

As a player, I want to withdraw my chips after game settlement so that I can cash out.

**Acceptance Criteria:**
- [ ] `withdraw(gameId)` releases settled escrow balance
- [ ] Cannot withdraw if hands still pending settlement
- [ ] Can withdraw partial balance (already settled hands)
- [ ] Emits Withdrawn event
- [ ] Tests cover withdraw after full and partial settlement

### US-MM-035.9: Dispute Resolution

As a player, I want to dispute a fraudulent hand result by submitting the bet chain.

**Acceptance Criteria:**
- [ ] `disputeHand(gameId, handId, betChain[], betSigs[])` initiates dispute
- [ ] Contract verifies bet signature chain
- [ ] Determines actual winner from bet history
- [ ] Overrides fraudulent HandResult
- [ ] Dispute stake required (anti-griefing)
- [ ] Loser of dispute forfeits stake
- [ ] Tests cover dispute initiation and resolution

### US-MM-035.10: Frontend Integration

As a frontend developer, I want TypeScript utilities for all signing operations.

**Acceptance Criteria:**
- [ ] `signBet(bet)` → SignedBet
- [ ] `signHandResult(result)` → SignedHandResult
- [ ] `signFoldAuth(auth)` → SignedFoldAuth
- [ ] `signAbandonment(claim)` → SignedAbandonment
- [ ] `verifyBetChain(bets)` → boolean
- [ ] `verifyHandResult(result, signatures)` → boolean
- [ ] Contract bindings with TypeScript types
- [ ] Event listeners for settlement events
- [ ] Tests cover all signing utilities

## Technical Details

### Smart Contracts

```solidity
// ChipToken.sol
contract ChipToken is ERC20, ERC20Permit {
    function deposit() external payable;
    function depositToken(IERC20 token, uint256 amount) external;
    function withdraw(uint256 amount) external;
}

// GameVault.sol
contract GameVault {
    ChipToken public chips;

    // Escrow management
    function joinGame(bytes32 gameId, uint256 amount) external;
    function joinGameWithPermit(bytes32 gameId, uint256 amount, Permit calldata permit) external;
    function leaveGame(bytes32 gameId) external;

    // Settlement
    function settleHands(
        bytes32 gameId,
        HandResult[] calldata hands,
        bytes[][] calldata signatures,
        FoldAuth[] calldata folds,
        bytes[] calldata foldSigs
    ) external;

    // Abandonment
    function claimAbandonment(
        bytes32 gameId,
        Abandonment calldata claim,
        bytes[] calldata signatures
    ) external;

    // Withdrawal
    function withdraw(bytes32 gameId) external;

    // Disputes
    function disputeHand(
        bytes32 gameId,
        bytes32 handId,
        Bet[] calldata betChain,
        bytes[] calldata betSigs
    ) external;
}
```

### EIP-712 Type Definitions

```typescript
const DOMAIN = {
  name: 'ManaMesh',
  version: '1',
  // chainId dynamic
};

const BetType = {
  Bet: [
    { name: 'handId', type: 'bytes32' },
    { name: 'betIndex', type: 'uint256' },
    { name: 'action', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'previousBetHash', type: 'bytes32' },
  ]
};

const HandResultType = {
  HandResult: [
    { name: 'gameId', type: 'bytes32' },
    { name: 'handId', type: 'bytes32' },
    { name: 'winner', type: 'address' },
    { name: 'potAmount', type: 'uint256' },
    { name: 'finalBetHash', type: 'bytes32' },
  ]
};

const FoldAuthType = {
  FoldAuth: [
    { name: 'handId', type: 'bytes32' },
    { name: 'foldingPlayer', type: 'address' },
    { name: 'authorizedSettlers', type: 'address[]' },
  ]
};

const AbandonmentType = {
  Abandonment: [
    { name: 'gameId', type: 'bytes32' },
    { name: 'handId', type: 'bytes32' },
    { name: 'abandonedPlayer', type: 'address' },
    { name: 'abandonedAt', type: 'uint256' },
    { name: 'splitRecipients', type: 'address[]' },
    { name: 'splitAmounts', type: 'uint256[]' },
  ]
};
```

### Settlement Scenarios

| Scenario | Required Signatures | Contract Verification |
|----------|--------------------|-----------------------|
| Normal hand | All N players sign HandResult | Verify N sigs match players |
| Fold mid-hand | FoldAuth + (N-1) HandResult sigs | Verify FoldAuth, then (N-1) sigs |
| Abandonment | (N-1) Abandonment sigs after timeout | Verify timeout + (N-1) sigs |
| Dispute | Challenger submits bet chain | Replay and verify bet sigs |

### Gas Estimates

| Operation | Gas | Cost @ 30 gwei |
|-----------|-----|----------------|
| Join game | ~80K | ~$0.40 |
| Settle 1 hand (2 players) | ~100K | ~$0.50 |
| Settle 10 hands (batch) | ~400K | ~$2.00 |
| Claim abandonment | ~150K | ~$0.75 |
| Dispute hand | ~300K+ | ~$1.50+ |

## Files to Create

**Smart Contracts:**
- `contracts/ChipToken.sol` - ERC-20 chip token with permit
- `contracts/GameVault.sol` - Escrow and settlement logic
- `contracts/libraries/SignatureVerifier.sol` - EIP-712 verification
- `contracts/interfaces/IChipToken.sol` - Token interface
- `contracts/interfaces/IGameVault.sol` - Vault interface
- `contracts/test/ChipToken.t.sol` - Token tests
- `contracts/test/GameVault.t.sol` - Vault tests

**Frontend Settlement Module:**
- `packages/frontend/src/settlement/types.ts` - Bet, HandResult, FoldAuth, Abandonment types
- `packages/frontend/src/settlement/signing/bet.ts` - Bet signing utilities
- `packages/frontend/src/settlement/signing/hand.ts` - HandResult signing
- `packages/frontend/src/settlement/signing/fold.ts` - FoldAuth signing
- `packages/frontend/src/settlement/signing/abandonment.ts` - Abandonment signing
- `packages/frontend/src/settlement/verification.ts` - Signature verification
- `packages/frontend/src/settlement/contracts/ChipToken.ts` - Token bindings
- `packages/frontend/src/settlement/contracts/GameVault.ts` - Vault bindings
- `packages/frontend/src/settlement/hooks/useChips.ts` - Chip balance hook
- `packages/frontend/src/settlement/hooks/useEscrow.ts` - Escrow management hook
- `packages/frontend/src/settlement/hooks/useSettlement.ts` - Settlement hook

**Tests:**
- `packages/frontend/src/settlement/signing/*.test.ts` - Signing tests
- `packages/frontend/src/settlement/verification.test.ts` - Verification tests

## Inventory Check

Before starting, verify:
- [ ] MM-034 Wallet Integration complete
- [ ] Foundry toolchain installed for contract development
- [ ] Test network (Sepolia/Anvil) accessible
- [ ] viem/wagmi available for contract interactions

## Completion Criteria

- [ ] All acceptance criteria met for all 10 user stories
- [ ] ChipToken deployed and verified on testnet
- [ ] GameVault deployed and verified on testnet
- [ ] Deposit → Escrow → Play → Settle → Withdraw flow works end-to-end
- [ ] Fold authorization flow works
- [ ] Abandonment claim flow works with timeout
- [ ] Dispute resolution works
- [ ] All signing utilities work with wallet integration
- [ ] Gas costs within estimates
- [ ] Tests pass (Solidity + TypeScript)
- [ ] Build succeeds

## Future Enhancements (Out of Scope)

- Multi-token chip pools (wrapped BTC, stablecoins)
- L2 deployment (Arbitrum, Base, Optimism)
- ZK proof settlement for disputes
- Tournament bracket contracts
- Reputation/rating system on-chain

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
