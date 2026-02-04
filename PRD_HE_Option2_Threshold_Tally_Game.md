# PRD: Option 2 — Threshold Homomorphic Tally Game (No ZK Circuit)

## 1) Overview

### Working Title

Threshold Tally Arena

### One-liner

A small, replayable game module that demonstrates homomorphic addition by tallying private player inputs under encryption, with threshold decryption and verifiable decryption shares (no zkSNARK circuit).

### Why This Demo

Additive homomorphic encryption is easiest to understand when the only public output is a sum. This module makes the cryptographic capability the core mechanic: players submit secret values; everyone can combine ciphertexts; the group decrypts only the final aggregate.

## 2) Goals

### Primary Goals

- Demonstrate additive homomorphism end-to-end in the browser: `Enc(a) * Enc(b) = Enc(a+b)`.
- Ensure no single player can decrypt other players' submissions (threshold decryption).
- Ensure decryption is verifiable: players can detect incorrect decryption shares.
- Ensure no single player ever learns the full private key: use true distributed key generation (DKG).
- Keep the module playable (not just a cryptography widget).

### Non-Goals

- Not a general-purpose FHE framework.
- Not a high-throughput / low-latency cryptosystem benchmark.
- Not designed for offline/absent players (threshold decryption requires enough online participants).

## 3) User Stories

- As a player, I can join a 2- or 3-player match and see a clear “Crypto Setup” flow.
- As a player, I can submit a private number (e.g., 0-9) without revealing it.
- As players, we can compute a public aggregate outcome (e.g., total, threshold reached, team score).
- As a player, I can verify the decryption result is correct (or see that someone misbehaved).

## 4) Game Design

### Core Mechanic

Each round:

1. Each player privately chooses an integer `m_i` in a small range (e.g., 0..9).
2. Each player publishes `c_i = Enc_pk(m_i)`.
3. Anyone computes `C = Π c_i` to get `Enc_pk(Σ m_i)`.
4. Players provide threshold decryption shares; the decrypted total determines the round outcome.

### Example Rules (Simple, Fun, and Deterministic)

"Charge The Reactor":

- Target is a public integer `T` (e.g., 12).
- Players pick private “charge” contributions `m_i`.
- After decrypting total `S`, the team wins the round if `S >= T`.
- To prevent trivially always winning, each player has a limited per-match “max charge” budget.

## 5) Cryptographic Design

### Scheme

- Additive homomorphic encryption: Paillier or a similar additive HE scheme.

### Threshold Decryption

Goal: no single player can decrypt.

Acceptance requirement (per product decision):

- The module MUST use true distributed key generation (DKG) so that no party ever learns or can retain the full private key.

Player count recommendation:

- Prefer 3 players with 2-of-3 threshold for liveness. (2 players implies 2-of-2, which is fragile: if one disconnects, decryption cannot complete.)

### Verifiable Decryption Shares (No zkSNARK Circuit)

Each decryption share must be accompanied by a standard (non-circuit) zero-knowledge proof that the share is consistent with the public key and ciphertext (e.g., sigma protocol / Fiat-Shamir transform for non-interactive proof).

Acceptance requirement:

- If any player submits an invalid share, honest players can detect it and flag the round as invalid/malicious.

### Input Validity

We need a way to ensure `m_i` lies in the allowed range without revealing it.

For Option 2 (no zkSNARK circuit), we can choose one of:

1. Keep range small and accept “honest input” (explicitly document threat model).
2. Use standard non-circuit ZK range proofs (recommended if available).

## 6) Threat Model

### Target Security Properties

- Privacy: no player learns any other player’s `m_i`.
- Correctness: the decrypted sum equals the sum of submitted plaintexts.
- Robustness: invalid decryption shares are detectable.
- No dealer trust: DKG ensures no single party can later decrypt alone.

### Out of Scope Attacks

- Denial-of-service (players refusing to provide shares).
- Collusion of threshold size or more.

## 7) Implementation Notes (ManaMesh)

### Module

- New module id: `threshold-tally`

### Phases

- `setup`: key generation / share distribution (depends on threshold approach).
- `commit`: players submit ciphertexts.
- `decrypt`: players submit decryption shares + proofs.
- `resolve`: apply outcome; next round.

### Moves (boardgame.io)

- `publishPublicKey(params)`
- `submitCiphertext(params)`
- `submitDecryptShare(params)`
- `ackRoundResult()`

### Signals

Use the existing P2P signaling system for:

- large ciphertext/proof payloads
- retries / re-requests

### State Separation

- Public state (`G`): round transcript, ciphertexts, proofs, decrypted total.
- Private client state: secret shares, randomness, UI drafting.

## 8) Success Criteria

- A match completes multiple rounds with consistent totals.
- A player can’t decrypt another player’s input.
- No single player ever possesses the full private key during or after setup (DKG).
- If a player submits an invalid decryption share, other clients reject it and show an error.

## 9) Milestones

1. Implement module scaffolding + UI skeleton.
2. Implement additive HE tally end-to-end with a hardcoded test key (temporary, non-acceptance).
3. Implement DKG for threshold public key + shares.
4. Implement threshold decryption using shares.
5. Add verifiable decryption share proofs.
6. Add input validity checks (range constraints).
7. Integration tests: deterministic multi-round play over P2P transport.

## 10) Open Questions

- 2-player only vs 3-player recommended for threshold robustness/liveness?
- Which threshold Paillier + DKG approach is feasible in-browser (WASM vs pure TS)?
- How strict should input validity be (honest range vs proven range)?
