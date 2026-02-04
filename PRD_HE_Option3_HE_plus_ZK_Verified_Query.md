# PRD: Option 3 — HE + ZK Verified Query (Battleship-Style Hit Checking)

## 1) Overview

### Working Title

Verified Encrypted Query (VEQ) — Hit/Miss Demo

### One-liner

A 2-player demo where one player queries a private bit of the opponent’s state using homomorphic encryption, and the opponent proves (via a ZK circuit) that the encrypted answer is consistent with a previously committed board.

### Why This Demo

HE alone enables privacy-preserving computation but not necessarily verifiable correctness if the compute party can lie. This demo explicitly showcases the combination:

- HE for privacy-preserving query/response
- ZK proof to enforce correctness against a committed state

## 2) Goals

### Primary Goals

- Show a per-turn cryptographic flow where the querier learns only `hit/miss`.
- Ensure the responder cannot cheat about `hit/miss` without being caught.
- Keep P2P-only operation (join codes / libp2p DHT / mDNS).

### Non-Goals

- Not a production-grade Battleship implementation.
- Not optimized for large circuits or mobile.
- Not a general-purpose ZK framework.

## 3) User Stories

- As a player, I can place ships privately.
- As a player, I can publish a commitment to my placement.
- As a player, I can make a guess and obtain `hit/miss` privately.
- As the opponent, I cannot fake the `hit/miss` response; if I try, the proof fails.

## 4) Game Design

### Rules

- 10x10 Battleship board with standard fleet.
- Turns alternate; each turn is a guess at a coordinate.
- Win when all ship cells are hit.

### What’s Public

- Turn order, guessed coordinates, and hit/miss marks on the opponent grid.
- Board commitment root.

### What’s Private

- Actual board bits `b[0..99]`.
- Per-cell salts used for commitment.

## 5) Cryptographic Protocol

### Components

1. Commitment scheme (binding to board)

- Each player commits to board bits with a Merkle root:
  - leaf: `H(matchId, ownerId, index, bit, salt)`
  - root published to public game state

2. Homomorphic encryption (private query)

- Additive HE (Paillier) used to compute an encrypted hit bit.

3. ZK proof (correctness)

- A circuit proves that the responder’s returned ciphertext decrypts to the committed bit at the queried index.

### Turn Flow (High Level)

#### Setup

1. Both players publish their Merkle commitment root.
2. Guesser publishes a Paillier public key `pk_G` used for the current turn (or for the match).

#### Query

3. Guesser selects target index `i` and sends a query payload to opponent.

Two supported query shapes (choose one at implementation time):

Option A (PIR-style selection vector; strong HE demo)

- Guesser sends `Enc_pkG(e[0..99])` where `e` is one-hot at `i`.
- Responder computes `cHit = Π Enc(e[j])^{b[j]}` so `cHit = Enc(b[i])`.

Option B (direct; weaker HE demo)

- Guesser sends `i` openly (already public in Battleship).
- Responder computes `Enc_pkG(b[i])` directly.

#### Proof + Response

4. Responder returns:

- ciphertext `cHit` (expected to encrypt 0/1)
- ZK proof `pi` that `cHit` encrypts the bit that is committed at index `i`

5. Guesser verifies `pi`.
6. If valid, guesser decrypts `cHit` to learn hit/miss and applies the move in boardgame.io.

### ZK Statement (Circuit)

Public inputs:

- Merkle root `root`
- index `i`
- ciphertext `cHit`
- Paillier public key parameters (at least `n`)

Private witness:

- bit `b` (0/1)
- salt `s`
- Merkle authentication path for leaf `i`
- Paillier encryption randomness used to form `cHit` OR a decryption witness depending on proof strategy

Circuit verifies:

1. Merkle path proves leaf `H(matchId, ownerId, i, b, s)` is in `root`.
2. Ciphertext correctness:
   - `cHit` is a valid Paillier encryption of `b` under `pk_G`.
3. Range constraint: `b` is boolean.

Note: proving Paillier encryption validity inside a circuit may be expensive. If this is too heavy, fallback to:

- responder reveals `(b, s, merkleProof)` in plaintext (Merkle-only mode), OR
- switch HE scheme / proof strategy to one with circuit-friendly constraints.

## 6) Threat Model

### Target Security

- Privacy: responder does not reveal board except the queried bit.
- Integrity: responder cannot forge hit/miss for a different bit.
- Binding: responder cannot change board after commitment.

### Out of Scope

- DoS (refusing to answer).
- Side-channel leaks in WASM/JS runtime.
- Collusion with third parties.

## 7) Implementation Notes (ManaMesh)

### New Module

- Module id: `veq-battleship`

### Phases

- `placement`: place ships + publish commitment root
- `battle`: guess/query/prove
- `gameOver`

### Signals

Use P2P signals for bulky payloads:

- `veq_query`
- `veq_response` (ciphertext + proof)

### Client/Server Split

- Public game state stores roots, hit/miss marks, and a transcript hash.
- Private client state stores board bits + salts and any HE secret keys.

### Tooling

- ZK circuit implementation: circom + snarkjs (or similar) integrated into build.
- Proof generation is client-side and may be slow; keep circuit minimal.

## 8) Acceptance Criteria

- If responder returns a wrong ciphertext/bit, proof verification fails and the move is rejected.
- Players can complete a full game over P2P.
- UI clearly distinguishes:
  - "Encrypted query"
  - "Proof verified"
  - "Decrypted hit/miss"

## 9) Milestones

1. Implement Merkle commitment placement (reuse existing Merkle Battleship components).
2. Implement HE query/response (no proof).
3. Implement ZK circuit for Merkle membership of `(i, b)`.
4. Extend circuit to bind `cHit` to `b` (or choose a circuit-friendly HE validity proof).
5. Integrate proof generation/verification into turn flow + P2P messages.
6. End-to-end tests + performance profiling.

## 10) Open Questions

- Which HE scheme is circuit-friendly enough for in-browser ZK proof binding?
- Should we use Option A (selection vector) or Option B (direct) for the HE demo?
- Can we keep proofs under a few seconds on consumer hardware?
