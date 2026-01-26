# War Game Module

Classic War card game implementation for ManaMesh with optional **Mental Poker** cryptographic fairness.

## Overview

War is a simple two-player card game where each player flips a card and the higher card wins both. On ties, "war" is triggered with additional cards at stake. The game ends when one player has all 52 cards.

This module provides two implementations:

| Mode | File | Use Case |
|------|------|----------|
| **Standard** | `game.ts` | Local/trusted play, testing |
| **Cryptographic** | `crypto.ts` | P2P play with untrusted opponents |

## Game Rules

1. **Setup**: 52-card deck is shuffled and split evenly (26 cards each)
2. **Flip**: Both players simultaneously reveal their top card
3. **Compare**: Higher rank wins both cards (Ace high)
4. **War**: On ties, each player places 3 cards face-down and 1 face-up; winner takes all
5. **Victory**: First player to collect all 52 cards wins

## Cryptographic War (Mental Poker)

The crypto-enabled version uses **SRA commutative encryption** to ensure neither player can cheat, even without a trusted server.

### Security Guarantees

| Attack | Prevention |
|--------|------------|
| Peek at deck | Cards are doubly encrypted - need both keys |
| See opponent's hand | Collaborative decryption required |
| Stack the deck | Shuffle proofs verify valid permutation |
| Swap cards mid-game | All operations on encrypted blobs |
| Lie about card value | Card ID recovered from curve point lookup |

### Game Phases

```
┌─────────────────────────────────────────────────────────────────┐
│  1. KEY EXCHANGE                                                │
│     Both players generate keypairs and submit public keys       │
│                              ▼                                  │
│  2. ENCRYPTION (sequential)                                     │
│     Player 0 encrypts deck (layers: 0→1)                        │
│     Player 1 re-encrypts deck (layers: 1→2)                     │
│                              ▼                                  │
│  3. SHUFFLE (sequential with proofs)                            │
│     Player 0 shuffles + generates proof                         │
│     Player 1 shuffles + generates proof                         │
│     Cards dealt: 26 encrypted cards each                        │
│                              ▼                                  │
│  4. PLAY LOOP                                                   │
│     ┌─────────────────────────────────────────────┐             │
│     │  FLIP: Move encrypted card to reveal zone  │             │
│     │              ▼                              │             │
│     │  REVEAL: Both decrypt (layers: 2→1→0)      │             │
│     │              ▼                              │             │
│     │  RESOLVE: Compare ranks, winner takes pot  │             │
│     │              ▼                              │             │
│     │  Check game over ──► no ──► continue loop  │             │
│     └─────────────────────────────────────────────┘             │
│                              ▼                                  │
│  5. GAME OVER                                                   │
│     Winner declared (player with 52 cards)                      │
└─────────────────────────────────────────────────────────────────┘
```

### Collaborative Reveal

To reveal a card, **both players must decrypt**:

```
Card encrypted with layers=2

Player 0 decrypts → layers=1 (one layer removed)
Player 1 decrypts → layers=0 (card revealed!)

Neither player can see the card alone.
```

## Randomness and Shuffle Fairness

### Current Implementation

Shuffling uses the browser's **cryptographically secure random number generator**:

```typescript
// shuffle-proof.ts
function generatePermutation(length: number): Permutation {
  const perm = Array.from({ length }, (_, i) => i);

  for (let i = length - 1; i > 0; i--) {
    const randomBytes = new Uint8Array(4);
    crypto.getRandomValues(randomBytes);  // CSPRNG
    const j = /* derive index from randomBytes */ % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  return perm;
}
```

**Properties:**
- Uses `crypto.getRandomValues()` - OS entropy pool
- Fisher-Yates algorithm for uniform distribution
- 24 bits of randomness per swap (16M possibilities)
- No shared seed required - each player shuffles independently

### Why Independent Shuffles Work

Since both players shuffle the encrypted deck:

```
Initial:     [A, B, C, D, ...]     (encrypted)
P0 shuffle:  [C, A, D, B, ...]     (randomized by P0)
P1 shuffle:  [D, B, A, C, ...]     (re-randomized by P1)
```

Even if one player's shuffle is biased or predictable, the other player's shuffle makes the final order unpredictable to both. This is the mathematical foundation of mental poker.

### Shuffle Proofs (Commit-and-Reveal)

Each player commits to their permutation before revealing:

```typescript
// Before shuffle
commitment = SHA-256(permutation || nonce)  // Published

// After game (optional verification)
reveal(permutation, nonce)  // Proves shuffle was valid
```

This prevents a player from claiming they shuffled differently after seeing results.

### VRF Compatibility (Future Enhancement)

The architecture supports replacing the local CSPRNG with a **Verifiable Random Function** oracle like Chainlink VRF:

```typescript
// Hypothetical VRF integration
async function generatePermutationFromVRF(
  length: number,
  vrfRequestId: string
): Promise<{ permutation: Permutation; vrfProof: bytes }> {
  const vrfOutput = await chainlinkVRF.getRandomness(vrfRequestId);
  const permutation = derivePermutation(vrfOutput, length);
  return { permutation, vrfProof: vrfOutput.proof };
}
```

#### VRF Integration Points

| Component | Current | With VRF |
|-----------|---------|----------|
| `generatePermutation()` | `crypto.getRandomValues()` | VRF oracle call |
| Shuffle proof | Hash commitment | VRF proof |
| Verification | Reveal nonce | Verify VRF proof |
| Trust model | Trust opponent's browser | Trust VRF network |

#### When VRF Adds Value

| Scenario | Local CSPRNG | Chainlink VRF |
|----------|--------------|---------------|
| 2-player P2P | ✅ Sufficient | Overkill |
| Tournaments | Players could collude | ✅ Publicly verifiable |
| Spectated games | Trust players' RNG | ✅ Provably fair |
| On-chain games | N/A | ✅ Required |
| Replay verification | Trust committed nonces | ✅ Permanent proof |

#### Integration Approaches

**Option 1: VRF as Shared Seed**
```
1. Both players request VRF randomness
2. seed = hash(vrfOutput0 || vrfOutput1)
3. Derive deterministic permutations from seed
4. Proofs reference VRF request IDs
```

**Option 2: VRF per Shuffle**
```
1. Player requests VRF before shuffle turn
2. VRF output used as permutation source
3. Shuffle proof includes VRF proof
```

**Option 3: On-Chain Shuffle Contract**
```solidity
function submitShuffle(
    uint256 requestId,
    bytes32 vrfProof,
    uint256[] calldata permutation
) external {
    require(VRFCoordinator.verify(requestId, vrfProof), "Invalid VRF");
    require(verifyPermutationFromVRF(vrfOutput, permutation), "Bad perm");
    applyPermutation(permutation);
}
```

#### Trade-offs

| Aspect | Local CSPRNG | Chainlink VRF |
|--------|--------------|---------------|
| Latency | Instant | ~2 blocks (~30s) |
| Cost | Free | ~0.25 LINK/request |
| Trust | Opponent's browser | Chainlink network |
| Verifiability | Post-game reveal | Immediate proof |
| Offline | ✅ Works offline | ❌ Requires network |

## API Reference

### Standard War

```typescript
import { WarGame, WarModule } from './game';

// Create game
const game = WarGame;

// Initial state
const state = WarModule.initialState({ numPlayers: 2, playerIDs: ['0', '1'] });

// Moves
flipCard(G, ctx, playerId);
resolveRound(G, ctx);
```

### Crypto War

```typescript
import { CryptoWarGame, CryptoWarModule } from './crypto';

// Create game
const game = CryptoWarGame;

// Initial state
const state = CryptoWarModule.initialState({ numPlayers: 2, playerIDs: ['0', '1'] });

// Setup moves (in order)
submitPublicKey(G, ctx, playerId, publicKey);
encryptDeck(G, ctx, playerId, privateKey);
await shuffleDeck(G, ctx, playerId, privateKey);

// Play moves
flipCard(G, ctx, playerId);
submitDecryptionShare(G, ctx, playerId, targetPlayerId, privateKey);
resolveRound(G, ctx);

// Verification
const proofs = getShuffleProofs(G);
const isValid = verifyPlayerShuffle(G, playerId);
```

### Types

```typescript
interface CryptoWarState {
  players: Record<string, CryptoWarPlayerState>;
  phase: 'keyExchange' | 'encrypt' | 'shuffle' | 'flip' | 'reveal' | 'resolve' | 'gameOver';
  crypto: CryptoPluginState;
  cardIds: string[];
  pendingReveals: Record<string, Record<string, boolean>>;
  warInProgress: boolean;
  winner: string | null;
}

interface CryptoWarPlayerState {
  deck: WarCard[];
  played: WarCard[];
  won: WarCard[];
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
}
```

## Files

| File | Description |
|------|-------------|
| `index.ts` | Module exports |
| `types.ts` | Type definitions |
| `game.ts` | Standard War implementation |
| `game.test.ts` | Standard War tests |
| `crypto.ts` | Cryptographic War implementation |
| `crypto.test.ts` | Crypto War tests |

## Dependencies

- `boardgame.io` - Game state management
- `../../../crypto` - Mental poker primitives (SRA, shuffle proofs)

## Related Documentation

- [Mental Poker Cryptography](../../../crypto/mental-poker/README.md) (if exists)
- [Crypto Plugin](../../../crypto/plugin/README.md) (if exists)
- [SRA Encryption](../../../crypto/mental-poker/sra.ts) - Implementation details
- [Shuffle Proofs](../../../crypto/mental-poker/shuffle-proof.ts) - Proof generation/verification
