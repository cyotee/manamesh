# ManaMesh Security Remediation Plan

**Date:** 2026-03-24  
**Author:** Sisyphus Security Review  
**Status:** Planned  
**Review File:** `docs/SECURITY_REVIEW.md`

---

## Executive Summary

This plan addresses critical security vulnerabilities identified in the ManaMesh cryptographic implementations. The vulnerabilities fall into four categories:

| Category                           | Severity | Count |
| ---------------------------------- | -------- | ----- |
| Broken Cryptographic Primitives    | CRITICAL | 1     |
| Missing Cryptographic Verification | CRITICAL | 2     |
| Protocol Design Flaws              | HIGH     | 3     |
| DoS Vectors                        | MEDIUM   | 2     |

**Estimated Effort:** 2-3 weeks for full remediation (excluding ZK deferred)

---

## Scope: Games Using SRA Mental Poker

The security fixes apply to **all games** using SRA (Shamir-Rivest-Adleman) commutative encryption:

### Shared Deck Games

| Game    | Deck Type | Description                                |
| ------- | --------- | ------------------------------------------ |
| War     | Shared    | 52-card deck split evenly (26 each)        |
| Poker   | Shared    | Common community deck + private hole cards |
| Go Fish | Shared    | One draw pile所有人都 draw from            |

### Individual Deck Games

| Game          | Deck Type  | Description                    |
| ------------- | ---------- | ------------------------------ |
| One Piece TCG | Individual | Each player has their own deck |

### Cooperative Encryption Process (Same for Both)

**Encryption:**

```
Card → P0 encrypts (layer 1) → P1 encrypts (layer 2) → Final ciphertext
```

**Decryption:**

```
Final ciphertext → P0 OR P1 can decrypt first (any order!) → Intermediate → P1 OR P0 decrypts → Card revealed
```

**Key property:** Encryption and decryption are **commutative** — order doesn't matter. This applies to both shared and individual deck games.

**For individual decks:** The visibility model differs (owner-known vs. public), but the crypto process is identical.

---

## Vulnerability Summary

| #   | Vulnerability                                              | Severity | Affected Component                              | Effort   | Status        |
| --- | ---------------------------------------------------------- | -------- | ----------------------------------------------- | -------- | ------------- |
| V1  | Fake SHA-256 in `sha256Sync`                               | CRITICAL | `crypto/mental-poker/sra.ts`                    | Low      | Pending       |
| V2  | Private keys transmitted in plaintext                      | CRITICAL | `gofish/crypto.ts`                              | Low      | Pending       |
| V3  | No verification of decryption shares                       | CRITICAL | `gofish/crypto.ts`                              | Low      | Pending       |
| V4  | Shamir escrow not implemented                              | —        | REMOVED — abandonment handled via stake seizure | N/A      | Removed       |
| V5  | Commit-reveal shuffle (not an issue for non-betting games) | —        | N/A                                             | N/A      | Not a concern |
| V6  | No DoS protection for Merkle Battleship reveals            | MEDIUM   | `merkle-battleship/`                            | Medium   | Pending       |
| V7  | Non-crypto games have zero protection                      | HIGH     | `game.ts`, `war/game.ts`                        | Low      | Pending       |
| V8  | ZK attestation is scaffolding only                         | MEDIUM   | `gofish/crypto.ts`                              | DEFERRED | Deferred      |

---

## Additional Scope: One Piece TCG Full Crypto Workflow

The One Piece TCG module has individual decks but lacks the crypto workflow implementation.

| Phase         | Status          | Description                            |
| ------------- | --------------- | -------------------------------------- |
| keyExchange   | Not implemented | Players exchange public keys           |
| encrypt       | Not implemented | Players encrypt their individual decks |
| shuffle       | Not implemented | Players shuffle encrypted decks        |
| peek protocol | Implemented     | Cooperative peek at own deck           |

**Tasks:**

- [ ] Wire up keyExchange phase for One Piece
- [ ] Wire up encrypt phase for One Piece
- [ ] Wire up shuffle phase for One Piece
- [ ] Ensure peek protocol works with new crypto flow

---

## Detailed Remediation Tasks

---

### V1: Fix Fake SHA-256 in `sha256Sync` [CRITICAL]

**File:** `packages/frontend/src/crypto/mental-poker/sra.ts`  
**Lines:** 300-316  
**Effort:** Low (1-2 days)

#### Problem

The `sha256Sync` function is NOT SHA-256:

```typescript
// CURRENT (BROKEN)
function sha256Sync(data: Uint8Array): Uint8Array {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0; // djb hash!
  }
  // ...expands to 32 bytes with linear congruential generator
}
```

This is used by `hashToPoint` to map card IDs to curve points, which undermines the entire SRA encryption.

#### Solution

Replace with Web Crypto API:

```typescript
// PROPOSED (SECURE)
async function sha256Async(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

// For synchronous use cases in hash-to-curve, use a proper hash
// The try-and-increment loop can use this async version
async function hashToPointAsync(cardId: string): Promise<Point> {
  const encoder = new TextEncoder();
  const data = encoder.encode(cardId);

  for (let counter = 0; counter < 256; counter++) {
    const input = new Uint8Array(data.length + 1);
    input.set(data);
    input[data.length] = counter;

    const hash = await sha256Async(input);
    const x = uint8ArrayToHex(hash);

    try {
      const point = ec.curve.pointFromX(x, false);
      if (point && point.validate()) {
        return point;
      }
    } catch {
      continue;
    }
  }
  throw new Error(`Failed to hash card ID to curve point: ${cardId}`);
}
```

**Note:** This changes `hashToPoint` to async. All callers must be updated.

#### Tasks

- [ ] Replace `sha256Sync` with async Web Crypto SHA-256
- [ ] Update `hashToPoint` to be async
- [ ] Update all callers of `hashToPoint` to await
- [ ] Add tests verifying hash output matches real SHA-256
- [ ] Verify elliptic curve point derivation is consistent

---

### V2: Fix Private Key Transmission in Coop-Reveal Mode [CRITICAL]

**File:** `packages/frontend/src/game/modules/gofish/crypto.ts`  
**Lines:** 1538-1597 (`submitDecryptionShare`)  
**Effort:** Low (1-2 days)

#### Problem

Private keys are passed as plaintext move arguments:

```typescript
export function submitDecryptionShare(
  G,
  ctx,
  zoneId,
  cardIndex,
  playerId,
  privateKey: string, // EXPOSED!
): CryptoGoFishState | typeof INVALID_MOVE;
```

Any entity with access to game state (including opponent via state logs) can extract private keys.

#### Solution: Send Decrypted Result, Not Key

Instead of sending the private key, players send the **already-decrypted result** from their local computation.

**Protocol flow:**

```
Card has 2 layers (P0 encrypt, P1 encrypt):

1. P1 locally computes: D1 = priv1^(-1) × ciphertext
2. P1 sends D1 (NOT priv1) to game state
3. P0 locally computes: D2 = priv0^(-1) × D1
4. P0 verifies D2 is a valid card in cardPointLookup

If D2 is valid → Chain is proven correct (implicit verification)
If D2 is invalid → P1 cheated → void game, penalize P1
```

**Key insight:** No explicit proof needed. If the final decrypted card is valid, the chain must be correct.

#### New Function Signature

```typescript
// Instead of submitDecryptionShare(privateKey)
// New: submitDecryptedLayer(decryptedCard)
export function submitDecryptedLayer(
  G: CryptoGoFishState,
  ctx: Ctx,
  zoneId: string,
  cardIndex: number,
  playerId: string,
  decryptedCard: EncryptedCard, // Result of decrypt() called LOCALLY
): CryptoGoFishState | typeof INVALID_MOVE {
  // Verify the decrypted card result is on the curve (basic sanity check)
  try {
    ec.curve.decodePoint(decryptedCard.ciphertext, "hex");
  } catch {
    return INVALID_MOVE; // Garbage submitted
  }

  // Store the intermediate result
  const key = `${zoneId}:${cardIndex}`;
  if (!G.crypto.pendingReveals[key]) G.crypto.pendingReveals[key] = {};
  if (G.crypto.pendingReveals[key][playerId]) return INVALID_MOVE;

  G.crypto.pendingReveals[key][playerId] = decryptedCard.ciphertext;

  // If all layers removed (layers === 0), verify final card is valid
  if (decryptedCard.layers === 0) {
    const cardId = lookupCardIdFromPoint(
      G.crypto.cardPointLookup,
      decryptedCard.ciphertext,
    );
    if (cardId) {
      G.crypto.revealedCards[key] = cardId;
    } else {
      // Invalid final card → player cheated
      pushLog(
        G,
        ctx,
        `Invalid card detected from player ${playerId}. Possible cheating.`,
      );
      // Mark for void
    }
  }

  return G;
}
```

**Private key NEVER leaves the player's browser.**

#### Why This Works

For a 2-layer encrypted card:

- P1's layer: `C2 = priv1 × C1`
- P0's layer: `C1 = priv0 × P`

Decryption:

1. P1 computes: `D1 = priv1^(-1) × C2 = priv1^(-1) × (priv1 × C1) = C1`
2. P1 sends D1 (intermediate result, NOT the key)
3. P0 computes: `D2 = priv0^(-1) × D1 = priv0^(-1) × C1 = P`
4. P0 verifies P is in cardPointLookup

**If D2 is valid P, the math proves P1's decryption was correct** — no explicit verification needed.

#### Tasks

- [ ] Rename `submitDecryptionShare` to `submitDecryptedLayer`
- [ ] Change signature: remove `privateKey: string`, add `decryptedCard: EncryptedCard`
- [ ] Remove `decrypt()` call — player does this locally before submitting
- [ ] Add curve point validation on submitted `decryptedCard.ciphertext`
- [ ] Update all callers in gofish, poker, war crypto modules
- [ ] Add test: malicious player submits garbage → detected and penalized

---

### V3: Add Verification of Decryption Shares [CRITICAL]

**File:** `packages/frontend/src/game/modules/gofish/crypto.ts`  
**Effort:** Low (1 day)

#### Problem

With V2 fix (submitting decrypted result instead of key), the verification becomes **implicit**. However, we need to:

1. Detect cheating earlier (before the final card is revealed)
2. Properly handle intermediate states

#### Solution: Implicit Verification via Final Card Validation

**Verification is automatic via the math:**

- If P1 submits valid intermediate D1, then P0 decrypts D1 to get P
- If P is a valid card (in cardPointLookup), the chain is proven
- If P is invalid, P1 cheated → void game, penalize P1

**Additional check:** When receiving intermediate layers, verify the point is on the curve:

```typescript
function isValidCurvePoint(hex: string): boolean {
  try {
    const point = ec.curve.decodePoint(hex, "hex");
    return point && point.validate();
  } catch {
    return false;
  }
}
```

#### Tasks

- [ ] Add `isValidCurvePoint()` helper (sanity check on submitted data)
- [ ] In `submitDecryptedLayer`, validate `decryptedCard.ciphertext` is a valid curve point
- [ ] On final reveal (layers === 0), verify cardId is in cardPointLookup
- [ ] If invalid card detected, mark game for void and log cheater
- [ ] Add tests:
  - Valid decryption chain → passes
  - Garbage intermediate → detected and rejected
  - Wrong final card → detected, game voided

---

### V4: Fix Shamir Key Escrow [HIGH]

**File:** `packages/frontend/src/game/modules/gofish/crypto.ts`  
**Function:** `distributeKeyShares`  
**Effort:** Medium (3-4 days)

#### Problem

Shares are accepted but discarded:

```typescript
export function distributeKeyShares(..., shares: KeyShare[]): CryptoGoFishState | typeof INVALID_MOVE {
  void shares;  // SHARES DISCARDED - NEVER STORED OR VERIFIED
  player.hasDistributedShares = true;
```

Abandonment recovery would fail because shares were never collected.

#### Solution

1. **Actually store shares** in game state
2. **Add commitment phase**: Player publishes `commitment = SHA256(share_i)` for each share
3. **Add verification phase**: During reconstruction, verify each share against its commitment

```typescript
interface StoredKeyShares {
  shares: KeyShare[]; // Actually store these!
  commitments: string[]; // SHA256 of each share for verification
  threshold: number;
  publicKey: string;
}

export function distributeKeyShares(
  G,
  ctx,
  playerId: string,
  shares: KeyShare[],
  commitments: string[],
): CryptoGoFishState | typeof INVALID_MOVE {
  // Validate commitments match shares
  for (let i = 0; i < shares.length; i++) {
    const expectedCommit = await sha256Async(serializeShare(shares[i]));
    if (commitments[i] !== expectedCommit) {
      return INVALID_MOVE; // Commitment mismatch
    }
  }

  // Store shares securely
  if (!G.crypto.playerShares[playerId]) {
    G.crypto.playerShares[playerId] = {
      shares: [],
      commitments,
      threshold: G.crypto.threshold,
      publicKey: G.crypto.publicKeys[playerId],
    };
  }

  player.hasDistributedShares = true;
  // ...
}
```

#### Tasks

- [ ] ~~Define `StoredKeyShares` interface with `shares[]`, `commitments[]`, `threshold`, `publicKey`~~
- [ ] ~~Add `playerShares: Record<string, StoredKeyShares>` to crypto state~~
- [ ] ~~Implement `serializeShare` and `sha256Async` for commitment~~
- [ ] ~~Modify `distributeKeyShares` to:~~
  - ~~Verify commitments match shares~~
  - ~~Store shares and commitments~~
  - ~~Emit event for share distribution~~
- [ ] ~~Implement `reconstructKey` that:~~
  - ~~Verifies each share against commitment~~
  - ~~Reconstructs using proper Shamir interpolation~~
  - ~~Fails if any share is invalid~~
- [ ] ~~Add recovery timeout: if player abandons, others can trigger recovery after N blocks/moves~~
- [ ] ~~Add tests for:~~
  - ~~Valid share submission~~
  - ~~Invalid commitment rejection~~
  - ~~Successful reconstruction~~
  - ~~Failed reconstruction with bad shares~~

**REMOVED:** Shamir escrow is not needed. Abandonment in betting games is handled via economic penalty (stake seizure). Non-betting games can void on abandonment.

---

### V5: Commit-Reveal Shuffle (Not a Concern)

**Status:** Not an issue for non-betting games.

For non-betting games (War, Go Fish, etc.):

- If a player refuses to reveal, the other player can simply leave
- Game can be voided

For betting games:

- Economic penalties via stake seizure apply (handled at contract level)
- Strategic refusal is not a protocol concern

---

### V6: DoS Protection for Merkle Battleship Reveals [MEDIUM]

**File:** `packages/frontend/src/game/modules/gofish/crypto.ts`  
**Effort:** High (5-7 days)

#### Problem

Commit-reveal allows strategic refusal: player commits to seed, observes shuffle effect, reveals only if favorable.

#### Solution Options

**Option A: Force Reveal with Penalty (Recommended for MVP)**

Add a timeout mechanism:

1. After all commits received, start reveal phase timer (e.g., 60 seconds)
2. If player doesn't reveal within timeout, their seed is assumed to be all zeros (still valid but not strategic)
3. Add economic penalty: player who doesn't reveal loses their escrow

```typescript
interface ShuffleState {
  commits: Record<string, string>; // playerId -> SHA256(seed)
  reveals: Record<string, string>; // playerId -> seed (after reveal)
  revealDeadline: number; // Block height or timestamp
  revealTimeout: number; // e.g., 60 seconds
}

// In reveal phase:
export function revealShuffleSeed(
  G,
  ctx,
  playerId: string,
  seed: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  const hash = SHA256(seed);
  if (G.shuffle.commits[playerId] !== hash) {
    return INVALID_MOVE; // Seed doesn't match commitment
  }

  // Check timeout - if deadline passed, reject late reveals
  if (Date.now() > G.shuffle.revealDeadline) {
    // Seed is too late, use fallback (deterministic from known data)
    // or void the game
    return INVALID_MOVE;
  }

  G.shuffle.reveals[playerId] = seed;
  pushLog(G, ctx, `Player ${playerId} revealed shuffle seed.`);

  // If all revealed, compute final seed
  if (Object.keys(G.shuffle.reveals).length === G.playerOrder.length) {
    G.shuffle.finalSeed = xorAllSeeds(Object.values(G.shuffle.reveals));
  }

  return G;
}
```

**Option B: Verifiable Random Function (VRF) - Production**

Replace commit-reveal with VRF:

1. Use Chainlink VRF or similar for verifiable randomness
2. Each round's randomness is publicly verifiable and cannot be manipulated by any player

```typescript
// On-chain VRF for shuffle randomness
async function getVRFRandomness(roundId: string): Promise<string> {
  const vrfCoordinator = await ethers.getContract("VRFCoordinator");
  const randomness = await vrfCoordinator.requestRandomWords(roundId);
  return randomness;
}
```

#### Tasks (Option A - MVP)

- [ ] Add `ShuffleState` interface with `revealDeadline`, `revealTimeout`
- [ ] Implement `xorAllSeeds` function
- [ ] Modify `commitShuffleSeed` to set reveal deadline
- [ ] Modify `revealShuffleSeed` to:
  - Verify seed matches commitment
  - Reject reveals after deadline
  - On timeout, trigger void or use deterministic fallback
- [ ] Add UI countdown timer for reveal phase
- [ ] Add economic penalty tracking (affects settlement)
- [ ] Add tests for:
  - Valid reveal within timeout
  - Late reveal rejection
  - Timeout triggers void

---

### V6: Add DoS Protection for Merkle Battleship Reveals [MEDIUM]

**File:** `packages/frontend/src/game/modules/merkle-battleship/game.ts`  
**File:** `packages/frontend/src/game/modules/merkle-battleship/signals.ts`  
**Effort:** Medium (3-4 days)

#### Problem

Defender can refuse to send `bs_reveal`, permanently deadlocking the game.

#### Solution: Timeout with Automatic Loss

```typescript
interface BattleState {
  // ... existing fields
  pendingGuess?: {
    attackerId: string;
    coordIndex: number;
    sentAt: number; // timestamp
    timeoutBlocks: number; // e.g., 10 blocks = ~2 minutes
  };
}

export function bs_guess(
  G,
  ctx,
  attackerId: string,
  coordIndex: number,
): CryptoMerkleBattleshipState | typeof INVALID_MOVE {
  // ... existing validation ...

  G.battle.pendingGuess = {
    attackerId,
    coordIndex,
    sentAt: Date.now(),
    timeoutBlocks: 10, // 2 minute timeout
  };

  // Signal defender to respond
  sendSignal("bs_reveal", { attackerId, coordIndex, gameId: ctx.matchID });

  return G;
}

export function applyReveal(
  G,
  ctx,
  reveal: GuessReveal,
): CryptoMerkleBattleshipState | typeof INVALID_MOVE {
  // ... existing validation ...

  // Check if timed out
  if (G.battle.pendingGuess) {
    const elapsed = Date.now() - G.battle.pendingGuess.sentAt;
    const timeoutMs = G.battle.pendingGuess.timeoutBlocks * 6000; // ~6s per block
    if (elapsed > timeoutMs) {
      // Defender timed out - automatic miss, penalty
      pushLog(G, ctx, `Defender timed out on reveal. Automatic miss.`);
      G.battle.pendingGuess = null;
      // Defender loses the cell anyway, attacker gains info
      // Could also trigger economic penalty
      return G;
    }
  }

  // ... rest of reveal logic ...
}
```

#### Alternative: Optimistic Reveal

Allow attacker to proceed with **optimistic reveal**:

1. Attacker computes what the reveal SHOULD be based on their knowledge
2. Defender has N blocks to challenge (provide actual reveal)
3. If defender doesn't challenge, optimistic reveal is accepted

#### Tasks

- [ ] Add `pendingGuess.sentAt` and `timeoutBlocks` to state
- [ ] Implement timeout check in `applyReveal`
- [ ] On timeout: mark as miss for attacker, penalize defender
- [ ] Add UI warning when reveal is pending + timeout countdown
- [ ] Add `missByTimeout` counter to player state
- [ ] If `missByTimeout >= 3`, auto-forfeit game
- [ ] Add tests for:
  - On-time reveal (passes)
  - Late reveal (rejected, timeout penalty applied)
  - Multiple timeouts leading to forfeit

---

### V7: Non-Crypto Games Security [HIGH]

**Files:** `packages/frontend/src/game/game.ts`  
**File:** `packages/frontend/src/game/modules/war/game.ts`  
**Effort:** Low (1-2 days for decision)

#### Problem

Non-crypto games (Simple, standard War) have no security:

- `client: true` for SimpleCardGame → moves execute locally without validation
- `client: false` for War but no playerID verification in P2PMaster
- Full state visible to both players including hidden zones

#### Solution Options

**Option A: Remove Non-Crypto Games (Recommended)**

Remove `simple` and standard `war` from the game registry. They serve no purpose in a security-focused platform and provide a false sense of functionality.

**Option B: Document as "Demo/Insecure" Only**

Keep them but clearly label as "Demo Only - No Security":

```typescript
export const SimpleCardGame: Game<SimpleCardGameState> = {
  name: "simple-card-game",
  // ... existing config

  // Add metadata for UI
  securityLevel: "NONE", // or 'DEMO_ONLY'
  description: "Demo only - no cryptographic security. For testing only.",

  // Force all moves through host
  moves: {
    drawCard: {
      client: false, // Always use host
      validate: (G, ctx, playerID) => {
        // Only allow drawing from own deck
        const deck = G.zones[`deck-${playerID}`];
        return deck && deck.length > 0;
      },
    },
    // ... similar for all moves
  },
};
```

#### Tasks (Option B)

- [ ] Change all SimpleCardGame moves to `client: false`
- [ ] Add move-level validation (not just existence check)
- [ ] Add `securityLevel: 'NONE'` metadata to all non-crypto games
- [ ] Add prominent UI warning when playing non-crypto games
- [ ] Document clearly that these games are for testing only

---

### V8: ZK Attestation Scaffolding [MEDIUM - DEFER]

**File:** `packages/frontend/src/game/modules/gofish/crypto.ts`  
**Effort:** Very High (weeks)

#### Problem

ZK attestation mode uses placeholder proofs. Real ZK circuits are not implemented.

#### Recommendation

**Defer** until V1-V4 are fixed. The ZK scaffolding (verifier signatures, payload hashing) is correctly wired. The missing piece is actual circuits, which require:

1. Circom/snarkyjs circuit development
2. Trusted setup (if required)
3. WASM/browser proof generation

For MVP, focus on fixing the broken crypto primitives first.

#### Future Tasks (Post-MVP)

- [ ] Design Circom circuit for Go Fish moves
- [ ] Implement witness generation in TypeScript
- [ ] Set up Phase 2 ceremony for trusted setup
- [ ] Integrate proof generation into `submitZkProof*` functions
- [ ] Add on-chain verifier contract

---

## Implementation Order

### Phase 1: Critical Crypto Fixes (Week 1)

1. **V1** - Fix fake SHA-256 (replace with Web Crypto SHA-256)
2. **V2** - Fix private key transmission (send decrypted result, not key)
3. **V3** - Add verification of decryption shares (implicit via valid card check)

### Phase 2: UI & Demo Labeling (Week 1-2)

4. **V7** - Mark non-crypto games as "Demo Only" on game selection

### Phase 3: Protocol Improvements (Week 2)

5. **V6** - Add DoS protection for Merkle Battleship reveals (timeout mechanism)

### Phase 4: One Piece Crypto Workflow (Week 2-3)

6. **One Piece** - Wire up full crypto workflow:
   - keyExchange phase
   - encrypt phase
   - shuffle phase
   - Verify peek protocol works

### Phase 5: Future (Deferred)

7. **V8** - ZK circuit implementation (DEFERRED indefinitely)

---

## Testing Requirements

Each fix MUST include:

1. **Unit tests** for the specific fix
2. **Integration tests** showing the vulnerability is no longer exploitable
3. **Malicious actor tests** specifically testing:
   - Wrong key decryption attempts
   - Stolen private key scenarios
   - Strategic refusal scenarios
   - State manipulation attempts

Example test structure:

```typescript
describe("Decryption Share Verification", () => {
  it("should accept valid decryption share", () => {
    // Setup honest player with valid key
    // Submit correct share
    // Expect: share accepted, card decrypted correctly
  });

  it("should reject wrong decryption share", () => {
    // Setup honest player with valid key
    // Attacker submits WRONG key
    // Expect: share rejected, game voided, attacker penalized
  });

  it("should detect and penalize malicious corruption", () => {
    // Two players complete encryption
    // Malicious player submits garbage share
    // Expect: game voided, malicious player's escrow seized
  });
});
```

---

## Rollback Plan

If a fix introduces bugs:

1. All changes are tracked in git - rollback to previous commit
2. Feature flags for each crypto mode:
   ```typescript
   const CRYPTO_MODE = process.env.CRYPTO_MODE || "legacy";
   // 'legacy' - original (buggy but functional)
   // 'fixed'  - with security fixes
   ```
3. A/B testing: small percentage of games use new crypto, monitor for failures

---

## Success Criteria

Security remediation is complete when:

- [ ] `sha256Sync` passes official SHA-256 test vectors
- [ ] Private keys never appear in game state or move logs
- [ ] All decryption shares verified before combining
- [ ] Shamir shares properly stored and verifiable
- [ ] Shuffle timeout prevents strategic refusal
- [ ] Merkle Battleship reveals enforced within timeout
- [ ] Non-crypto games either removed or prominently labeled insecure
- [ ] All new security tests pass (including malicious actor tests)
- [ ] Third-party security audit confirms fixes

---

## References

- [OWASP Mental Poker Cheat Sheet](https://cheatsheetseries.owasp.org/)
- [Mental Poker Wikipedia](https://en.wikipedia.org/wiki/Mental_poker)
- [SRA Algorithm Original Paper](https://people.csail.mit.edu/rivest/pubs/SRA81.pdf)
- [Feldman DKG](https://www.cs.cornell.edu/courses/cs754/2001fa/1291060.pdf)
- [Groth16 Proof System](https://eprint.iacr.org/2016/542.pdf)
- [Bayer-Groth Shuffle](https://www.iacr.org/archive/eurocrypt2002/22810229/paper.pdf)
