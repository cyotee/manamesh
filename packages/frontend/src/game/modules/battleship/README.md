# Battleship (Merkle-Bound Placement)

This Battleship module implements a 2-player game where ship placement is _binding_ (you cannot change your board after committing), while each shot reveals only a single bit (hit/miss) without revealing the rest of the board.

It does this with a per-cell salted commitment and a Merkle tree.

## What This Cryptography Does (and Does Not Do)

Guarantees:

- Binding placement: once a player publishes their Merkle root, every later hit/miss reveal must be consistent with that original root.
- Minimal disclosure per shot: a reveal proves _only_ whether a single targeted cell was occupied (1) or empty (0).
- Verifiable outcomes: the attacker verifies the defender's reveal locally by checking a Merkle proof against the defender's committed root.

Non-goals / limitations:

- This commitment binds _occupancy bits_ (which cells have ships), not the exact fleet legality by itself. The UI enforces standard fleet placement, but the opponent cannot cryptographically prove you used the standard fleet unless you do an optional post-game full reveal.
- This is not encryption of the entire board state in the “hide everything forever” sense: each shot necessarily reveals one bit (and the game log reveals which cells were shot).

## Data Model

Each player commits to a 10x10 board as a bit-array of length 100:

- `bit[i] = 1` if cell `i` contains a ship segment
- `bit[i] = 0` otherwise

Indexing is row-major:

```
index = y * 10 + x
```

Each cell `i` also has a random salt `salt[i]` (hex string). Salts are generated client-side and kept private.

Relevant code:

- Commitment helpers: `packages/frontend/src/game/modules/battleship/commitment.ts`
- Merkle implementation: `packages/frontend/src/crypto/merkle.ts`
- SHA-256 implementation: `packages/frontend/src/crypto/sha256.ts`

## Commitment Construction

For each cell `i`, we compute a leaf hash:

```
leaf[i] = SHA256( utf8("${gameId}|${playerId}|${i}|${bit[i]}|") || saltBytes[i] )
```

- `gameId`: currently the boardgame.io `matchID` (passed around explicitly as `gameId`)
- `playerId`: the committing player ID ("0" or "1")
- `i`: cell index 0..99
- `bit[i]`: 0 or 1
- `saltBytes[i]`: random bytes (represented as hex in the UI)

The commitment root is the Merkle root of the 100 leaves:

```
root = MerkleRoot(leaf[0..99])
```

The root is published to the shared game state in placement phase via:

- Move: `publishCommitment` in `packages/frontend/src/game/modules/battleship/game.ts`
- Logic: `publishCommitment` in `packages/frontend/src/game/modules/battleship/logic.ts`

Why salts matter:

- Without salts, an attacker could precompute hashes for `bit=0` / `bit=1` and try to infer occupancy.
- With per-cell random salts, leaves are computationally indistinguishable from random, and Merkle sibling hashes in proofs do not reveal other cells.

## How a Shot Is Evaluated (Hit/Miss) Without Revealing the Board

The actual “shot” is a two-step protocol:

1. Attacker sends a guess (coordinate).
2. Defender responds with a cryptographic reveal for that coordinate.

### Step 1: Guess (out-of-band)

The attacker clicks an opponent cell in the UI. This sends a signal message (`bs_guess`) to the defender.

Signals are _out-of-band_ relative to boardgame.io moves:

- P2P mode: `JoinCodeConnection.sendSignal` / `onSignal`
- Hotseat fallback: `BroadcastChannel`

Implementation: `packages/frontend/src/components/BattleshipBoard.tsx`

### Step 2: Reveal (out-of-band)

The defender looks up the targeted cell index `i` in their private board representation:

- `bit = bit[i]`
- `saltHex = salt[i]`
- `proof = MerkleProof(leaves, i)`

They send `bs_reveal` containing:

- `ownerId` (defender/player who committed)
- `index` and `coord` (must match)
- `bit` (0/1)
- `saltHex`
- `proof` (Merkle proof steps)

### Step 3: On-chain-equivalent verification (in the move)

When the attacker receives `bs_reveal`, the UI calls the boardgame.io move:

- `moves.applyReveal(coord, reveal)`

In `packages/frontend/src/game/modules/battleship/game.ts`, `applyReveal` verifies:

1. Phase and coordinate validity
2. `reveal.ownerId` is the opponent
3. `reveal.index` matches the coordinate (`coordToIndex`)
4. The opponent has a committed root (`G.players[opponentId].commitmentRootHex`)
5. Leaf recomputation:

   ```
   leaf = leafHash(reveal.gameId, reveal.ownerId, reveal.index, reveal.bit, reveal.saltHex)
   ```

6. Merkle proof verification:

   ```
   ok = verifyMerkleProof(leaf, reveal.proof, root)
   ```

If the proof verifies, the game records the result as a hit/miss on the attacker’s “opponent marks” grid and appends a guess record to `G.guesses`.

Privacy property:

- The attacker learns only `(bit at index i)` for the attacked cell.
- The proof includes sibling hashes, but those are hashes of salted leaves / internal nodes, so they do not reveal other bits.

Cheating resistance:

- The defender cannot lie about `bit` for a targeted cell because they must provide a `saltHex` + Merkle proof that matches the already-committed root.
- The attacker cannot forge a reveal because they cannot produce a valid Merkle proof for the defender’s root without the defender’s salts.

## End-of-Game Audit (Consistency With Original Commit)

During gameplay, only the attacked cells are revealed. At the end, we can audit that _all reveals and the final outcome_ were consistent with the originally committed board.

### What the audit checks

The audit helper `auditFullReveal` in `packages/frontend/src/game/modules/battleship/audit.ts` checks:

1. Root consistency:

- Recompute `computedRootHex` from the full `(boardBits, salts)` and compare it to the published `expectedRootHex`.

2. Guess log consistency:

- For every guess in `G.guesses` that targeted the audited player, recompute whether it _should_ have been a hit or miss from `boardBits`.
- Report any mismatches where the recorded `g.result` does not match the audited board bits.

### What this proves

If `rootMatches === true` and there are `0` guess mismatches, then:

- The board used for the audit is exactly the board that was committed at placement time.
- Every hit/miss outcome recorded in the game log for shots against that board matches the committed placement.
- Therefore, the defender could not have “moved ships” or altered occupancy after committing.

### Who can run the audit

Any party can run the audit _if they have the full reveal material_:

- `boardBits[100]`
- `saltsHex[100]`
- `expectedRootHex`
- the final game state (or at least the guess log)

In the current UI (`packages/frontend/src/components/BattleshipBoard.tsx`), the “Audit My Board” button runs this locally using values stored in session storage during placement (so the player can still answer reveals even after refresh).

Optional stronger verification (future / out-of-band):

- After the game, a player may choose to share `(boardBits, saltsHex)` with the opponent.
- The opponent can then recompute the root and verify that every reveal and the final result were consistent.

## Implementation Notes

- Hashing is synchronous SHA-256 (`packages/frontend/src/crypto/sha256.ts`) so verification can run inside boardgame.io moves without async.
- Merkle tree uses SHA-256 over concatenated child hashes. For odd node counts, the last node is duplicated.
- `gameId` is included in leaf hashing to scope commitments to a single match (prevents reusing a commitment across matches).
