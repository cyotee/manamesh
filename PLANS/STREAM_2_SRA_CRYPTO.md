# Stream 2: SRA Crypto — Detailed Implementation Plan

## Overview

Stream 2 implements cryptographic fairness for One Piece TCG using SRA (Shamir-Rivest-Adleman) commutative encryption — the same mental poker approach used by Poker and Go Fish. The goal is to ensure no player can see cards they shouldn't, manipulate deck order, or cheat during reveals.

**Goal**: Make One Piece TCG cryptographically fair — deck shuffle is verifiable, card reveals require cooperation, and abandonment is recoverable via key escrow.

---

## Current State (After Stream 1b)

The game has placeholder crypto phases:

```
setup → keyExchange → encrypt → shuffle → play → gameOver
```

- `keyExchange`, `encrypt`, `shuffle` phases exist with stub moves (`advanceToEncrypt`, `advanceToShuffle`)
- The deck is stored in plaintext — `player.mainDeck` is a plain `OnePieceCard[]`
- `shuffle.onEnd` deals starting hands from the plaintext deck
- No SRA encryption, no key escrow, no commit-reveal shuffle

---

## Security Model

### SRA Commutative Encryption

SRA allows multiple players to encrypt data in sequence, and decryption works in reverse order:

```
Initial deck:    [card₀, card₁, ..., cardₙ]
Player 0 encrypts: E₀(cardₙ) for all n
Player 1 encrypts: E₁(E₀(cardₙ)) for all n

To reveal: Player 1 decrypts first → D₁(E₁(E₀(cardₙ))) = E₀(cardₙ)
            Player 0 decrypts second → D₀(E₀(cardₙ)) = cardₙ
```

**Key property**: Players who encrypt first decrypt last, and vice versa. The final decryption layer belongs to the card owner, so only they can see the plaintext.

### Why DON!! Cards Don't Need Encryption

DON!! cards are **generic resources** — all DON!! are identical and have no hidden information. Unlike poker chips or go fish cards, a DON!! card's identity doesn't matter. Only the **count** matters. So:

- DON!! deck is NOT encrypted
- DON!! are tracked by count in `player.donDeck` / `player.donArea` / `player.activeDon`

### One Piece Deck Structure (What Gets Encrypted)

| Zone       | Cards                             | Encrypted? | Notes                                                                       |
| ---------- | --------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `mainDeck` | 50-60 character/event/stage cards | ✅ YES     | Encrypted blob, order unknown                                               |
| `lifeDeck` | Leader's life cards               | ✅ YES     | Encrypted blob; cooperative decrypt on damage; face-up powers bypass damage |
| `leader`   | The leader card                   | ❌ NO      | Public knowledge, revealed at game start                                    |
| `hand`     | Current hand                      | ✅ YES     | Encrypted zone, owner-only peek                                             |
| `playArea` | Played cards                      | ❌ NO      | Public once played                                                          |
| `trash`    | Discarded cards                   | ❌ NO      | Public knowledge                                                            |
| `donDeck`  | DON!! resource cards              | ❌ NO      | Generic, tracked by count                                                   |

**Life deck face-up mechanic**: Some cards/powers let a player turn a life card face-up without doing damage. This requires a `revealLifeCard` operation that cooperatively decrypts a specific life card and marks it "face-up" without triggering the damage flow. Face-up life cards remain visible to both players.

### Encrypted Zones

Unlike poker where cards have a single `EncryptedCard` type, One Piece TCG has distinct zones:

- `mainDeck: EncryptedCard[]` — the encrypted draw pile
- `hand:{playerId}: EncryptedCard[]` — each player's private hand
- `lifeDeck:{playerId}: EncryptedCard[]` — each player's encrypted life deck; cards are cooperatively decrypted on damage OR via face-up powers

For encrypted zones, we track:

```typescript
interface EncryptedZone {
  cards: EncryptedCard[];
  encryptedBy: string[]; // playerIds in order of encryption
}
```

---

## Key Cryptographic Decisions

### 1. Deck Size and Card Representation

One Piece TCG decks are 50-60 cards. The SRA mental poker works on curve points, so each card is represented as a `bn.js` number on the secp256k1 curve.

**Process for a 51-card One Piece deck (leader + 50 deck cards)**:

1. Map each card to a unique curve point using `buildCardPointLookup(cards)`
2. Encrypt the array of curve points
3. Each encrypted card has N layers (N = number of players who have encrypted)

### 2. Commit-Reveal Shuffle Seed (Same as Go Fish)

The shuffle phase uses a commit-reveal protocol to prevent one player from controlling the deck order:

```
Phase 1 (commit): Each player computes seed₁ = randomHex(32), commits = SHA256(seed₁)
Phase 2 (reveal): Each player reveals seed₁, all verify SHA256(seed₁) == commit
Phase 3 (finalize): finalSeed = SHA256(all seeds), deck shuffled with Fisher-Yates using finalSeed
```

This is identical to the Go Fish implementation. Reference: `gofish/crypto.ts` lines 161-175 (`maybeFinalizeShuffleSeed`), 482-541 (`commitShuffleSeed`/`revealShuffleSeed`).

### 3. Life Deck Revelation

The life deck is **encrypted** like the main deck. When a player takes life damage (`takeLifeDamage`), the top card of their life deck requires **cooperative decryption** — the opponent provides their decryption layer first, then the owner removes their layer to see the card.

**Two ways to reveal a life card**:

1. **Life damage** (`takeLifeDamage`): Top card is decrypted and moved to the owner's hand. This is the normal damage flow.
2. **Face-up power** (`revealLifeCard`): A card effect allows turning a life card face-up without doing damage. The card stays in the life zone but becomes visible to both players. This also requires cooperative decryption but does NOT move the card.

Both paths require the opponent to submit their decryption layer first, then the owner decrypts the final layer.

### 4. Starting Hand Dealing

After the shuffle phase ends and before `play` begins:

1. Each player is dealt `config.startingHand` (5) cards into their hand zone
2. This is done by the **last shuffler** moving cards from `mainDeck` to `hand:{playerId}`
3. Cards are dealt one at a time in player order
4. Each deal is a cooperative decrypt — opponent removes their layer, then owner removes theirs

---

## Implementation Steps

### Step 1: Create `onepiece/crypto.ts` — File Structure and Types

Create a new file `src/game/modules/onepiece/crypto.ts` modeled on `poker/crypto.ts`. The file should export a `OnePieceCryptoGame` object similar to `CryptoPokerGame`.

**File layout**:

```typescript
// Imports (same as poker/crypto.ts)
import type { Game, Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";
import type { GameConfig } from "../types";
import type { OnePieceState, OnePieceCard, OnePieceDonCard, ... } from "./types";
import { CryptoPlugin } from "../../../crypto/plugin/crypto-plugin";
import {
  generateKeyPair,
  decrypt,
  encryptDeck as encryptDeckCrypto,
  reencryptDeck,
  quickShuffle,
  buildCardPointLookup,
  type EncryptedCard,
} from "../../../crypto/mental-poker";
import {
  createKeyShares,
  reconstructKeyFromShares,
  type KeyShare,
} from "../../../crypto/shamirs";
import { sha256Hex, stableStringify } from "../../../crypto";

// =============================================================================
// Constants
// =============================================================================

const MAIN_DECK_ZONE = "mainDeck";

// =============================================================================
// State Helpers
// =============================================================================

export function getCurrentSetupPlayer(state: OnePieceCryptoState): string { ... }
export function advanceSetupPlayer(state: OnePieceCryptoState): boolean { ... }
export function resetSetupPlayer(state: OnePieceCryptoState): void { ... }

// =============================================================================
// Initial State
// =============================================================================

export function createCryptoInitialState(config: GameConfig): OnePieceCryptoState { ... }

// =============================================================================
// Setup Phase Moves (keyExchange, keyEscrow, encrypt, shuffle)
// =============================================================================

function submitPublicKey(G, ctx, playerId, publicKey): OnePieceCryptoState | typeof INVALID_MOVE { ... }
function distributeKeyShares(G, ctx, playerId, privateKey, shares): ... { ... }
function encryptDeck(G, ctx, playerId, privateKey): ... { ... }
function commitShuffleSeed(G, ctx, playerId, commitHashHex, callerId?): ... { ... }
function revealShuffleSeed(G, ctx, playerId, seedHex, callerId?): ... { ... }
function shuffleEncryptedDeck(G, ctx, playerId, events?): ... { ... }
function voteAbortShuffle(G, ctx, playerId): ... { ... }

// =============================================================================
// Card Revelation (cooperative decryption)
// =============================================================================

function submitDecryptionShare(G, ctx, playerId, requestId, decryptionShare): ... { ... }
function finalizeDecrypt(G, ctx, requestId): ... { ... }

// =============================================================================
// Game Over
// =============================================================================

function releaseKey(G, ctx, playerId): ... { ... }

// =============================================================================
// Export
// =============================================================================

export const OnePieceCryptoGame: Game<OnePieceCryptoState> = {
  name: "onepiece-crypto",
  setup: createCryptoInitialState,
  // ... phases and moves
};
```

### Step 2: Define `OnePieceCryptoState` in `types.ts`

Add new types for the crypto variant. The crypto state extends `OnePieceState` with encrypted zones and crypto metadata:

```typescript
// =============================================================================
// Crypto Variant Types
// =============================================================================

/**
 * Extended state for the cryptographically fair variant.
 * Replaces plaintext decks with encrypted blobs.
 */
export interface OnePieceCryptoState extends Omit<
  OnePieceState,
  "players" | "cardVisibility" | "zones"
> {
  // Override player state to use encrypted zones
  players: Record<string, OnePieceCryptoPlayerState>;

  // Encrypted zones — replaces plaintext deck arrays
  encryptedZones: Record<string, EncryptedCard[]>;

  // Crypto plugin state
  crypto: CryptoPluginState;

  // Commit-reveal shuffle state
  shuffleRng: ShuffleRngState | null;

  // Key escrow for abandonment recovery
  keyEscrowShares: Record<string, KeyShare[]>;
  escrowThreshold: number;

  // Pending decryption requests
  pendingDecryptRequests: DecryptRequest[];

  // Setup player index (for sequential encryption/shuffle)
  setupPlayerIndex: number;

  // Player order
  playerOrder: string[];
}

/**
 * Per-player state in the crypto variant.
 */
export interface OnePieceCryptoPlayerState {
  // Public key for SRA encryption
  publicKey: string | null;

  // Key escrow
  hasDistributedShares: boolean;
  hasReleasedKey: boolean;

  // Encryption/shuffle tracking
  hasEncrypted: boolean;
  hasShuffled: boolean;

  // Connection status for abandonment
  isConnected: boolean;
  lastHeartbeat: number;
}

/**
 * Shuffle RNG state for commit-reveal seed protocol.
 */
export interface ShuffleRngState {
  phase: "commit" | "reveal" | "ready";
  commits: Record<string, string>; // playerId -> SHA256(seedHex)
  reveals: Record<string, string>; // playerId -> seedHex
  finalSeedHex: string | null;
  abortVotes: Record<string, boolean>;
}

/**
 * A request to decrypt a card (e.g., life damage reveal).
 */
export interface DecryptRequest {
  id: string;
  playerId: string; // who needs the reveal
  zoneId: string; // which encrypted zone
  cardIndex: number; // which card in the zone
  requestedBy: string; // who requested the decrypt
  requiredLayers: string[]; // playerIds who must decrypt (in order)
  currentLayer: number; // how many layers have been removed
  status: "pending" | "partial" | "complete";
}
```

### Step 3: Implement `createCryptoInitialState`

This is similar to `poker/crypto.ts` lines 168-280, but adapted for One Piece:

```typescript
export function createCryptoInitialState(
  config: GameConfig,
): OnePieceCryptoState {
  const playerOrder = [...config.playerIDs];

  // Initialize crypto state
  const cryptoState: CryptoPluginState = {
    phase: "init",
    publicKeys: {},
    commitments: {},
    shuffleProofs: {},
    encryptedZones: {},
    cardPointLookup: {},
    revealedCards: {},
    pendingReveals: {},
  };

  // Initialize encrypted main deck (empty until encryption phase)
  cryptoState.encryptedZones[MAIN_DECK_ZONE] = [];

  const state: OnePieceCryptoState = {
    phase: "keyExchange", // Start directly in keyExchange (deck loading done in setup phase)
    players: {},
    encryptedZones: { [MAIN_DECK_ZONE]: [] },
    crypto: cryptoState,
    shuffleRng: null,
    keyEscrowShares: {},
    escrowThreshold: Math.max(2, playerOrder.length - 1),
    pendingDecryptRequests: [],
    setupPlayerIndex: 0,
    playerOrder,
    // Carry over non-crypto state
    config: DEFAULT_CONFIG,
    winner: null,
    turnCount: 0,
    deckLoaded: {}, // Already set by setup phase
    leaderLife: {}, // Set from leader cards
    activePeeks: [],
    proofChain: [],
  };

  // Initialize per-player state
  for (const playerId of playerOrder) {
    state.players[playerId] = {
      // Plaintext zones that don't need encryption
      lifeDeck: [],
      donDeck: [],
      donArea: [],
      hand: [], // Will be encrypted zone
      trash: [],
      playArea: [],
      activeDon: 0,
      totalDon: 0,
      // Crypto-specific
      publicKey: null,
      hasDistributedShares: false,
      hasReleasedKey: false,
      hasEncrypted: false,
      hasShuffled: false,
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
    // Set leader life from leader card (set by setup phase via loadDeck)
    state.leaderLife[playerId] = state.deckLoaded[playerId]?.leader?.life ?? 5;
    // Encrypted hand zone per player
    state.encryptedZones[`hand:${playerId}`] = [];
  }

  return state;
}
```

**Note**: The setup phase (with `loadDeck`) runs BEFORE the crypto phases. `loadDeck` already stores the leader card's life value. The crypto phase starts with `keyExchange` after both players have loaded decks.

### Step 4: Implement Key Exchange (`submitPublicKey`)

Modeled on `poker/crypto.ts` lines 289-327:

```typescript
function submitPublicKey(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  publicKey: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "keyExchange") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (G.players[playerId].publicKey) return INVALID_MOVE; // Already submitted

  G.players[playerId].publicKey = publicKey;
  G.crypto.publicKeys[playerId] = publicKey;

  // Build card point lookup for all main deck cards
  // (decks already loaded from setup phase, stored in encryptedZones as cardIds)
  const allCardIds: string[] = [];
  for (const playerId of G.playerOrder) {
    const player = G.players[playerId];
    // Main deck cards were stored as cardIds during loadDeck
    // We need to retrieve them - this requires modifying loadDeck to also
    // track the cardIds in a temporary zone for crypto use
    const deckCardIds = G.encryptedZones[`deck:${playerId}`] || [];
    allCardIds.push(...deckCardIds.map((c) => c.id));
  }

  // Check if all players have submitted
  const allSubmitted = G.playerOrder.every(
    (pid) => G.players[pid].publicKey !== null,
  );
  if (allSubmitted) {
    G.phase = "keyEscrow";
    resetSetupPlayer(G);
  }

  return G;
}
```

**Open Question**: `loadDeck` currently stores full `OnePieceCard[]` in `player.mainDeck`. For crypto mode, we need to:

- Option A: Store cardIds separately and keep cards encrypted
- Option B: Modify `loadDeck` to work in two modes (plaintext for non-crypto, cardIds for crypto)

**Decision needed**: Modify `loadDeck` to also store `cardIds` in a `deckCardIds` field on `OnePieceState` that the crypto variant uses.

### Step 5: Implement Key Escrow (`distributeKeyShares`)

Modeled on `poker/crypto.ts` lines 329-370. Uses Shamir's Secret Sharing to split each player's private key into shares distributed to other players.

```typescript
function distributeKeyShares(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  shares: KeyShare[],
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "keyEscrow") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (G.players[playerId].hasDistributedShares) return INVALID_MOVE;

  // Store encrypted shares for abandonment recovery
  const encryptedShares: KeyShare[] = shares.map((ks) => {
    const recipientPublicKey = G.crypto.publicKeys[ks.forPlayer];
    if (!recipientPublicKey) return ks;
    try {
      const encryptedValue = encryptShare(ks.share.value, recipientPublicKey);
      return { ...ks, encryptedShare: encryptedValue };
    } catch {
      return ks;
    }
  });

  G.keyEscrowShares[playerId] = encryptedShares;
  G.players[playerId].hasDistributedShares = true;

  // Check if all players have distributed
  const allDistributed = G.playerOrder.every(
    (pid) => G.players[pid].hasDistributedShares,
  );
  if (allDistributed) {
    G.phase = "encrypt";
    resetSetupPlayer(G);
  }

  return G;
}
```

### Step 6: Implement Deck Encryption (`encryptDeck`)

Modeled on `poker/crypto.ts` lines 372-444. Sequential SRA encryption of the main deck.

**Important**: Only the main deck gets encrypted. Life deck, DON!! deck, leader card, and play area are NOT encrypted (they don't contain hidden information).

```typescript
function encryptDeck(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasEncrypted) return INVALID_MOVE;

  const existingDeck = G.encryptedZones[MAIN_DECK_ZONE];

  if (!existingDeck || existingDeck.length === 0) {
    // First player: encrypt all card IDs from deckCardIds
    const cardIds = G.deckCardIds[playerId]; // set by loadDeck
    if (!cardIds || cardIds.length === 0) return INVALID_MOVE;

    const encryptedDeck = encryptDeckCrypto(cardIds, privateKey);
    G.encryptedZones[MAIN_DECK_ZONE] = encryptedDeck;
    console.log(
      `[OnePieceCrypto] Player ${playerId} encrypted ${cardIds.length} cards`,
    );
  } else {
    // Subsequent players: re-encrypt the already encrypted deck
    const reencryptedDeck = reencryptDeck(existingDeck, privateKey);
    G.encryptedZones[MAIN_DECK_ZONE] = reencryptedDeck;
    console.log(`[OnePieceCrypto] Player ${playerId} re-encrypted deck`);
  }

  G.crypto.phase = "encrypt";
  player.hasEncrypted = true;

  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
    resetSetupPlayer(G);
    // Initialize shuffle RNG
    G.shuffleRng = {
      phase: "commit",
      commits: {},
      reveals: {},
      finalSeedHex: null,
      abortVotes: {},
    };
  }

  return G;
}
```

### Step 7: Implement Commit-Reveal Shuffle Seed

Modeled on `gofish/crypto.ts` lines 482-541. Three sub-phases within `shuffle` phase:

**Sub-phase 1 — Commit**:

```typescript
function commitShuffleSeed(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  commitHashHex: string,
  callerId?: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.shuffleRng) G.shuffleRng = initShuffleRng(G);
  const rng = G.shuffleRng;

  if (rng.phase !== "commit") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (!isHex(commitHashHex) || commitHashHex.length !== 64) return INVALID_MOVE;

  rng.commits[playerId] = commitHashHex;

  const allCommitted = G.playerOrder.every(
    (pid) =>
      typeof rng.commits[pid] === "string" && rng.commits[pid].length === 64,
  );
  if (allCommitted) rng.phase = "reveal";

  return G;
}
```

**Sub-phase 2 — Reveal**:

```typescript
function revealShuffleSeed(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  seedHex: string,
  callerId?: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.shuffleRng) return INVALID_MOVE;
  const rng = G.shuffleRng;

  if (rng.phase !== "reveal") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (!isHex(seedHex) || seedHex.length < 16) return INVALID_MOVE;

  // Verify commitment
  const commit = rng.commits[playerId];
  if (!commit) return INVALID_MOVE;
  const computed = sha256Hex(new TextEncoder().encode(seedHex.toLowerCase()));
  if (computed !== commit.toLowerCase()) return INVALID_MOVE;

  rng.reveals[playerId] = seedHex.toLowerCase();

  // Check if all revealed
  const allRevealed = G.playerOrder.every(
    (pid) =>
      typeof rng.reveals[pid] === "string" && rng.reveals[pid].length > 0,
  );
  if (allRevealed) {
    // Finalize seed: SHA256 of all seeds
    const seeds = G.playerOrder.map((pid) => rng.reveals[pid]);
    const bytes = new TextEncoder().encode(stableStringify({ seeds }));
    rng.finalSeedHex = sha256Hex(bytes);
    rng.phase = "ready";
  }

  return G;
}
```

### Step 8: Implement Deterministic Shuffle (`shuffleEncryptedDeck`)

Modeled on `gofish/crypto.ts` lines 817-839. Uses the finalized seed for a deterministic Fisher-Yates shuffle:

```typescript
function shuffleEncryptedDeck(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  events?: { endPhase?: () => void },
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasShuffled) return INVALID_MOVE;

  const encryptedDeck = G.encryptedZones[MAIN_DECK_ZONE];
  if (!encryptedDeck || encryptedDeck.length === 0) return INVALID_MOVE;

  if (!G.shuffleRng?.finalSeedHex) return INVALID_MOVE; // Must complete commit-reveal first

  // Deterministic Fisher-Yates using per-player seed
  const playerSeed = sha256Hex(
    new TextEncoder().encode(`${G.shuffleRng.finalSeedHex}:${playerId}`),
  );
  G.encryptedZones[MAIN_DECK_ZONE] = deterministicShuffle(
    encryptedDeck,
    playerSeed,
  );
  player.hasShuffled = true;
  G.crypto.phase = "shuffle";

  if (advanceSetupPlayer(G)) {
    // All players have shuffled — deal starting hands and transition to play
    G.crypto.phase = "ready";
    dealStartingHands(G);
    G.phase = "play";

    const isInSetupPhase = ctx.phase === "setup";
    if (isInSetupPhase && events?.endPhase) {
      events.endPhase();
    }
  }

  return G;
}
```

### Step 9: Implement `dealStartingHands`

After all shuffles complete, deal 5 cards to each player's hand zone:

```typescript
function dealStartingHands(G: OnePieceCryptoState): void {
  const deck = G.encryptedZones[MAIN_DECK_ZONE];
  if (!deck || deck.length === 0) return;

  for (let i = 0; i < G.config.startingHand; i++) {
    for (const playerId of G.playerOrder) {
      const card = deck.shift();
      if (!card) break;

      const handZone = `hand:${playerId}`;
      if (!G.encryptedZones[handZone]) {
        G.encryptedZones[handZone] = [];
      }
      G.encryptedZones[handZone].push(card);
    }
  }

  G.encryptedZones[MAIN_DECK_ZONE] = deck;
}
```

### Step 10: Implement Cooperative Decryption (Life Damage + Face-Up Powers)

The life deck is **encrypted** — revealing any life card requires cooperative decryption. There are two distinct reveal paths:

**Path A — Life Damage (`takeLifeDamage`)**:

1. Player calls `takeLifeDamage`
2. System creates a `DecryptRequest` for the top life deck card
3. Opponent provides their decryption layer via `submitDecryptionShare`
4. Owner provides their decryption layer via `submitDecryptionShare`
5. Card plaintext revealed to owner → card moves to owner's hand

**Path B — Face-Up Power (`revealLifeCard`)**:

1. Player activates a card effect that turns a life card face-up (no damage)
2. System creates a `DecryptRequest` for a specific life deck card (not necessarily top)
3. Opponent provides their decryption layer via `submitDecryptionShare`
4. Owner provides their decryption layer via `submitDecryptionShare`
5. Card plaintext revealed to both players → card stays in life zone as "face-up"

```typescript
// In crypto.ts — Submit a decryption layer
function submitDecryptionShare(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  requestId: string,
  decryptionShare: string, // The decrypted layer from this player
): OnePieceCryptoState | typeof INVALID_MOVE {
  const request = G.pendingDecryptRequests.find((r) => r.id === requestId);
  if (!request) return INVALID_MOVE;
  if (request.status === "complete") return INVALID_MOVE;

  const expectedLayer = request.requiredLayers[request.currentLayer];
  if (playerId !== expectedLayer) return INVALID_MOVE; // Wrong order

  request.currentLayer++;
  if (request.currentLayer >= request.requiredLayers.length) {
    request.status = "complete";
    // Final decryption gives the plaintext
    // Path A: move card to owner's hand
    // Path B: mark card as face-up in life zone
  } else {
    request.status = "partial";
  }

  return G;
}

// Separate reveal for face-up powers (no damage)
function revealLifeCard(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  cardIndex: number, // Which life card to turn face-up
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;

  // Create a decrypt request for the specified life card
  const request: DecryptRequest = {
    id: `life-reveal-${Date.now()}`,
    playerId,
    zoneId: `lifeDeck:${playerId}`,
    cardIndex,
    requestedBy: playerId,
    requiredLayers: G.playerOrder.filter((pid) => pid !== playerId), // Opponent decrypts first
    currentLayer: 0,
    status: "pending",
    purpose: "face-up", // Distinguishes from damage
  };

  G.pendingDecryptRequests.push(request);
  return G;
}
```

**Note**: The `DecryptRequest` type needs a `purpose: "damage" | "face-up"` field to distinguish the two flows.

### Step 11: Update `game.ts` — Wire Crypto Phases

Replace the placeholder stub moves with calls to `crypto.ts` functions. In `game.ts`:

**keyExchange phase**:

```typescript
keyExchange: {
  next: "encrypt",
  moves: {
    submitPublicKey: {
      move: ({ G, ctx }, playerId, publicKey) =>
        submitPublicKey(G, ctx, playerId, publicKey),
      client: false,
    },
  },
},
```

**encrypt phase**:

```typescript
encrypt: {
  next: "shuffle",
  moves: {
    distributeKeyShares: {
      move: ({ G, ctx }, playerId, privateKey, shares) =>
        distributeKeyShares(G, ctx, playerId, privateKey, shares),
      client: false,
    },
    encryptDeck: {
      move: ({ G, ctx }, playerId, privateKey) =>
        encryptDeck(G, ctx, playerId, privateKey),
      client: false,
    },
  },
},
```

**shuffle phase**:

```typescript
shuffle: {
  next: "play",
  moves: {
    commitShuffleSeed: {
      move: ({ G, ctx }, playerId, commitHashHex, callerId?) =>
        commitShuffleSeed(G, ctx, playerId, commitHashHex, callerId),
      client: false,
    },
    revealShuffleSeed: {
      move: ({ G, ctx }, playerId, seedHex, callerId?) =>
        revealShuffleSeed(G, ctx, playerId, seedHex, callerId),
      client: false,
    },
    shuffleEncryptedDeck: {
      move: ({ G, ctx, events }, playerId) =>
        shuffleEncryptedDeck(G, ctx, playerId, events),
      client: false,
    },
    voteAbortShuffle: {
      move: ({ G, ctx }, playerId) =>
        voteAbortShuffle(G, ctx, playerId),
      client: false,
    },
  },
  onEnd: ({ G }) => {
    // If we reach here without going through all shufflers, something went wrong
    // This should be handled by shuffleEncryptedDeck advancing the phase
  },
},
```

### Step 12: Update `loadDeck` to Support Crypto Mode

The current `loadDeck` stores `OnePieceCard[]` in `player.mainDeck`. For crypto mode, we need to extract just the card IDs and store them separately:

```typescript
// Add to loadDeck in game.ts:
// After extracting deck cards:
G.deckCardIds = G.deckCardIds || {};
G.deckCardIds[playerId] = mainDeckCards.map((c) => c.id);
```

The actual `OnePieceCard` objects are not needed for crypto mode — only the card IDs for encryption. The full card data can be looked up from the card database using the IDs.

### Step 13: Update `types.ts` — Add `deckCardIds` and Crypto Types

```typescript
// In OnePieceState:
export interface OnePieceState {
  // ... existing fields ...

  /** Card IDs for crypto mode (extracted from loaded decks) */
  deckCardIds?: Record<string, string[]>;
}
```

### Step 13 (NEW): Update Peek Protocol for Encrypted Zones

The existing `requestPeek`/`ackPeek`/`decryptPeek` moves were designed for plaintext zones. They need to be updated to work with encrypted hand zones.

**In non-crypto mode**: Peek shows a card's actual data (the card is already plaintext).

**In crypto mode**: Peek must cooperatively decrypt the card before revealing it. The flow is:

1. `requestPeek`: Player requests to peek at their own hand (no decryption needed — owner can self-decrypt)
2. `ackPeek`: Opponent acknowledges and provides decryption share (for opponent's hand only)
3. `decryptPeek`: Owner applies final decryption layer
4. `reorderPeek`: Optional reordering of peeked cards

For **self-peek** (looking at your own hand):

- Only the owner's decryption is needed
- Opponent cannot see the peeked card
- No `ackPeek` step required

For **opponent peek** (if allowed by game rules):

- Cooperative decryption required
- Both players see the final card

**Updates to moves**:

```typescript
// In crypto.ts — Update peek to work with encrypted hand zones
function requestPeek(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  cardIndex: number,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;

  // Check if this is a self-peek (own hand) or opponent peek
  // For self-peek: create a self-decrypt request
  // For opponent peek: create a cooperative decrypt request

  // In encrypted mode, hand is in encryptedZones[`hand:${playerId}`]
  const handZone = `hand:${playerId}`;
  const encryptedHand = G.encryptedZones[handZone];
  if (!encryptedHand || cardIndex >= encryptedHand.length) return INVALID_MOVE;

  // Create a peek request
  const request: DeckPeekRequest = {
    id: `peek-${Date.now()}`,
    playerId,
    zoneId: handZone,
    cardIndex,
    requestProof: "", // Placeholder for crypto proof
    timestamp: Date.now(),
  };

  // Self-peek doesn't need opponent cooperation
  G.activePeeks.push({ ... });
  return G;
}
```

### Step 14: Create `onepiece/crypto.test.ts`

Test the crypto flow:

```typescript
describe("OnePieceCryptoGame", () => {
  describe("keyExchange phase", () => {
    it("should advance to keyEscrow when all players submit public keys", () => {
      // Generate key pairs, submit public keys, verify phase advance
    });
  });

  describe("keyEscrow phase", () => {
    it("should advance to encrypt when all players distribute key shares", () => {
      // Distribute Shamir shares, verify phase advance
    });
  });

  describe("encrypt phase", () => {
    it("should encrypt deck with SRA commutative encryption", () => {
      // Each player encrypts in sequence, verify layers increase
    });
  });

  describe("shuffle phase", () => {
    it("should require all players to commit shuffle seeds", () => {
      // Commit phase: verify all commits needed
    });
    it("should require all players to reveal seeds after commit", () => {
      // Reveal phase: verify seed verification
    });
    it("should produce deterministic shuffle with final seed", () => {
      // All reveal → final seed → deterministic shuffle
    });
  });

  describe("life damage with crypto", () => {
    it("should require cooperative decryption to reveal life card", () => {
      // takeLifeDamage → decrypt request → opponent share → owner decrypt
    });
  });
});
```

### Step 15: Update Registry — Add `getCryptoGame`

Add to the registry in `src/game/registry.ts`:

```typescript
import { OnePieceCryptoGame } from "./modules/onepiece/crypto";
import { OnePieceCryptoState } from "./modules/onepiece/types";

// In registry entries for OnePiece:
getCryptoGame: () => OnePieceCryptoGame,
```

---

## File Changes

| File                                       | Changes                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `src/game/modules/onepiece/crypto.ts`      | **NEW** — SRA mental poker game module                                              |
| `src/game/modules/onepiece/types.ts`       | Add `OnePieceCryptoState`, `ShuffleRngState`, `DecryptRequest`, `deckCardIds` field |
| `src/game/modules/onepiece/game.ts`        | Replace placeholder moves with crypto moves, update `loadDeck` to extract cardIds   |
| `src/game/modules/onepiece/crypto.test.ts` | **NEW** — crypto flow tests                                                         |
| `src/game/registry.ts`                     | Add `getCryptoGame` for OnePiece                                                    |

---

## Reference Files

| File                                 | Purpose                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| `src/game/modules/poker/crypto.ts`   | Primary reference for SRA mental poker                               |
| `src/game/modules/gofish/crypto.ts`  | Commit-reveal shuffle seed pattern (lines 161-175, 482-541, 817-839) |
| `src/crypto/mental-poker/index.ts`   | SRA primitives: `encryptDeckCrypto`, `reencryptDeck`, `decrypt`      |
| `src/crypto/shamirs/index.ts`        | Shamir SSS: `createKeyShares`, `reconstructKeyFromShares`            |
| `src/crypto/plugin/crypto-plugin.ts` | `CryptoPluginState` type                                             |
| `src/crypto/index.ts`                | `sha256Hex`, `stableStringify`                                       |

---

## Open Questions (RESOLVED)

1. ~~**Life deck encryption**:~~ ✅ **RESOLVED — Life deck IS encrypted.** Both life damage and face-up power effects require cooperative decryption. Face-up cards remain visible but stay in the life zone.

2. **DON!! card generation**: DON!! cards are created at game start. Should they be pre-generated and stored, or generated on-demand? Currently they're created as generic `{id, name: "DON!!", cardType: "don"}` objects. No encryption needed. _(No decision needed — DON!! is not encrypted, defer to Stream 3 if needed.)_

3. ~~**`loadDeck` dual mode**:~~ ✅ **RESOLVED — Add `deckCardIds` field.** `loadDeck` continues storing full `OnePieceCard[]` in `mainDeck` (for non-crypto), and also extracts cardIds into a new `deckCardIds` field for crypto use.

4. ~~**Peek protocol compatibility**:~~ ✅ **RESOLVED — Update in Stream 2.** The existing `requestPeek`/`ackPeek`/`decryptPeek` moves will be updated to work with encrypted hand zones.

5. **Board UI update**: The Phaser board will need to show encrypted zone indicators during crypto phases, then reveal cards after decryption. _(Deferred to Stream 3.)_

---

## Dependencies

- `src/crypto/mental-poker/` — SRA encryption primitives
- `src/crypto/shamirs/` — Key escrow via Shamir SSS
- `src/crypto/sha256.ts` — Commit-reveal hash
- `src/crypto/stable-json.ts` — Deterministic serialization for seed hashing
- No new npm packages required

---

## Implementation Order

1. **Step 1** (crypto.ts structure + types) — Foundation, no dependencies
2. **Step 2** (types.ts additions) — Add crypto types including `DecryptRequest.purpose`, depends on Step 1
3. **Step 3** (loadDeck update) — Extract cardIds into `deckCardIds`, depends on Step 2
4. **Step 4** (submitPublicKey) — Key exchange, depends on Step 2
5. **Step 5** (distributeKeyShares) — Key escrow, depends on Step 4
6. **Step 6** (encryptDeck) — Deck encryption, depends on Step 5
7. **Step 7** (commitShuffleSeed) — Commit phase, depends on Step 6
8. **Step 8** (revealShuffleSeed + finalize) — Reveal phase, depends on Step 7
9. **Step 9** (shuffleEncryptedDeck) — Actual shuffle, depends on Steps 7-8
10. **Step 10** (dealStartingHands) — Deal cards, depends on Step 9
11. **Step 11** (game.ts wiring) — Connect crypto moves, depends on Steps 4-10
12. **Step 12** (life damage + revealLifeCard) — Cooperative decryption for both paths, depends on Steps 4-10
13. **Step 13** (update peek protocol) — Update `requestPeek`/`ackPeek`/`decryptPeek` for encrypted hand zones, depends on Steps 4-10
14. **Step 14** (crypto tests) — Verify everything works
15. **Step 15** (registry) — Wire into game selection, depends on Step 1

---

## What NOT to Implement in Stream 2

- **Real `hashProofData`** — Keep placeholder (SHA-256 integration is separate)
- **Real `signProof`** — Keep placeholder (ECDSA integration is separate)
- **Abandonment recovery** — Key release + reconstruction in Stream 4 (key escrow is wired, but active recovery flow not implemented)
- **Blockchain settlement** — Separate integration
- **Phaser Board UI** — Deferred to Stream 3 (board shows encrypted zones during crypto phases)

---

_Last updated: April 12, 2026_
