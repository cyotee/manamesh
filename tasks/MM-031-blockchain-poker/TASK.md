# Task MM-031: Blockchain-Enabled Poker (Ethereum Settlement)

**Repo:** ManaMesh
**Status:** In Progress
**Created:** 2026-01-26
**Dependencies:** MM-022, MM-029
**Worktree:** `feature/blockchain-poker`

---

## Description

Extend the Poker game module (MM-022) with Ethereum wallet authentication, on-chain bet escrow, and smart contract settlement. Players buy in with ETH or ERC-20 tokens, gameplay happens off-chain using the existing mental poker protocol, and results are settled trustlessly on-chain.

This task reuses the core poker logic from MM-022 and adds a blockchain settlement layer.

## Dependencies

- MM-022: Poker Game Module (with Crypto Integration) - provides core game logic
- MM-029: Cryptographic Deck Plugin - provides mental poker primitives

## User Stories

### US-MM-031.1: Wallet Authentication

As a player, I want to connect my Ethereum wallet so that my identity is my Ethereum address.

**Acceptance Criteria:**
- [ ] Support MetaMask and WalletConnect
- [ ] Player identity = Ethereum address
- [ ] Game keys derived from wallet signature (deterministic)
- [ ] Key derivation uses message: `ManaMesh Poker Game Key\nGame ID: {gameId}\nVersion: 1`
- [ ] Same wallet + gameId always produces same game keys
- [ ] Tests cover wallet connection and key derivation

### US-MM-031.2: Buy-In Escrow

As a player, I want my buy-in held in a smart contract so that funds are secure during the game.

**Acceptance Criteria:**
- [ ] PokerTable.sol contract deployed
- [ ] Support ETH and ERC-20 token buy-ins
- [ ] `createGame(buyIn)` creates new game with specified stake
- [ ] `joinGame(gameId)` transfers buy-in to contract escrow
- [ ] Escrowed funds tracked per player per game
- [ ] Cannot withdraw during active game
- [ ] Tests cover escrow deposit and tracking

### US-MM-031.3: Shuffle Commitments On-Chain

As a player, I want shuffle commitments stored on-chain so that disputes can be resolved fairly.

**Acceptance Criteria:**
- [ ] `commitShuffle(gameId, commitment)` stores commitment on-chain
- [ ] Commitment = SHA-256(permutation || nonce)
- [ ] All players must commit before game starts
- [ ] Combined commitment computed and emitted in GameStarted event
- [ ] Commitments immutable once submitted
- [ ] Tests cover commitment storage and verification

### US-MM-031.4: Signed Action Log

As a player, I want all game actions signed by wallets so that there's a verifiable audit trail.

**Acceptance Criteria:**
- [ ] Every game action signed with EIP-712 typed signature
- [ ] Actions include: bet, fold, check, call, raise, reveal, key_release
- [ ] Actions chained via previousHash (tamper-evident)
- [ ] Action sequence numbers prevent replay
- [ ] All players store complete action log
- [ ] Tests cover action signing and verification

### US-MM-031.5: Multi-Signature Settlement (Happy Path)

As a winner, I want instant settlement when all players agree on the result.

**Acceptance Criteria:**
- [ ] GameResult struct: gameId, winner, potAmount, finalStateHash
- [ ] All players sign GameResult after hand completes
- [ ] `submitResultWithConsensus(gameId, result, signatures)` verifies all signatures
- [ ] Contract releases pot to winner instantly
- [ ] Emits GameSettled event
- [ ] Tests cover multi-sig settlement flow

### US-MM-031.6: Optimistic Settlement (Partial Agreement)

As a winner, I want to claim the pot even if some players disconnect.

**Acceptance Criteria:**
- [ ] `submitResult(gameId, result, winnerSignature)` starts challenge period
- [ ] Challenge period = 1 hour (configurable)
- [ ] Other players can co-sign for instant settlement
- [ ] Other players can challenge to trigger dispute resolution
- [ ] `claimPot(gameId)` callable after challenge period with no challenges
- [ ] Tests cover optimistic settlement and timeout

### US-MM-031.7: Dispute Resolution

As a player, I want to challenge fraudulent results and prove the actual winner.

**Acceptance Criteria:**
- [ ] `challengeResult(gameId, disputeProof)` initiates dispute
- [ ] `resolveDispute(gameId, fullGameLog, shuffleReveals)` settles dispute
- [ ] Verification checks:
  - Shuffle reveals match on-chain commitments
  - All action signatures valid
  - Game rules followed
  - Hand ranking correct
- [ ] Actual winner determined, pot released
- [ ] False challenger loses challenge stake (griefing prevention)
- [ ] Tests cover dispute flow

### US-MM-031.8: Key Escrow for Abandonment

As a player, I want threshold key recovery so that disconnected players don't block the game.

**Acceptance Criteria:**
- [ ] Shamir's Secret Sharing for key escrow (K-of-N threshold)
- [ ] Each player distributes key shares to other players during setup
- [ ] Default threshold: N-1 (any N-1 players can reconstruct)
- [ ] Key reconstruction triggered on player timeout
- [ ] Reconstructed keys used for reveals
- [ ] Tests cover threshold reconstruction

### US-MM-031.9: Game Lifecycle Events

As a frontend developer, I want to subscribe to contract events for real-time updates.

**Acceptance Criteria:**
- [ ] Events emitted: GameCreated, PlayerJoined, ShuffleCommitted, GameStarted, ResultSubmitted, ResultChallenged, GameSettled, DisputeResolved
- [ ] Event listener utilities for frontend
- [ ] Event-driven state updates in game UI
- [ ] Tests cover event emission and parsing

## Technical Details

### Contract Architecture

```solidity
contract PokerTable {
    // Game lifecycle
    function createGame(uint256 buyIn) external returns (uint256 gameId);
    function joinGame(uint256 gameId) external payable;
    function commitShuffle(uint256 gameId, bytes32 commitment) external;

    // Settlement
    function submitResultWithConsensus(
        uint256 gameId,
        GameResult calldata result,
        bytes[] calldata signatures
    ) external;

    function submitResult(
        uint256 gameId,
        GameResult calldata result,
        bytes calldata winnerSignature
    ) external;

    function challengeResult(uint256 gameId, bytes calldata disputeProof) external;
    function claimPot(uint256 gameId) external;
    function resolveDispute(
        uint256 gameId,
        bytes calldata fullGameLog,
        bytes32[] calldata shuffleReveals
    ) external;
}
```

### Wallet-Derived Keys

```typescript
async function deriveGameKeys(
  wallet: ethers.Signer,
  gameId: string
): Promise<{ privateKey: string; publicKey: string }> {
  const message = `ManaMesh Poker Game Key\nGame ID: ${gameId}\nVersion: 1`;
  const signature = await wallet.signMessage(message);
  const seed = ethers.keccak256(signature);

  const ec = new elliptic.ec('secp256k1');
  const keyPair = ec.keyFromPrivate(seed.slice(2));

  return {
    privateKey: keyPair.getPrivate('hex'),
    publicKey: keyPair.getPublic('hex')
  };
}
```

### Signed Action Structure

```typescript
interface SignedAction {
  gameId: string;
  actionIndex: number;
  timestamp: number;
  player: string;  // Ethereum address
  action: GameAction;
  previousHash: string;
  signature: string;  // EIP-712
}
```

### Settlement Paths

| Path | Condition | Settlement Time |
|------|-----------|-----------------|
| Consensus | All players sign result | Instant (~1 block) |
| Optimistic | Winner submits, no challenge | 1 hour + 1 block |
| Dispute | Challenge filed | Variable (depends on proof submission) |

### Gas Estimates

| Operation | Gas | Cost @ 30 gwei |
|-----------|-----|----------------|
| Create game | ~100K | ~$0.50 |
| Join game | ~80K | ~$0.40 |
| Commit shuffle | ~50K | ~$0.25 |
| Submit consensus result | ~150K | ~$0.75 |
| Submit optimistic result | ~100K | ~$0.50 |
| Challenge | ~50K | ~$0.25 |
| Claim pot | ~60K | ~$0.30 |
| Resolve dispute | ~500K+ | ~$2.50+ |

## Files to Create

**Smart Contracts:**
- `contracts/PokerTable.sol` - Main settlement contract
- `contracts/interfaces/IPokerTable.sol` - Contract interface
- `contracts/libraries/PokerVerifier.sol` - Game log verification
- `contracts/test/PokerTable.t.sol` - Foundry tests

**Frontend Blockchain Module:**
- `packages/frontend/src/blockchain/wallet/provider.ts` - Ethers provider setup
- `packages/frontend/src/blockchain/wallet/connect.ts` - Wallet connection
- `packages/frontend/src/blockchain/wallet/derive-keys.ts` - Game key derivation
- `packages/frontend/src/blockchain/contracts/PokerTable.ts` - Contract bindings
- `packages/frontend/src/blockchain/contracts/types.ts` - Contract types
- `packages/frontend/src/blockchain/signing/actions.ts` - Sign game actions
- `packages/frontend/src/blockchain/signing/results.ts` - Sign game results
- `packages/frontend/src/blockchain/signing/verify.ts` - Verify signatures
- `packages/frontend/src/blockchain/settlement/submit.ts` - Submit results
- `packages/frontend/src/blockchain/settlement/challenge.ts` - Challenge handling
- `packages/frontend/src/blockchain/settlement/claim.ts` - Claim pot
- `packages/frontend/src/blockchain/events/listener.ts` - Event subscriptions

**Extended Poker Module:**
- `packages/frontend/src/game/modules/poker/blockchain.ts` - Blockchain-enabled poker game
- `packages/frontend/src/game/modules/poker/blockchain.test.ts` - Integration tests

**Modified:**
- `packages/frontend/src/crypto/plugin/crypto-plugin.ts` - Add blockchain config and signed action log

## Inventory Check

Before starting, verify:
- [ ] MM-022 complete (Poker Game Module with crypto)
- [ ] MM-029 complete (CryptoPlugin)
- [ ] Foundry toolchain available for contract development
- [ ] Test network (Sepolia/Anvil) accessible

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] PokerTable.sol deployed and verified on testnet
- [ ] Wallet connection works (MetaMask, WalletConnect)
- [ ] Buy-in escrow deposits and tracks correctly
- [ ] Shuffle commitments stored on-chain
- [ ] All game actions properly signed
- [ ] Multi-sig settlement works (happy path)
- [ ] Optimistic settlement works (timeout path)
- [ ] Dispute resolution works (challenge path)
- [ ] Key escrow and reconstruction works
- [ ] Frontend integrates with contract
- [ ] Gas costs within estimates
- [ ] Tests pass (Solidity + TypeScript)
- [ ] Build succeeds

## Future Enhancements (Out of Scope)

- ZK proof settlement (instant, private)
- L2 deployment (Arbitrum, Optimism, Base)
- Tournament mode with bracket contracts
- Reputation/rating system
- Multi-table support

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
