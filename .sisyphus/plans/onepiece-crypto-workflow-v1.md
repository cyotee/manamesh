# One Piece Crypto Workflow Implementation Plan

**Date:** 2026-03-25
**Author:** Sisyphus
**Status:** Planned
**Complexity:** HIGH (2-3 weeks)

---

## Executive Summary

The One Piece TCG module has individual decks and supports game rules, but lacks the cryptographic workflow for secure P2P play. This plan defines implementing full SRA mental poker integration for One Piece, enabling provably fair play without a trusted server.

**Key Difference from War/Poker:** One Piece uses **individual decks** (each player has their own deck) rather than a **shared deck** (players draw from a common pile). However, the SRA encryption process is fundamentally the same — each player encrypts their own deck with both players' keys.

---

## Architecture Overview

### Current State

```
OnePieceGame (boardgame.io Game)
├── setup phase → play phase (direct jump)
├── loadDeck, drawCard, playCard, etc.
└── Peek protocol (partially implemented)
```

### Target State

```
CryptoOnePieceGame (boardgame.io Game)
├── setup phase → keyExchange → encrypt → shuffle → play phase
├── Crypto state management (cardPointLookup, encryptedZones)
├── Key exchange for both players' decks
├── Per-player encryption workflow
├── Shuffle with commit-reveal
└── Peek protocol integrated with crypto flow
```

---

## Key Insight: Individual vs Shared Deck Crypto

### Shared Deck (War, Poker)

- One deck that both players draw from
- Cards must be dealt to specific players via cooperative decryption
- Encryption: Both players encrypt the same deck

### Individual Deck (One Piece)

- Each player has their own deck
- Only the deck owner draws from it
- Encryption: Each player encrypts their own deck, opponent verifies

**Crypto Process (same for both):**

```
Deck Owner encrypts deck with their key → Opponent re-encrypts → Final ciphertext
To draw: Owner decrypts their layer → Opponent verifies (no need to decrypt draw)
```

---

## Phase Definitions

### Phase 1: `keyExchange`

Players exchange SRA public keys.

**Moves:**

- `submitPublicKey(playerId, publicKey)` — Player submits their encryption public key
- `submitZkSigPublicKey(playerId, zkSigPublicKey)` — (Optional ZK) Player submits ZK verification key

**Transition:** When all players have submitted public keys → `encrypt`

### Phase 2: `encrypt`

Each player encrypts their deck with their own private key (layer 1).

**Moves:**

- `encryptDeck(playerId, privateKey)` — Player encrypts their entire deck

**Transition:** When all players have encrypted → `shuffle`

### Phase 3: `shuffle`

Each player shuffles their encrypted deck and provides shuffle proof.

**Moves:**

- `commitShuffleSeed(playerId, commitHashHex)` — Player commits to shuffle seed
- `revealShuffleSeed(playerId, seedHex)` — Player reveals seed
- `shuffleDeck(playerId, privateKey)` — Apply shuffle with re-encryption
- `voteAbortShuffle(playerId)` — Vote to abort if shuffle stalls

**Transition:** When all players have shuffled with valid proofs → `play`

### Phase 4: `play`

Standard One Piece gameplay with crypto-integrated peek protocol.

**Modified Moves:**

- `drawCard` — Uses encrypted deck, triggers peek protocol if needed
- `requestPeek` — Triggers cooperative decryption for deck look
- `ackPeek` — Opponent acknowledges and provides decryption share
- `decryptPeek` — Owner decrypts peeked cards

---

## State Structure

### New Types (in `onepiece/crypto-types.ts`)

```typescript
interface CryptoOnePieceState extends OnePieceState {
  crypto: CryptoPluginState;
  cardIds: Record<string, string[]>; // playerId → cardIds
  phase: OnePiecePhase;
  setupPlayerIndex: number;
  playerOrder: string[];
}

interface CryptoOnePiecePlayerState extends OnePiecePlayerState {
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
  zkSigPublicKey: string | null;
}
```

---

## Implementation Tasks

### Phase A: Foundation (2-3 days)

- [ ] Create `onepiece/crypto-types.ts` with crypto state interfaces
- [ ] Create `onepiece/crypto.ts` module (similar to `war/crypto.ts`)
- [ ] Import crypto utilities: `encrypt`, `decrypt`, `encryptDeck`, `buildCardPointLookup`
- [ ] Implement `createCryptoOnePieceState()` function
- [ ] Create `CryptoOnePieceGame` game definition skeleton with phases

### Phase B: Key Exchange (1-2 days)

- [ ] Implement `submitPublicKey(G, ctx, playerId, publicKey)`
- [ ] Implement `allKeysSubmitted()` helper
- [ ] Add `keyExchange` phase to `CryptoOnePieceGame.phases`
- [ ] Add `submitPublicKey` move with `client: false`
- [ ] Add turn ordering for key exchange
- [ ] Add phase transition: `keyExchange` → `encrypt`

### Phase C: Encryption (1-2 days)

- [ ] Implement `encryptDeck(G, ctx, playerId, privateKey)`
- [ ] Use `cardPointLookup` built at setup for consistent hashing
- [ ] Add `encrypt` phase to `CryptoOnePieceGame.phases`
- [ ] Add `encryptDeck` move with `client: false`
- [ ] Add turn ordering for sequential encryption (per `setupPlayerIndex`)
- [ ] Add phase transition: `encrypt` → `shuffle`

### Phase D: Shuffle (2-3 days)

- [ ] Implement `commitShuffleSeed(G, ctx, playerId, commitHashHex)`
- [ ] Implement `revealShuffleSeed(G, ctx, playerId, seedHex)`
- [ ] Implement `shuffleDeck(G, ctx, playerId, privateKey, events)`
- [ ] Implement `xorAllSeeds()` for deterministic final seed
- [ ] Add `shuffle` phase to `CryptoOnePieceGame.phases`
- [ ] Add all shuffle moves with `client: false`
- [ ] Implement stall detection and `voteAbortShuffle`
- [ ] Add phase transition: `shuffle` → `play`

### Phase E: Peek Protocol Integration (2-3 days)

- [ ] Review existing peek protocol in `peek.ts`
- [ ] Modify `ackPeek` to use `decryptedCard` pattern (V2 fix)
- [ ] Ensure peek works with individual deck encryption model
- [ ] Test full peek flow: request → ack → decrypt → reorder (optional)

### Phase F: Board Component Integration (2-3 days)

- [ ] Create or modify `OnePieceBoard.tsx` to support crypto phases
- [ ] Add auto-execute for key exchange in `useEffect`
- [ ] Add auto-execute for encryption in `useEffect`
- [ ] Add auto-execute for shuffle commit-reveal in `useEffect`
- [ ] Display phase progress to user
- [ ] Add crypto transparency panel for debugging

### Phase G: Testing (2-3 days)

- [ ] Write unit tests for `createCryptoOnePieceState`
- [ ] Write unit tests for key exchange flow
- [ ] Write unit tests for encrypt flow
- [ ] Write unit tests for shuffle flow with commit-reveal
- [ ] Write integration tests for full crypto setup
- [ ] Test peek protocol with crypto flow
- [ ] Manual P2P testing with two browser tabs

---

## File Structure

```
src/game/modules/onepiece/
├── game.ts           # Standard OnePieceGame (unchanged)
├── crypto.ts         # NEW: CryptoOnePieceGame and crypto functions
├── crypto-types.ts   # NEW: Crypto state interfaces
├── types.ts          # Existing: base types
├── zones.ts         # Existing: zone definitions
├── peek.ts          # Existing: peek protocol (needs modification)
├── visibility.ts    # Existing: card visibility
├── playArea.ts      # Existing: play area management
├── proofChain.ts    # Existing: proof chain
├── index.ts         # Update: export CryptoOnePieceGame
└── README.md        # Update: document crypto workflow
```

---

## Dependencies

### External Imports

```typescript
import {
  encrypt,
  decrypt,
  encryptDeck,
  buildCardPointLookup,
  type EncryptedCard,
} from "../../crypto/mental-poker";
import type { CryptoPluginState } from "../../crypto/plugin/crypto-plugin";
```

### Similar Implementation Reference

- `src/game/modules/war/crypto.ts` — Most similar implementation
- `src/game/modules/poker/crypto.ts` — More complex, includes betting

---

## Security Considerations

### V2 Fix Applied

All decryption moves use `decryptedCard: EncryptedCard` pattern, not `privateKey: string`.

### V3 Fix Applied

Implicit verification via `lookupCardIdFromPoint` ensures revealed cards are valid.

### Individual Deck Model

Since each player only encrypts their own deck:

- Opponent cannot read owner's deck (owner holds final decryption key)
- Owner can prove deck contents via cooperative peek
- No shared deck manipulation possible

---

## Testing Strategy

### Unit Tests (Vitest)

```bash
yarn workspace @manamesh/frontend test src/game/modules/onepiece/crypto.test.ts
```

### Integration Tests

- Two browser tabs, P2P mode
- Complete key exchange → encrypt → shuffle → draw cards
- Verify peek protocol works with crypto flow

---

## Estimated Timeline

| Phase                | Duration | Cumulative |
| -------------------- | -------- | ---------- |
| A: Foundation        | 2-3 days | 2-3 days   |
| B: Key Exchange      | 1-2 days | 3-5 days   |
| C: Encryption        | 1-2 days | 4-7 days   |
| D: Shuffle           | 2-3 days | 6-10 days  |
| E: Peek Integration  | 2-3 days | 8-13 days  |
| F: Board Integration | 2-3 days | 10-16 days |
| G: Testing           | 2-3 days | 12-19 days |

**Total:** ~2-3 weeks for full implementation

---

## Open Questions

1. **Leader card handling**: Should leader cards be encrypted? They're public knowledge at game start.

2. **Life deck**: Should life cards (face-down, revealed when taking damage) use the same encryption?

3. **Deck loading**: Should `loadDeck` happen before or after encryption phase?

4. **Don cards**: DON!! cards typically aren't shuffled — should they bypass encryption?

---

## Checklist for Completion

- [ ] `CryptoOnePieceGame` exported and registered in `registry.ts`
- [ ] All 4 phases (`keyExchange`, `encrypt`, `shuffle`, `play`) functional
- [ ] V2 decryption pattern (`decryptedCard`) implemented
- [ ] V3 verification pattern (`lookupCardIdFromPoint`) implemented
- [ ] Board component handles crypto setup with auto-execute
- [ ] Unit tests pass
- [ ] P2P integration tested manually
