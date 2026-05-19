# ManaMesh: Making Crypto Games Untrusted P2P-Ready

## Context

ManaMesh implements 5 cryptographically-enabled game modules (War, Poker, Go Fish, Merkle Battleship, Threshold Tally) using three cryptographic paradigms: SRA mental poker, Merkle tree commitments, and threshold homomorphic encryption. The current implementation has **critical security gaps** that allow any player in a P2P game to cheat by reading private keys from shared state or exploiting incomplete game logic.

**Goal**: Hardening the crypto game modules so they are safe for play against untrusted adversaries — players who may actively try to cheat, not just honest-but-curious observers.

---

## Scope

**In scope**: All cryptographically-enabled game modules, the crypto plugin, and the cryptographic primitives they depend on.

**Out of scope**: Standard (non-crypto) game modes, blockchain settlement contracts, frontend UI polish, P2P transport security.

---

## Phase 1: P0 Critical Security Fixes

These are active vulnerabilities. Do not run untrusted P2P games until these are resolved.

### 1.1 Remove Private Keys from Shared Game State

**Problem**: `crypto-plugin.ts` stores player private keys in `G.crypto.privateKeys`. Any player can read another's private key and decrypt all cards unilaterally, breaking the mental poker threat model entirely.

**Files**: `packages/frontend/src/crypto/plugin/crypto-plugin.ts`, `packages/frontend/src/game/modules/poker/crypto.ts`

**Implementation**:
1. Remove `privateKeys` field from `CryptoPluginState` interface
2. Audit all move functions that access `G.crypto.privateKeys` — there are `DEMO NOTE` markers in `poker/crypto.ts` for `peekHoleCards` and `tryDecryptCommunityCard`
3. For each insecure decryption path, replace with cooperative decryption:
   - Player who needs a card decrypted submits `submitDecryptionShare(playerId, cardIndex, myDecryptedLayer)`
   - Game state collects shares in `PendingReveal`
   - When all required shares collected, game state combines them and reveals plaintext
4. Private keys must live in `localStorage` only, never serialized to boardgame.io state
5. `crypto-plugin.ts` `submitDecryptionShare()` already supports this pattern — ensure all crypto modules use it instead of direct private key access

**Verification**: Search for all `privateKeys` references in game modules. All should be removed or logged as errors. No `DEMO NOTE` comments should remain in crypto code.

**Test plan**:
- Add integration test: two players connect via P2P, player A attempts to peek player B's cards via direct private key access → must fail
- Verify cooperative decrypt flow: player A requests reveal → player B submits share → card revealed only after both shares collected

---

### 1.2 War — Implement Reshuffle with Re-encryption

**Problem**: `war/crypto.ts` has a TODO: "Handle reshuffle with new encryption." When a player's deck empties mid-game, the won pile must be shuffled back in. If the won pile retains its original encryption layers while the deck has current layers, decryption will fail or produce garbage.

**Files**: `packages/frontend/src/game/modules/war/crypto.ts`

**Implementation**:
1. When deck is empty and won pile exists:
   - Move won pile cards to a temporary encrypted zone
   - Re-encrypt entire temporary zone under the *current* encryption layers (all players' current public keys)
   - Run shuffle proof generation on the re-encrypted temporary zone
   - Merge back into empty deck zone
2. The reshuffle must be atomic: all players must participate in the re-encryption step (sequential per `setupPlayerIndex`)
3. A `ReshuffleRequest` state entry tracks progress; `reshuffleComplete` boolean signals when done
4. Add `isReshuffling` flag to `G.crypto` to block other moves during reshuffle

**Verification**: Play a War game to 50+ flips (stress test reshuffle). No cards should be lost, no decryption failures.

**Test plan**:
- Unit test: empty deck + non-empty won pile → reshuffle triggered → new deck has correct card count and encryption layers
- Integration test: two players play War until reshuffle occurs, verify both can decrypt subsequent flips correctly

---

## Phase 2: P1 High-Priority Hardening

These improve security and complete incomplete implementations.

### 2.1 Poker — Integrate Betting with Crypto Phases

**Problem**: `poker/crypto.ts` implements mental poker but betting (`betting.ts`) runs independently. Folding doesn't prove cards were valid; raising doesn't cryptographically commit to a hand strength.

**Files**: `packages/frontend/src/game/modules/poker/crypto.ts`, `packages/frontend/src/game/modules/poker/betting.ts`

**Implementation**:
1. **Fold = release keys**: When a player folds, they must call `releaseKey` to submit their decryption key to the game. This proves they had valid hole cards (could have called `releaseKey` at any time). If they fold without releasing, other players can flag a `VOIDED` challenge.
2. **Showdown = cooperative reveal**: All remaining players cooperatively decrypt all hole cards simultaneously. No self-decryption allowed.
3. **Bet gating**: Card reveal moves (peek, showdown) must check the current betting state — only the active betting round winner can request reveals, or all players must be in showdown phase.
4. **Remove all `DEMO NOTE` paths**: `peekHoleCards` and `tryDecryptCommunityCard` currently use stored private keys — replace with cooperative share collection.

**Verification**: Fold without calling `releaseKey` → game enters `voided` state. Showdown → all hole cards revealed via cooperative decrypt, not direct access.

---

### 2.2 Go Fish — Disable Insecure Modes, Promote Secure Mode

**Problem**: Three security modes exist (`demo-private`, `coop-reveal`, `zk-attest`). `demo-private` is intentionally insecure. `zk-attest` lacks ZK circuits.

**Files**: `packages/frontend/src/game/modules/gofish/crypto.ts`

**Implementation**:
1. **Disable `demo-private` mode**: Add a runtime guard that throws if `securityMode === 'demo-private'` in any non-local game. Log a warning. This prevents accidental use.
2. **Promote `coop-reveal`**: Document it as the only production-ready mode. Add a mode selection UI in GoFishBoard that only shows `coop-reveal` and `zk-attest`.
3. **zk-attest mode**: Add `// EXPERIMENTAL: ZK circuits not implemented` comments prominently. If a user selects it, show a warning modal. The verifier signing infrastructure works but no actual ZK proofs are generated.
4. **Audit commit-reveal shuffle**: The commit-reveal seed subprotocol must enforce simultaneous commitment (no player can see another's seed before committing). Verify this with a timing attack test.

**Verification**: Mode selector in UI only shows `coop-reveal` (default) and `zk-attest` (with warning). `demo-private` throws if selected.

---

### 2.3 Shuffle Proof — Assess ZK Upgrade Path

**Problem**: `shuffle-proof.ts` uses commit-and-reveal — after the game, the permutation is fully visible. This is a post-game information leak.

**Files**: `packages/frontend/src/crypto/mental-poker/shuffle-proof.ts`

**Implementation**:
1. **Document the limitation**: Add a comment explaining that current shuffle proof reveals permutation after game. This is acceptable for "honest-but-curious" but not "malicious" threat models.
2. **Assess ZK upgrade**: Evaluate whether a Neff shuffle proof or Groth-based SNARK is needed. This requires:
   - Circom circuit for shuffle verification (permutation check as circuit)
   - snarkjs for proof generation/verification
   - Trusted setup ceremony for the circuit
3. **Decision point**: If ZK shuffle is required, estimate 2-4 weeks for circom circuit + setup. If not required, document the limitation and close the issue.

**Verification**: Code inspection confirming shuffle proof documentation. If ZK upgrade chosen: circuit compiles, proof generates in <5s, verification passes.

---

**DECISION: ZK shuffle upgrade DECLINED for now.**

- Commit-and-reveal is ACCEPTABLE for honest-but-curious (HBC) threat model
- Cards remain encrypted during game play — permutation leak only occurs after game
- ZK shuffle would require 2-4 weeks (Circom circuit + trusted setup) — not justified for current scope
- ZK upgrade documented as a future option in `shuffle-proof.ts` header
- If adversarial players become a concern, revisit Bayer-Groth or Neff shuffle

---

## Phase 3: P2/P3 Enhancements

### 3.1 HE Battleship — Wire Paillier Verification into Battle

**Files**: `packages/frontend/src/game/modules/he-battleship/logic.ts`, `packages/frontend/src/game/modules/he-battleship/game.ts`

**Implementation**:
1. When defender publishes `boardBits`, they also publish a Paillier encryption of the full ship count: `Enc(totalShipCells)`
2. When attacker guesses cell `(x,y)`, defender responds with: (a) Merkle proof the cell was not modified since placement, (b) Paillier encryption of whether cell is ship + whether it's hit
3. Both ciphertexts are homomorphically aggregated: if all guesses were honest, `Enc(hits) + Enc(misses) = Enc(totalShipCells)`
4. On game end, cooperatively decrypt the aggregate — if it doesn't match `Enc(totalShipCells)`, challenge voided

**Verification**: Attacker guesses all 17 ship cells honestly; defender's encrypted responses aggregate correctly to total ship count.

---

### 3.2 Shamir's — Replace Custom AES/HMAC with WebCrypto

**Files**: `packages/frontend/src/crypto/shamirs/split.ts`

**Implementation**:
1. Replace custom AES-CTR + HMAC-SHA256 in `encryptShare`/`decryptShare` with `SubtleCrypto.encrypt('AES-GCM', ...)` and `SubtleCrypto.decrypt('AES-GCM', ...)`
2. Use `crypto.getRandomValues()` for IV generation
3. Keep the ECIES structure (ECDH for key derivation + symmetric encryption) but swap the crypto primitives
4. Add tests that verify share round-trip: split → encrypt → decrypt → reconstruct == original

**Verification**: Run `yarn workspace @manamesh/frontend test src/crypto/shamirs/*.test.ts`. All pass. Benchmark: share encryption/decryption <10ms for typical private key size.

---

### 3.3 Feldman DKG — Extend to Arbitrary Threshold

**Files**: `packages/frontend/src/crypto/feldman-dkg.ts`

**Implementation**:
1. Current implementation hardcoded for degree-1 / t=2. Extend polynomial generation to accept `degree = threshold - 1`
2. Add share verification for degree-2+ polynomials: `verifyShare(x_i, y_i, commitments)` must check `g^{f(x_i)} == product(commitments[j]^{x_i^j})`
3. Update Lagrange interpolation in `reconstructKeyFromShares` to work for any `t <= n`
4. Add `ThresholdConfig` parameter to `FeldmanDKG` class: `{ players, threshold, publicKey }`

**Verification**: Test DKG with 3 players, threshold=3 (all 3 required). Test DKG with 4 players, threshold=2 (any 2 required). Shares distributed correctly; reconstruction works only with sufficient shares.

---

### 3.4 Threshold Tally — Add Input Range Proofs

**Files**: `packages/frontend/src/game/modules/threshold-tally/logic.ts`

**Problem**: Players can encrypt any integer as their input. If max contribution is 100, a malicious player encrypts `999`. The decrypted sum will be wrong but looks valid.

**Implementation**:
1. For each encrypted input `Enc(m)`, add a Circom range proof that `0 <= m <= MAX_CONTRIBUTION`
2. On submit, verify range proof before accepting ciphertext into aggregate
3. Alternatively: use Bulletproofs-style range proof (smaller than Circom circuit)
4. If runtime is acceptable, use homomorphic commitment: `Enc(m)` accompanied by `Com(m)` and a ZK proof that `m` is in range

**Verification**: Submit `Enc(999)` when max is 100 → proof verification fails → input rejected.

---

## Verification & Testing

### Per-Phase Test Requirements

| Phase | Test | Pass Criteria |
|-------|------|--------------|
| 1.1 | No `privateKeys` in `G.crypto` after fix | Grep finds zero matches in game modules |
| 1.1 | Cooperative decrypt integration test | 2-player P2P: request reveal → both submit shares → card revealed |
| 1.2 | War reshuffle unit test | Empty deck + 10-card won pile → reshuffle → 26-card deck with correct layers |
| 2.1 | Poker fold-release integration test | Fold without release → `voided` state triggered |
| 2.2 | Go Fish mode guard test | Select `demo-private` → throws/warns, game does not start |
| 2.3 | Shuffle proof documentation | Comment present in `shuffle-proof.ts` explaining post-game leak |
| 3.1 | HE aggregate verification | 17 hits + 83 misses = Enc(100) after homomorphic sum |
| 3.2 | Shamir AES round-trip | split → encrypt → decrypt → reconstruct == original (all tests pass) |
| 3.3 | DKG threshold test | 4 players, t=2 → any 2 can reconstruct; 1 cannot |
| 3.4 | Range proof rejection | Enc(999) with max=100 → proof rejected |

### Pre-Deployment Checklist

- [ ] All `privateKeys` references removed from shared state (grep check)
- [ ] All `DEMO NOTE` comments resolved or documented as experimental
- [ ] War reshuffle has unit test and integration test passing
- [ ] Poker fold → voided verified
- [ ] Go Fish `demo-private` disabled
- [ ] Shuffle proof limitation documented
- [ ] No new `TODO` comments introduced
- [ ] `yarn workspace @manamesh/frontend test` passes (1113+ tests)
- [ ] Vite build clean (8,842 kB output)

---

## Estimated Timeline

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1.1 (private key removal) | 1-2 days | None |
| Phase 1.2 (War reshuffle) | 1-2 days | None |
| Phase 2.1 (Poker betting) | 2-3 days | Phase 1.1 |
| Phase 2.2 (Go Fish modes) | 0.5 day | None |
| Phase 2.3 (shuffle ZK assess) | 1 day | None |
| Phase 3.1 (HE Battleship) | 2-3 days | None |
| Phase 3.2 (Shamir WebCrypto) | 1 day | None |
| Phase 3.3 (DKG threshold) | 2 days | None |
| Phase 3.4 (range proofs) | 3-5 days | snarkjs setup, circom |

**Total**: ~13-20 days of implementation work, spread across 8 discrete tasks.

---

## Open Questions

1. **ZK shuffle proof**: Is post-game permutation reveal acceptable for the intended use case? If yes, skip 2.3. If no, this becomes a 3-4 week task.
2. **HE Battleship verification**: Is homomorphic verification of ship counts sufficient, or do you need per-cell verification? Per-cell requires a different approach (threshold Paillier + DKG).
3. **Threshold Tally range proofs**: Is on-chain verification required, or is UI-enforced range sufficient for the demo?
4. **Deployment scope**: Should all fixes land before any P2P deployment, or can Phase 1 fixes be deployed incrementally?
