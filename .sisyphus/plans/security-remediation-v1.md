# ManaMesh Security Remediation Plan

**Date:** 2026-04-08
**Author:** Sisyphus Security Review (updated from analysis)
**Status:** Planned
**Review File:** `SECURITY_REPORT.md`

---

## Executive Summary

This plan addresses critical security vulnerabilities identified in the ManaMesh cryptographic implementations. The vulnerabilities fall into four categories:

| Category                           | Severity | Count |
| ---------------------------------- | -------- | ----- |
| Broken Cryptographic Primitives    | CRITICAL | 2     |
| Insecure Default/Storage Patterns  | CRITICAL | 1     |
| Missing Cryptographic Verification | CRITICAL | 2     |
| Protocol Design Flaws              | HIGH     | 4     |
| DoS Vectors                        | MEDIUM   | 3     |

**Estimated Effort:** 2-3 weeks for full remediation (ZK deferred)

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

**Key property:** Encryption and decryption are **commutative** — order doesn't matter.

---

## Vulnerability Summary

| #   | Vulnerability                                              | Severity | Affected Component                              | Effort   | Status           |
| --- | ---------------------------------------------------------- | -------- | ----------------------------------------------- | -------- | ---------------- |
| V1  | Fake SHA-256 in `sha256Sync`                               | CRITICAL | `crypto/mental-poker/sra.ts`                    | Low      | **FIXED**        |
| V2  | Private keys transmitted in plaintext (demo modes)         | CRITICAL | `war/crypto.ts`, `poker/crypto.ts`, `gofish/`   | Low      | **FIXED**        |
| V3  | No verification of decryption shares                       | CRITICAL | all SRA game modules                            | Low      | **FIXED**        |
| V4  | Shamir escrow not implemented                              | —        | REMOVED — abandonment handled via stake seizure | N/A      | Removed          |
| V5  | Commit-reveal shuffle (not an issue for non-betting games) | —        | N/A                                             | N/A      | Not a concern    |
| V6  | No DoS protection for Merkle Battleship reveals            | MEDIUM   | `merkle-battleship/`                            | Medium   | Pending          |
| V7  | Non-crypto games have zero protection                      | HIGH     | `game.ts`, `war/game.ts`                        | Low      | Pending          |
| V8  | ZK attestation is scaffolding only                         | MEDIUM   | `gofish/crypto.ts`                              | DEFERRED | Deferred         |
| V9  | EC point encoding mismatch (uncompressed vs compressed)    | HIGH     | `sra.ts` vs `secp256k1.ts`                      | Low      | **FIXED**        |
| V10 | Shamir shares transmitted unencrypted                      | MEDIUM   | `shamirs/split.ts`, game state                  | Medium   | **FIXED**        |
| V11 | Math.random() for identifiers                              | MEDIUM   | `war/crypto.ts:953`, `poker/crypto.ts:178`      | Low      | **FIXED**        |
| V12 | DLEQ proofs not enforced at protocol level                 | MEDIUM   | `threshold-tally/logic.ts`                      | Medium   | Already Enforced |
| V13 | Biased random sampling in shuffle and Shamir split         | LOW      | `shuffle-proof.ts`, `shamirs/split.ts`          | Low      | **FIXED**        |
| V14 | Feldman DKG limited to t=2 only                            | LOW      | `feldman-dkg.ts`                                | Medium   | Pending          |
| V15 | DeckPlugin uses Math.random() for shuffling                | MEDIUM   | `game/plugins/deck.ts`                          | Low      | **FIXED**        |

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
**Lines:** ~291-306
**Effort:** Low (1-2 days)

#### Problem

The `sha256Sync` function is NOT SHA-256 — it is a Linear Congruential Generator (LCG):

```typescript
// CURRENT (BROKEN) - DO NOT USE
function sha256Sync(data: Uint8Array): Uint8Array {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0; // LCG — NOT SHA-256!
  }
  // ...expands to 32 bytes with another LCG iteration
}
```

This is used by `hashToPoint` to map card IDs to curve points, which undermines the entire SRA encryption. The comment in the code explicitly admits: "USE A SIMPLE HASH FOR NOW - IN PRODUCTION USE SubtleCrypto - THIS IS A PLACEHOLDER THAT WORKS SYNCHRONOUSLY"

An attacker who can predict or control LCG output can determine which cards map to which curve points, breaking shuffle fairness.

#### Solution

Replace with real SHA-256 from `sha256.ts` and use proper hash-to-curve:

```typescript
// PROPOSED (SECURE) - use existing sha256.ts
import { sha256Hex } from "../../sha256";

async function hashToPointSecure(cardId: string): Promise<Point> {
  const encoder = new TextEncoder();
  const data = encoder.encode(cardId);

  for (let counter = 0; counter < 256; counter++) {
    const input = new Uint8Array(data.length + 1);
    input.set(data);
    input[data.length] = counter;

    const hash = sha256Hex(input); // Real SHA-256
    const x = hash.slice(0, 64); // First 64 hex chars = 32 bytes

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

**Note:** `sha256Hex` from `sha256.ts` is synchronous and already in the codebase. `hashToPoint` can remain synchronous.

#### Alternative: Precomputed Point Lookup

Since `buildCardPointLookup` is already async and called during game setup, the most robust fix is to precompute all 52 card→point mappings during setup using the real SHA-256 and store them in `cardPointLookup`. Then `hashToPoint` is only needed for troubleshooting/debugging.

```typescript
// During game setup - compute all card points once
const lookup = await buildCardPointLookup(cardIds); // Already exists
// Uses real SHA-256 via SubtleCrypto inside buildCardPointLookup
```

#### Tasks

- [ ] Replace `sha256Sync` body with call to `sha256Hex` from `sha256.ts`
- [ ] Verify `hashToPoint` uses real SHA-256 (not LCG)
- [ ] Verify all 52 cards map deterministically to valid curve points
- [ ] Add tests: same cardId always maps to same point (determinism)
- [ ] Add tests: SHA-256 output matches official test vectors

---

### V2: Fix Private Key Transmission in Plaintext (Demo Modes) [CRITICAL]

**Files:**

- `packages/frontend/src/game/modules/war/crypto.ts` (~line 572-577)
- `packages/frontend/src/game/modules/poker/crypto.ts` (peekHoleCards, tryDecryptCommunityCard)
- `packages/frontend/src/game/modules/gofish/crypto.ts` (~line 732-735)

**Effort:** Low (1-2 days)

#### Problem

Demo modes store private keys directly in shared game state:

```typescript
// war/crypto.ts (DEMO ONLY)
if (!G.crypto.privateKeys) G.crypto.privateKeys = {};
G.crypto.privateKeys[playerId] = privateKey; // ANY PLAYER CAN READ THIS
```

```typescript
// gofish/crypto.ts (demo-private mode)
if (G.securityMode === "demo-private") {
  if (!G.crypto.privateKeys) G.crypto.privateKeys = {};
  G.crypto.privateKeys[playerId] = privateKey; // STORED IN SHARED STATE
}
```

All players can read game state, meaning any player can extract their opponent's private keys and decrypt all cards independently — completely defeating the mental poker protocol.

#### Solution

1. **Remove private key storage from game state entirely**
2. **Keep private keys in browser memory only** (never serialized to game state)
3. **Game modules should use coop-reveal mode only** for production

```typescript
// distributeKeyShares - SECURE version
export function distributeKeyShares(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  shares: KeyShare[],
): CryptoGoFishState | typeof INVALID_MOVE {
  // SHARES are stored (for escrow recovery) but private key NEVER is
  void shares; // Accepted but not stored in demo mode

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasDistributedShares) return INVALID_MOVE;

  player.hasDistributedShares = true;

  // In production: shares go to OTHER players via secure channel
  // NOT placed in shared game state

  // ... rest unchanged
}
```

Add runtime enforcement:

```typescript
// At top of distributeKeyShares
if (G.securityMode !== "demo-private") {
  // Refuse to store private key in any non-demo mode
  if (privateKey && G.crypto.privateKeys?.[playerId]) {
    console.error("SECURITY: Attempt to store private key in shared state");
    return INVALID_MOVE;
  }
}
```

#### Tasks

- [ ] Remove all `G.crypto.privateKeys[playerId] = privateKey` assignments
- [ ] Add runtime check: if mode !== "demo-private", reject any privateKey in game state
- [ ] Add `securityMode` validation in War and Poker crypto modules (not just Go Fish)
- [ ] Update UI to clearly warn when demo mode is active
- [ ] Add tests: private key never appears in serialized game state

---

### V3: Add Verification of Decryption Shares [CRITICAL]

**Files:** All SRA game modules (`gofish/crypto.ts`, `poker/crypto.ts`, `war/crypto.ts`)
**Effort:** Low (1 day)

#### Problem

When players submit decryption shares, the game accepts them without verifying the player actually applied their key correctly. A malicious player can submit a bogus partial decryption and the game will accept it as long as the final result looks like a valid card.

#### Solution: Implicit Verification via Final Card Validation

**Verification is automatic via the math:**

For a 2-layer encrypted card C = priv1(priv0(P)):

1. P1 computes: D1 = priv1^(-1) × C = priv0(P)
2. P1 sends D1 (NOT their private key)
3. P0 computes: D2 = priv0^(-1) × D1 = P
4. P0 verifies P is in cardPointLookup

If D2 is a valid card, the math proves P1's decryption was correct.

Add explicit validation:

```typescript
function isValidCurvePoint(hex: string): boolean {
  try {
    const point = ec.curve.decodePoint(hex, "hex");
    return point && point.validate();
  } catch {
    return false;
  }
}

// In submitDecryptedLayer or equivalent:
if (!isValidCurvePoint(decryptedCard.ciphertext)) {
  return INVALID_MOVE; // Garbage submitted
}
```

#### Tasks

- [ ] Add `isValidCurvePoint()` helper using elliptic's validate()
- [ ] Validate all submitted decryption shares are valid curve points before accepting
- [ ] On final reveal (layers === 0), verify cardId is in cardPointLookup
- [ ] If invalid card detected, mark game as `voided`
- [ ] Add tests: garbage intermediate → detected and rejected

---

### V9: Fix EC Point Encoding Mismatch [HIGH]

**Files:** `packages/frontend/src/crypto/mental-poker/sra.ts` vs `packages/frontend/src/crypto/secp256k1.ts`
**Effort:** Low (1 day)

#### Problem

- `sra.ts` encrypt() outputs **uncompressed** points: `encrypted.encode("hex", false)`
- `secp256k1.ts` helpers normalize to **compressed** format: `p.encode("hex", true)`
- `decryptToCardId()` does hex string comparison of ciphertexts

If encrypt produces uncompressed but `cardPointLookup` uses compressed (from `buildCardPointLookup`), **lookup will always fail silently**.

#### Solution

Standardize on compressed encoding everywhere:

```typescript
// sra.ts - encrypt()
return {
  ciphertext: encrypted.encode("hex", true).slice(2), // compressed, no 02/03 prefix
  layers: currentLayers + 1,
};
```

Or normalize via `secpPointNormalizeHex` before all comparisons:

```typescript
// In decryptToCardId:
const normalizedCiphertext = secpPointNormalizeHex(decrypted.ciphertext);
const cardId = lookupCardIdFromPoint(
  G.crypto.cardPointLookup,
  normalizedCiphertext,
);
```

#### Tasks

- [ ] Audit all point encoding paths: encrypt, decrypt, cardPointLookup, decryptToCardId
- [ ] Choose one encoding standard (compressed recommended)
- [ ] Add `secpPointNormalizeHex` before all hex string comparisons
- [ ] Add round-trip tests: encrypt → decrypt → cardId lookup succeeds for all 52 cards

---

### V10: Encrypt Shamir Shares Before Distribution [MEDIUM]

**Files:** `packages/frontend/src/crypto/shamirs/split.ts`, game modules
**Effort:** Medium (2-3 days)

#### Problem

KeyShare objects are placed in game state and broadcast via P2P. Any network observer (MITM, malicious peer) can collect shares and reconstruct private keys if they reach threshold.

The code has an `encryptedShare` field in types but never uses it.

#### Solution

1. Encrypt each share to the recipient's public key before distributing
2. Use ECIES or similar (can use the existing SRA encryption)

```typescript
// In createKeyShares:
for (const share of shares) {
  // Encrypt share to recipient's public key
  const encryptedShare = encrypt(share, recipientPublicKey);
  sharePackage.encryptedShares.push(encryptedShare);
}
```

#### Tasks

- [ ] Implement share encryption using recipient's public key
- [ ] Add `encryptedShare` field population in `createKeyShares`
- [ ] Decrypt shares on receipt before using for reconstruction
- [ ] Document: shares transmitted via game state should use secure channel

---

### V11: Replace Math.random() for Identifiers [MEDIUM]

**Files:**

- `packages/frontend/src/game/modules/war/crypto.ts:953`
- `packages/frontend/src/game/modules/poker/crypto.ts:178`

**Effort:** Low (1 hour)

#### Problem

```typescript
// war/crypto.ts
const requestId = `decrypt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// poker/crypto.ts
const handId = `hand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

`Math.random()` is predictable. An attacker who observes game state can predict IDs and potentially craft replay attacks.

#### Solution

Replace with `crypto.randomUUID()` (available in modern browsers and Node 14.17+):

```typescript
const requestId = `decrypt-${Date.now()}-${crypto.randomUUID()}`;
const handId = `hand-${Date.now()}-${crypto.randomUUID()}`;
```

#### Tasks

- [ ] Replace all `Math.random()` in crypto-relevant code paths
- [ ] Search entire codebase for `Math.random()` usage
- [ ] Prioritize replacement in any code handling identifiers, tokens, or secrets

---

### V12: Enforce DLEQ Proofs in Threshold Tally [MEDIUM]

**File:** `packages/frontend/src/game/modules/threshold-tally/logic.ts`
**Effort:** Medium (2-3 days)

#### Problem

The DLEQ proof implementation exists in `dleq.ts` and is called in `submitDecryptShare`, but there may be code paths where partial decryptions are accepted without proof verification.

#### Solution

Audit and enforce DLEQ verification on every partial decrypt submission:

```typescript
// In submitDecryptShare:
const verified = dleqVerify(params.proof, {
  y1: combinedC1, // g^secret
  y2: y2Hex, // base2^secret
  a1: params.proof.a1Hex,
  a2: params.proof.a2Hex,
  z: params.proof.zHex,
  context: "threshold-tally-decrypt",
});

if (!verified) {
  return INVALID_MOVE; // Reject fraudulent partial
}
```

#### Tasks

- [ ] Audit all partial decrypt acceptance code paths in threshold-tally
- [ ] Ensure DLEQ verification is ALWAYS run (no bypass paths)
- [ ] Add test: submit invalid DLEQ proof → rejected
- [ ] Add test: valid DLEQ proof → accepted

---

### V13: Fix Biased Random Sampling [LOW]

**Files:** `shuffle-proof.ts`, `shamirs/split.ts`
**Effort:** Low (1 day)

#### Problem

```typescript
// shuffle-proof.ts - Fisher-Yates swap index
const j =
  (randomBytes[0] | (randomBytes[1] << 8) | (randomBytes[2] << 16)) % (i + 1);

// shamirs/split.ts - random coefficient
return result % max; // Simple modulo - slight bias
```

Simple modulo reduction introduces bias. For tournament-level fairness, use rejection sampling.

#### Solution

```typescript
// Unbiased index selection
function nextUnbiasedIndex(max: number): number {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const range = max + 1;
  const cutoff = 256 ** 4 % range;
  let value = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  if (value < cutoff) {
    return nextUnbiasedIndex(max); // Reject and retry
  }
  return value % range;
}
```

#### Tasks

- [ ] Replace modulo-based index selection with rejection sampling in shuffle-proof.ts
- [ ] Replace modulo-based random in shamirs/split.ts with rejection sampling
- [ ] Add tests verifying uniform distribution (chi-squared test)

---

### V14: Extend Feldman DKG Beyond t=2 [LOW]

**File:** `packages/frontend/src/crypto/feldman-dkg.ts`
**Effort:** Medium (3-4 days)

#### Problem

Code comment explicitly states: `// Feldman VSS / DKG primitives for threshold t=2 (degree 1).`

If larger thresholds are needed (e.g., 3-of-5), the current implementation cannot support it.

#### Solution

Generalize polynomial degree to support arbitrary threshold t:

```typescript
interface FeldmanVSS {
  // Polynomial of degree (threshold - 1)
  // Commitments: [g^a0, g^a1, ..., g^a(t-1)]
  commitments: string[]; // One per coefficient
}

// dkgMakeDealerSecrets(threshold: number): generates t coefficients
// dkgEvaluateShare(commitments, x, threshold): returns share = f(x)
// dkgVerifyShare(commitments, x, share, threshold): verifies
```

#### Tasks

- [ ] Generalize polynomial to arbitrary degree
- [ ] Update commitment array to hold t coefficients
- [ ] Update evaluate and verify functions for threshold > 2
- [ ] Add tests for t=3, t=4 scenarios

---

### V15: DeckPlugin Uses Math.random() [MEDIUM]

**File:** `packages/frontend/src/game/plugins/deck.ts`
**Effort:** Low (1 hour)

#### Problem

```typescript
// deck.ts - fisherYatesShuffle
const j = Math.floor(Math.random() * (i + 1));
```

For non-crypto games this is acceptable, but if the deck plugin is ever used in a crypto context, this introduces predictability.

#### Solution

```typescript
// Use crypto.getRandomValues
function fisherYatesShuffle<T>(arr: T[], getRandom: () => number): T[] {
  // ... same algorithm, but getRandom must be uniform [0,1)
}

// Caller provides:
const shuffle = (arr) =>
  fisherYatesShuffle(
    arr,
    () => crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff,
  );
```

#### Tasks

- [ ] Replace `Math.random()` in deck.ts with `crypto.getRandomValues`
- [ ] Verify no callers depend on seeded/deterministic behavior

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

## Implementation Order

### Phase 1: Critical Crypto Fixes (Week 1)

1. **V1** - Fix fake SHA-256 (replace with sha256.ts)
2. **V9** - Fix EC point encoding mismatch
3. **V2** - Remove private key storage from game state
4. **V3** - Add verification of decryption shares (implicit via valid card check)

### Phase 2: Low-Hanging Fruit (Week 1)

5. **V11** - Replace Math.random() with crypto.randomUUID()
6. **V15** - Replace Math.random() in DeckPlugin

### Phase 3: Protocol Improvements (Week 2)

7. **V10** - Encrypt Shamir shares before distribution
8. **V12** - Enforce DLEQ proofs in Threshold Tally
9. **V13** - Fix biased random sampling (rejection sampling)

### Phase 4: Merkle & DoS (Week 2)

10. **V6** - Add DoS protection for Merkle Battleship reveals (timeout mechanism)

### Phase 5: One Piece Workflow (Week 2-3)

11. **One Piece** - Wire up full crypto workflow

### Phase 6: Future (Deferred)

12. **V14** - Extend Feldman DKG beyond t=2
13. **V8** - ZK circuit implementation (DEFERRED indefinitely)

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
   - Biased random detection

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
    // Expect: share rejected, game voided
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

- [ ] `sha256Sync` passes official SHA-256 test vectors (replaced with sha256.ts)
- [ ] Private keys never appear in game state or move logs
- [ ] All decryption shares verified before combining
- [ ] Shamir shares properly stored and verifiable
- [ ] Shuffle timeout prevents strategic refusal
- [ ] Merkle Battleship reveals enforced within timeout
- [ ] Non-crypto games either removed or prominently labeled insecure
- [ ] All new security tests pass (including malicious actor tests)
- [ ] EC point encoding normalized across all crypto modules
- [ ] Math.random() replaced with crypto.randomUUID() in all crypto paths
- [ ] Third-party security audit confirms fixes

---

## References

- [OWASP Mental Poker Cheat Sheet](https://cheatsheetseries.owasp.org/)
- [Mental Poker Wikipedia](https://en.wikipedia.org/wiki/Mental_poker)
- [SRA Algorithm Original Paper](https://people.csail.mit.edu/rivest/pubs/SRA81.pdf)
- [Feldman DKG](https://www.cs.cornell.edu/courses/cs754/2001fa/1291060.pdf)
- [Groth16 Proof System](https://eprint.iacr.org/2016/542.pdf)
- [Bayer-Groth Shuffle](https://www.iacr.org/archive/eurocrypt2002/22810229/paper.pdf)
- [RFC 9380 - Hashing to Elliptic Curves](https://www.rfc-editor.org/rfc/rfc9380)
