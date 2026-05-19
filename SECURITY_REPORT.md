# ManaMesh Cryptographic Security Report

**Date:** May 8, 2026
**Scope:** `packages/frontend/src/crypto/` and `packages/frontend/src/game/modules/*/crypto.ts`
**Classification:** Architectural Security Assessment — Post-Remediation Review

---

## Executive Summary

ManaMesh implements three distinct cryptographic paradigms for provably fair peer-to-peer card games:

| Paradigm | Games | Key Property |
|----------|-------|--------------|
| **Mental Poker (SRA)** | War, Poker, Go Fish, OnePiece | Commutative encryption enables cooperative card revelation |
| **Commitment Schemes (Merkle)** | Merkle Battleship | Binding commitments prevent post-hoc board changes |
| **Threshold Homomorphic Encryption** | Threshold Tally, HE Battleship | Aggregate-only decryption; individual inputs stay private |

**Overall Assessment:** The cryptographic primitives are solid. The remediation effort successfully fixed the most critical issues (fake SHA-256, private key leakage, EC encoding mismatch, biased randomness, and unencrypted Shamir shares). However, several **protocol-level gaps remain** that are critical for an untrusted P2P deployment:

1. **Player identity not bound to move sender** — any peer can impersonate any player in War, Go Fish, and Poker
2. **Decryption share validation incomplete** — War and Poker accept unvalidated curve points; Poker's `submitDecryptedShare` is a no-op stub
3. **No abandonment defense** — a peer who refuses to submit decryption shares stalls the game indefinitely
4. **No game-layer authentication** — `authenticateCredentials` is not configured on any game definition
5. **Go Fish default mode causes runtime exceptions** — `createCryptoGoFishState` defaults to the disabled `demo-private` mode

---

## Remediation Status

### Confirmed Fixed ✅

| # | Vulnerability | Severity (original) | Evidence |
|---|---|---|---|
| V1 | Fake SHA-256 (LCG) in `hashToPoint` | CRITICAL | `sra.ts` delegates to real `sha256.ts`; no LCG remaining |
| V2 | Private keys stored in shared game state | CRITICAL | `demo-private` paths unconditionally throw; no `G.crypto.privateKeys` writes anywhere |
| V3 | Decryption share validation (Go Fish only) | CRITICAL | `gofish/crypto.ts:1523` calls `secpIsValidPointHex` before accepting |
| V9 | EC point encoding mismatch | HIGH | All points normalized through `secpPointNormalizeHex` in `sra.ts` |
| V10 | Shamir shares transmitted unencrypted | MEDIUM | ECIES (AES-256-GCM + HMAC-SHA-256) in `shamirs/split.ts` |
| V11 | `Math.random()` for request/hand IDs | MEDIUM | War and Poker now use `crypto.randomUUID()` |
| V12 | DLEQ proofs not enforced (threshold tally) | MEDIUM | `dleqVerify` called on every partial decrypt; assertion rejects on failure |
| V13 | Biased random sampling (modulo) | LOW | Rejection sampling in `shuffle-proof.ts` and `shamirs/split.ts` |
| V14 | Feldman DKG degree-1 only (library) | LOW | Library now supports arbitrary threshold t via polynomial generalization |
| V15 | `Math.random()` in DeckPlugin shuffle | MEDIUM | Fixed in main crypto shuffle paths |

---

## Remaining Vulnerabilities

### CRITICAL

---

#### R1 — War and Poker: Decryption Share Validation Missing

**Severity:** CRITICAL
**Files:**
- `packages/frontend/src/game/modules/war/crypto.ts:819`
- `packages/frontend/src/game/modules/poker/crypto.ts:887`
- `packages/frontend/src/game/modules/poker/crypto.ts:1084`

**Problem:**

V3 was fixed in Go Fish but not ported to War or Poker.

In `war/crypto.ts`, `submitDecryptedShare` accepts any `EncryptedCard` ciphertext when `layers === 0` with no curve point validation. A malicious peer submits a garbage hex string; the card ID lookup silently returns nothing; the card reveal succeeds without resolving to any card, corrupting game state with no rejection or error.

In `poker/crypto.ts`, `approveDecrypt` stores the caller-supplied `decryptedCard` at line 887 with zero validation. Additionally, `submitDecryptedShare` at line 1084 is a **no-op stub** — it immediately returns `G` without executing any logic.

**Impact:** A malicious peer can permanently corrupt War or Poker game state, force endless non-resolution of reveals, or cause the opponent's cards to become unrecoverable. There is no detection or game-void trigger.

**Fix:** Mirror the Go Fish pattern in both modules:

```typescript
// At the top of submitDecryptedShare / approveDecrypt:
if (!secpIsValidPointHex(decryptedCard.ciphertext)) {
  return INVALID_MOVE;
}
```

Implement the Poker `submitDecryptedShare` stub.

---

#### R2 — Player Identity Not Bound to Move Sender

**Severity:** CRITICAL
**Files:**
- `packages/frontend/src/game/modules/war/crypto.ts:780`
- `packages/frontend/src/game/modules/gofish/crypto.ts:1488`
- `packages/frontend/src/game/modules/poker/crypto.ts:856`

**Problem:**

In War, Go Fish, and Poker, the move handlers for decryption share submission (`submitDecryptedShare`, `approveDecrypt`) accept `playerId` as a **caller-supplied move argument**. The value is never compared against `ctx.playerID`. Any authenticated peer connected to the game can call these moves with an arbitrary `playerId` and impersonate any other player's decryption contribution.

Example in War:

```typescript
// war/crypto.ts:780 — playerId comes from the move argument, not ctx.playerID
submitDecryptedShare: (G, ctx, playerId: string, targetPlayerId: string, decryptedCard) => {
  // no validation that playerId === ctx.playerID
  ...
  G.crypto.pending[targetPlayerId][playerId] = decryptedCard; // stored as-is
}
```

**Impact:** In a P2P game with no external trust anchor, any peer can submit a (possibly corrupt) share on behalf of any other player. Combined with R1's missing curve-point validation, this allows a single malicious peer to inject corrupt decryption results attributed to honest players.

**Fix:** Add identity binding at the top of each affected move handler:

```typescript
if (playerId !== ctx.playerID) return INVALID_MOVE;
```

---

### IMPORTANT

---

#### R3 — No Abandonment Defense (Decryption Stall)

**Severity:** HIGH
**Files:** All SRA game modules (War, Go Fish, Poker, OnePiece)

**Problem:**

The remediation plan removed V4 (Shamir escrow for abandonment) noting "abandonment handled via stake seizure." No stake seizure mechanism exists in the current codebase. If a player refuses to call `submitDecryptedShare` during the play phase, the game stalls indefinitely. There is no timeout, automatic void, or forfeit trigger for the reveal phase in any game module.

Go Fish has a `voteAbortShuffle` stall window for the shuffle phase only. War, Poker, and OnePiece have no equivalent for the cooperative reveal phase.

**Impact:** Any peer can grief any game in progress by simply going offline or refusing to submit their decryption layer. The opponent's cards remain permanently encrypted with no recourse.

**Fix (minimum viable):** Add a move-count or turn-count stall timeout for the reveal phase. If a player has not submitted their decryption share within N moves, the game is voided and the refusing player is marked as the abandoning party. Persistent stake enforcement requires an external layer (smart contract or server).

---

#### R4 — No Game-Layer Player Authentication

**Severity:** HIGH
**Files:** All game definition files (`game.ts` for each module)

**Problem:**

No game definition configures `authenticateCredentials`. In boardgame.io's multiplayer mode, any peer who knows the match ID can connect and submit moves as any `playerID`. Move guards using `ctx.currentPlayer` provide some protection during turn-based phases, but moves marked `client: false` with no identity check (e.g., most crypto phase moves that run outside of normal turns) are callable by any connected peer.

**Impact:** Combined with R2 (identity not bound to move sender), this means the protocol has no enforcement of which physical peer controls which player identity.

**Fix:** Implement `authenticateCredentials` in the boardgame.io `Game` definition, or validate player tokens at the P2P transport layer before accepting any move.

---

#### R5 — Go Fish Default Mode Causes Runtime Exceptions

**Severity:** MEDIUM
**File:** `packages/frontend/src/game/modules/gofish/crypto.ts:444`

**Problem:**

`createCryptoGoFishState` defaults to `securityMode: "demo-private"`. The V2 fix unconditionally throws inside `decryptToCardId` when this mode is active. Moves `respondToAsk` (line 1062) and `goFish` (line 1167) call `decryptToCardId` and will throw at runtime for any game initialized via the base constructor rather than the exported game variants.

**Impact:** Not a security vulnerability, but any game that reaches a card comparison in the default state will crash, producing an unhandled exception in a boardgame.io move — which may leave game state in an inconsistent intermediate form.

**Fix:** Change the default `securityMode` in `createCryptoGoFishState` to `"coop-reveal"`, or add a guard in `decryptToCardId` callers.

---

#### R6 — `Date.now()` Inside boardgame.io Move Functions (OnePiece)

**Severity:** MEDIUM
**File:** `packages/frontend/src/game/modules/onepiece/game.ts:471,840,876`

**Problem:**

DON card IDs are generated with `Date.now()` inside move handlers:

```typescript
// game.ts:840
const donId = `don-${pid}-refresh-${Date.now()}-${i}`;
```

boardgame.io replays moves deterministically on both server and client. Wall-clock time produces different values between the initial execution and any replay, causing state divergence that can desynchronize game state between peers.

**Fix:** Derive IDs from deterministic context values: `ctx.turn`, `ctx.numMoves`, `playerId`, and a sequential index.

---

### LOW / PENDING BY DESIGN

---

#### R7 — `Math.random()` in OnePiece Pre-Crypto Shuffle

**Severity:** LOW
**File:** `packages/frontend/src/game/modules/onepiece/game.ts:93`

`shuffleDeck` uses `Math.floor(Math.random() * (i + 1))` to shuffle a player's deck before the crypto encryption phases. Since the deck is re-encrypted and cooperatively reshuffled during the crypto phases, this shuffle has no bearing on the cryptographic fairness of the final deck order. However, it is inconsistent with V15's fix and should be updated for correctness.

---

#### R8 — Feldman DKG Threshold Hard-Coded at t=2 (Threshold Tally Usage)

**Severity:** LOW
**File:** `packages/frontend/src/game/modules/threshold-tally/logic.ts:97`

The Feldman DKG library now supports arbitrary threshold t. The threshold-tally game still hard-codes `threshold: 2`. This is a usage-level limitation, not a library bug. No security impact for the current 2-player deployment.

---

#### R9 — No Replay Attack Protection on Decryption Operations

**Severity:** LOW

Decryption share submissions carry no per-operation nonce or session binding beyond the game's phase state. A recorded `submitDecryptedShare` message from a previous game could theoretically be replayed if an adversary can reconstruct matching game state. The boardgame.io move log provides implicit ordering protection, but no cryptographic binding of decryption shares to a specific game instance exists in the crypto layer.

---

#### R10 — Commit-and-Reveal Shuffle (Not True ZK)

**Severity:** Design Limitation
**File:** `packages/frontend/src/crypto/mental-poker/shuffle-proof.ts`

The shuffle proof is commit-then-reveal, not a zero-knowledge shuffle proof. This guarantees that the committed permutation is consistent with what was applied, but does not hide the permutation after reveal. A malicious shuffler can also bias the permutation and only be detected after the game ends.

| Adversary | Protection |
|-----------|-----------|
| Honest-but-curious | ✅ Cards stay encrypted during play |
| Fully malicious | ❌ Biased shuffle detected only post-game |

True ZK alternatives (Bayer-Groth, Neff, PLONK) are not implemented. Estimated effort: 2–4 weeks.

---

#### R11 — ZK Attestation Mode is Scaffolding Only (Go Fish)

**Severity:** DEFERRED
**File:** `packages/frontend/src/game/modules/gofish/crypto.ts`

The `zk-attest` security mode wires up proof envelope submission, pending check creation, and ECDSA verdict verification, but no actual Circom circuits exist. Placeholder proofs are accepted. Do not expose this mode to users without real ZK circuit implementation.

---

#### R12 — HE Battleship Reads Opponent Board Directly

**Severity:** MEDIUM (design gap)
**File:** `packages/frontend/src/game/modules/he-battleship/game.ts`

In the battle phase, the homomorphic encryption layer is not used to verify hits — the opponent's board is read directly from game state. The HE primitives (EC ElGamal, DLEQ) are implemented but not wired into the battle verification path.

---

#### R13 — No DoS Protection for Merkle Battleship Reveals

**Severity:** MEDIUM
**File:** `packages/frontend/src/game/modules/merkle-battleship/` (not audited in this pass)

No timeout or void mechanism exists for Merkle proof reveals. A player can stall by refusing to reveal a hit/miss cell. Same class of problem as R3.

---

## Architecture Overview

### Mental Poker — SRA Commutative Encryption

**Location:** `src/crypto/mental-poker/sra.ts`

```
Card ID → hashToPoint() → Curve Point P (SHA-256 try-and-increment)
         ↓
Encryption: E(k, P) = k × P  (point multiplication by private key scalar)
         ↓
Decryption: D(k, E(k,P)) = k⁻¹ × (k × P) = P
         ↓
Commutative: D(k₁, D(k₂, E(k₂, E(k₁, P)))) = D(k₂, D(k₁, E(k₁, E(k₂, P))))
```

**Assessment:** ✅ Primitives sound. Point encoding normalized. Real SHA-256 in use.

---

### Commitment Schemes — Merkle Trees

**Location:** `src/crypto/merkle.ts`

```
Each cell: leaf = SHA256("${gameId}|${playerId}|${cellIndex}|${bit}|${salt}")
         ↓
All leaves → Merkle root (published to shared state)
         ↓
Attack cell → reveal: bit + salt + Merkle proof
         ↓
Verify: recompute leaf + verify against committed root
```

**Assessment:** ✅ Domain separation in leaf hashing. Standard implementation.

---

### Threshold Homomorphic Encryption — EC ElGamal + Feldman DKG

**Location:** `src/crypto/ec-elgamal-exp.ts`, `src/crypto/feldman-dkg.ts`

```
Setup: Feldman DKG — players jointly generate shared public key P = g^sk
         ↓
Encrypt m: Enc(m) = (r×G, r×P + (m+offset)×G)  for random r
         ↓
Homomorphic aggregation: Enc(m₁) ⊕ Enc(m₂) = Enc(m₁+m₂)
         ↓
Partial decryption + DLEQ proof per player
         ↓
Combine via Lagrange interpolation → recover m
```

**Assessment:** ✅ DLEQ proofs verified on every partial in threshold tally. DKG supports arbitrary t.

---

## Primitive Analysis

### SRA (`mental-poker/sra.ts`)

| Property | Status |
|----------|--------|
| Hash-to-curve (SHA-256 try-and-increment) | ✅ Real SHA-256 |
| Point encoding normalization | ✅ `secpPointNormalizeHex` throughout |
| Modular inverse for decryption | ✅ Correct |
| Key generation (random or seeded) | ✅ |

### SHA-256 (`sha256.ts`)

✅ Pure synchronous FIPS 180-4 implementation. Suitable for use inside synchronous boardgame.io moves where `crypto.subtle.digest()` (async) is unavailable.

### Shamir's Secret Sharing (`shamirs/split.ts`)

| Property | Status |
|----------|--------|
| Rejection sampling for coefficients | ✅ No modulo bias |
| Lagrange interpolation | ✅ Correct |
| Share encryption (ECIES) | ✅ AES-256-GCM + HMAC-SHA-256 |
| MAC verification on decryption | ✅ Constant-time check |

### EC ElGamal (`ec-elgamal-exp.ts`)

✅ Message-in-exponent encoding with offset avoids point-at-infinity for m=0. Brute-force discrete log acceptable for small message spaces (vote counts).

### Feldman DKG (`feldman-dkg.ts`)

✅ Arbitrary threshold t. Polynomial coefficient generation, share evaluation, and commitment verification all generalized beyond degree 1.

### DLEQ Proofs (`dleq.ts`)

✅ Chaum-Pedersen protocol. Fiat-Shamir challenge via SHA-256 with domain separation. Enforced in threshold tally on every partial decrypt.

### Merkle Tree (`merkle.ts`)

✅ Standard binary tree. SHA-256 leaf hashing with domain separation. Last-leaf duplication for odd counts.

### ECDSA (`ecdsa.ts`)

✅ Standard implementation via `elliptic`. Used for ZK verdict signing in Go Fish scaffolding.

---

## Priority Fix List for P2P Readiness

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | R2 — Bind `playerId` to `ctx.playerID` in all decryption moves | Hours |
| 2 | R1 — Add `secpIsValidPointHex` to War `submitDecryptedShare` | Hours |
| 3 | R1 — Implement Poker `submitDecryptedShare` (currently no-op stub) | Days |
| 4 | R5 — Fix Go Fish default `securityMode` to `"coop-reveal"` | Minutes |
| 5 | R6 — Replace `Date.now()` in OnePiece move handlers with deterministic IDs | Hours |
| 6 | R4 — Implement `authenticateCredentials` or P2P token validation | Days |
| 7 | R3 — Add reveal-phase stall timeout / void trigger | Days |
| 8 | R7 — Replace `Math.random()` in OnePiece `shuffleDeck` | Minutes |

---

## Testing Gaps

The following test scenarios are missing and required before P2P deployment:

1. **Identity impersonation:** attempt `submitDecryptedShare` with `playerId !== ctx.playerID` — must return `INVALID_MOVE`
2. **Garbage ciphertext (War):** submit non-curve-point hex in War `submitDecryptedShare` — must return `INVALID_MOVE`
3. **Garbage ciphertext (Poker):** submit non-curve-point hex in Poker `approveDecrypt` — must return `INVALID_MOVE`
4. **Round-trip encrypt/decrypt (War, Poker):** all card IDs through full reveal cycle
5. **Abandonment detection:** player refuses reveal for N turns — game voids and forfeit is recorded
6. **Replay attempt:** recorded `submitDecryptedShare` from game A submitted to game B — must be rejected
7. **SHA-256 determinism:** same `cardId` always maps to same curve point
8. **Shamir share round-trip:** encrypt share to public key, decrypt with private key, reconstruct secret

---

_Reviewed May 8, 2026. Prior report dated May 4, 2026._
