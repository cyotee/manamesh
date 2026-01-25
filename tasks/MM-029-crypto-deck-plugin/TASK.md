# Task MM-029: Cryptographic Deck Plugin (Mental Poker)

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-25
**Dependencies:** MM-020 (Deck Plugin for boardgame.io)
**Worktree:** `feature/crypto-deck-plugin`

---

## Description

Implement cryptographic fair play for P2P card games using mental poker protocols. This task creates a CryptoPlugin for boardgame.io that wraps the existing DeckPlugin with commutative encryption, card commitments, and verifiable shuffle proofs. The goal is to prevent cheating in P2P games where no trusted third party exists.

## Dependencies

- **MM-020**: Deck Plugin for boardgame.io (Complete) - This task wraps the deck plugin with encryption

## User Stories

### US-MM-029.1: Mental Poker Primitives

As a game developer, I want cryptographic primitives for mental poker so that I can build fair P2P card games.

**Acceptance Criteria:**
- [ ] Implement SRA (Shamir-Rivest-Adleman) commutative encryption using `elliptic` library
- [ ] Each player can encrypt cards with their key
- [ ] Cards can be decrypted in any order (commutative property)
- [ ] Key generation is deterministic from a seed (for replay/debugging)
- [ ] Encrypt/decrypt operations are performant (<10ms per card)
- [ ] Unit tests verify commutative property: `Dec_A(Dec_B(Enc_B(Enc_A(m)))) = m`

### US-MM-029.2: Card Commitments

As a player, I want card commitments so that neither player can change their deck after seeing opponent's cards.

**Acceptance Criteria:**
- [ ] Generate SHA-256 commitment for deck state: `commit(deck, nonce) = hash(deck || nonce)`
- [ ] Verify commitment matches revealed deck
- [ ] Commitments exchanged before any cards are revealed
- [ ] Commitment verification integrated into game flow
- [ ] Tests verify commitment binding (can't open to different deck)

### US-MM-029.3: Verifiable Shuffle Proofs

As a player, I want shuffle proofs so that I can verify my opponent shuffled fairly without seeing the order.

**Acceptance Criteria:**
- [ ] Generate zero-knowledge proof that shuffle is a valid permutation
- [ ] Proof does not reveal the permutation itself
- [ ] Use `circomlibjs` for ZKP generation/verification
- [ ] Shuffle proof size is reasonable (<10KB)
- [ ] Verification time is acceptable (<1s)
- [ ] Tests verify proof completeness and soundness

### US-MM-029.4: CryptoPlugin for boardgame.io

As a game developer, I want a CryptoPlugin that wraps DeckPlugin so that I can add encryption to any game.

**Acceptance Criteria:**
- [ ] CryptoPlugin extends/wraps DeckPlugin functionality
- [ ] `cryptoShuffle(zoneId)` - Shuffle with proof generation
- [ ] `cryptoDraw(zoneId)` - Draw with collaborative decryption
- [ ] `cryptoReveal(cardId)` - Reveal card to all players
- [ ] `cryptoPeek(cardId, playerId)` - Reveal card to one player only
- [ ] Plugin manages encryption keys per player
- [ ] Plugin handles commitment exchange during setup phase
- [ ] Tests verify all operations maintain game integrity

### US-MM-029.5: War Game Integration

As a player, I want the War game to use encrypted decks so that neither player can cheat.

**Acceptance Criteria:**
- [ ] War game uses CryptoPlugin instead of plain DeckPlugin
- [ ] Initial deck shuffle generates and exchanges proofs
- [ ] Card flips use collaborative decryption
- [ ] Won cards pile remains encrypted until needed
- [ ] Existing War game tests still pass
- [ ] New tests verify encryption is actually used

## Technical Details

### Mental Poker Protocol Overview

```
Setup Phase:
1. Both players generate key pairs (using elliptic curve)
2. Player A encrypts all 52 cards with their key: Enc_A(card_i)
3. Player A shuffles and sends to Player B
4. Player B re-encrypts each card: Enc_B(Enc_A(card_i))
5. Player B shuffles and generates shuffle proof
6. Both commit to deck state

Draw Phase:
1. To reveal card at position i:
   - Player B decrypts: Dec_B(Enc_B(Enc_A(card_i))) = Enc_A(card_i)
   - Player A decrypts: Dec_A(Enc_A(card_i)) = card_i
2. Both players now see the card

Verification:
- Shuffle proof verified before game starts
- Commitments verified at game end (or on dispute)
```

### File Structure

```
packages/frontend/src/crypto/
├── mental-poker/
│   ├── types.ts           # CryptoCard, EncryptedDeck, Proof types
│   ├── sra.ts             # SRA commutative encryption
│   ├── sra.test.ts
│   ├── commitment.ts      # Hash commitments
│   ├── commitment.test.ts
│   ├── shuffle-proof.ts   # ZK shuffle proofs
│   ├── shuffle-proof.test.ts
│   └── index.ts           # Re-exports
├── plugin/
│   ├── crypto-plugin.ts   # boardgame.io CryptoPlugin
│   ├── crypto-plugin.test.ts
│   └── index.ts
└── index.ts               # Package exports
```

### Key Interfaces

```typescript
// Encrypted card representation
interface EncryptedCard {
  id: string;              // Original card ID (unknown until decrypted)
  ciphertext: Uint8Array;  // Encrypted card data
  layer: number;           // Number of encryption layers (0 = plaintext)
}

// Player's encryption context
interface CryptoContext {
  playerId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;  // Never sent over network
  peerPublicKeys: Map<string, Uint8Array>;
}

// Shuffle proof
interface ShuffleProof {
  commitment: Uint8Array;  // Commitment to permutation
  proof: Uint8Array;       // ZK proof data
  publicInputs: Uint8Array[];
}

// CryptoPlugin API
interface CryptoPluginApi extends DeckPluginApi {
  // Setup
  initCrypto(playerIds: string[]): void;
  exchangeKeys(): Promise<void>;

  // Encrypted operations
  cryptoShuffle(zoneId: ZoneId): Promise<ShuffleProof>;
  cryptoDraw(zoneId: ZoneId, count?: number): Promise<DrawResult>;
  cryptoReveal(cardId: string): Promise<Card>;
  cryptoPeek(cardId: string, toPlayerId: string): Promise<Card>;

  // Verification
  verifyShuffleProof(proof: ShuffleProof): Promise<boolean>;
  verifyCommitment(deck: Card[], commitment: Uint8Array): boolean;
}
```

### Dependencies

Already in package.json:
- `elliptic: ^6.5.5` - Elliptic curve operations for SRA encryption
- `circomlibjs: ^0.1.7` - ZK proof library

May need to add:
- Circom circuits for shuffle proofs (compile to WASM)

## Files to Create/Modify

**New Files:**
- `packages/frontend/src/crypto/mental-poker/types.ts` - Type definitions
- `packages/frontend/src/crypto/mental-poker/sra.ts` - SRA encryption
- `packages/frontend/src/crypto/mental-poker/commitment.ts` - Hash commitments
- `packages/frontend/src/crypto/mental-poker/shuffle-proof.ts` - ZK shuffle proofs
- `packages/frontend/src/crypto/mental-poker/index.ts` - Re-exports
- `packages/frontend/src/crypto/plugin/crypto-plugin.ts` - boardgame.io plugin
- `packages/frontend/src/crypto/plugin/index.ts` - Plugin exports
- `packages/frontend/src/crypto/index.ts` - Package exports

**Modified Files:**
- `packages/frontend/src/game/modules/war/game.ts` - Use CryptoPlugin
- `packages/frontend/src/game/modules/war/types.ts` - Add crypto state types

**Tests:**
- `packages/frontend/src/crypto/mental-poker/sra.test.ts`
- `packages/frontend/src/crypto/mental-poker/commitment.test.ts`
- `packages/frontend/src/crypto/mental-poker/shuffle-proof.test.ts`
- `packages/frontend/src/crypto/plugin/crypto-plugin.test.ts`

## Inventory Check

Before starting, verify:
- [ ] `elliptic` package is installed and working
- [ ] `circomlibjs` package is installed and working
- [ ] DeckPlugin (MM-020) is complete and tested
- [ ] War game module is working without encryption
- [ ] Understand SRA encryption algorithm
- [ ] Understand Circom ZKP workflow

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] Mental poker primitives work correctly
- [ ] CryptoPlugin wraps DeckPlugin seamlessly
- [ ] War game uses encryption for all deck operations
- [ ] Shuffle proofs generate and verify correctly
- [ ] Tests pass (aim for >90% coverage of crypto code)
- [ ] Build succeeds
- [ ] Performance is acceptable (shuffle + proof < 5s for 52 cards)

## References

- [Mental Poker Paper (Shamir, Rivest, Adleman)](https://people.csail.mit.edu/rivest/pubs/SRA81.pdf)
- [Practical Mental Poker Without a TTP](https://eprint.iacr.org/2015/1044.pdf)
- [Circom Documentation](https://docs.circom.io/)
- [elliptic npm package](https://www.npmjs.com/package/elliptic)

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
