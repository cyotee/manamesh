# Task MM-030: War Game Crypto Integration

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-25
**Dependencies:** MM-021 (War Game Module), MM-029 (Cryptographic Deck Plugin)
**Worktree:** `feature/war-crypto`

---

## Description

Integrate the CryptoPlugin (MM-029) into the War game module (MM-021) to enable cryptographically fair P2P gameplay. This refactors the War game to use encrypted decks, shuffle proofs, and collaborative card reveals instead of plaintext arrays.

## Dependencies

- **MM-021** (Complete): War Game Module - base game logic
- **MM-029** (Complete): Cryptographic Deck Plugin - provides CryptoPlugin and mental poker primitives

## User Stories

### US-MM-030.1: Crypto Setup Phase

As a player, I want the game to perform key exchange and deck encryption before gameplay begins so that neither player can know the deck order.

**Acceptance Criteria:**
- [ ] Add `keyExchange` phase before `play` phase
- [ ] Both players generate and exchange public keys
- [ ] Each player encrypts the deck with their private key (layered encryption)
- [ ] Each player shuffles and provides shuffle proof
- [ ] Game transitions to `play` phase only after crypto setup completes

### US-MM-030.2: Encrypted Deck State

As a player, I want the deck stored in encrypted form so that card values are hidden until revealed.

**Acceptance Criteria:**
- [ ] Replace `WarCard[]` deck arrays with `EncryptedCard[]`
- [ ] Track encryption layers per card
- [ ] Maintain mapping of revealed card indices to `WarCard` values
- [ ] Update `WarState` type to include crypto state

### US-MM-030.3: Collaborative Card Reveal

As a player, I want card flips to require decryption from both players so that neither can cheat by peeking ahead.

**Acceptance Criteria:**
- [ ] `flipCard` move requests decryption shares from both players
- [ ] Card remains encrypted until both shares submitted
- [ ] Once fully decrypted, card is revealed and moved to played zone
- [ ] Handle async nature of waiting for opponent's share

### US-MM-030.4: War Resolution with Encryption

As a player, I want war scenarios to work correctly with encrypted cards so that face-down cards remain hidden.

**Acceptance Criteria:**
- [ ] Face-down war cards stay encrypted (not revealed)
- [ ] Only the final flip card in war is revealed
- [ ] Winner collects encrypted cards (re-encrypted for their pile)
- [ ] Handle edge case where player runs out of cards during war

### US-MM-030.5: Shuffle Proof Verification

As a player, I want to verify that shuffles were fair so that I can trust the game wasn't rigged.

**Acceptance Criteria:**
- [ ] Store shuffle proofs in game state
- [ ] Provide API to verify shuffle proofs
- [ ] Log/expose proof verification results for transparency
- [ ] Handle verification failure gracefully (dispute mechanism)

### US-MM-030.6: Backward Compatibility

As a developer, I want the crypto-enabled War game to coexist with the plaintext version for testing and local play.

**Acceptance Criteria:**
- [ ] Add `useCrypto` config option to `WarGame`
- [ ] When `useCrypto: false`, use current plaintext implementation
- [ ] When `useCrypto: true`, use encrypted implementation
- [ ] All existing tests pass with `useCrypto: false`

## Technical Details

### State Changes

```typescript
// Extended WarState
interface CryptoWarState extends WarState {
  crypto: {
    phase: 'keyExchange' | 'encrypt' | 'shuffle' | 'ready';
    publicKeys: Record<string, string>;
    encryptedDeck: EncryptedCard[];
    shuffleProofs: Record<string, SerializedShuffleProof>;
    pendingReveals: Record<number, Record<string, string>>;
    revealedCards: Record<number, WarCard>;
  };
}
```

### New Phases

1. **keyExchange**: Players submit public keys
2. **encrypt**: Players sequentially encrypt deck
3. **shuffle**: Players shuffle with proofs
4. **play**: Normal gameplay with encrypted reveals

### Move Changes

- `submitPublicKey(publicKey)` - New move for key exchange
- `encryptDeck()` - New move for encryption phase
- `shuffleDeck()` - New move with proof generation
- `flipCard()` - Modified to request decryption
- `submitDecryptionShare(cardIndex, share)` - New move for reveals

## Files to Create/Modify

**Modified Files:**
- `packages/frontend/src/game/modules/war/game.ts` - Add crypto integration
- `packages/frontend/src/game/modules/war/types.ts` - Extend state types

**New Files:**
- `packages/frontend/src/game/modules/war/crypto.ts` - Crypto-specific logic
- `packages/frontend/src/game/modules/war/crypto.test.ts` - Crypto integration tests

**Tests:**
- `crypto.test.ts` - Full crypto gameplay flow
- Update `game.test.ts` - Ensure backward compatibility

## Inventory Check

Before starting, verify:
- [ ] MM-029 CryptoPlugin is complete and exported
- [ ] `CryptoPlugin`, `createPlayerCryptoContext` accessible from `src/crypto`
- [ ] War game tests passing
- [ ] Understand CryptoPlugin API (init, encryptDeckForPlayer, submitDecryptionShare, etc.)

## Implementation Notes

1. **Async Handling**: Card reveals are inherently async (waiting for opponent). Consider using boardgame.io's `activePlayers` to track who needs to submit shares.

2. **Re-encryption on Win**: When a player wins cards, they may need to be re-encrypted for storage in that player's won pile. Alternatively, keep cards encrypted with original keys and track ownership separately.

3. **Reshuffle Complexity**: When reshuffling won pile into deck, need to re-encrypt and generate new shuffle proof.

4. **Testing Strategy**: Use deterministic seeds in tests for reproducible crypto operations.

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] Crypto War game completes full match without errors
- [ ] Shuffle proofs verify correctly
- [ ] All tests pass (both crypto and non-crypto modes)
- [ ] Build succeeds
- [ ] No TypeScript errors

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
