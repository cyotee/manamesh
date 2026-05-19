# Game Module System — Remediation Plan

**Date:** May 9, 2026
**Based on:** Code review of `packages/frontend/src/game/modules/`
**Scope:** Bug fixes, correctness issues, and key quality improvements across all six game modules

---

## Overview

Issues are ordered by severity within three phases. Phase 1 contains outright runtime crashes or functional breakage that can be fixed in isolation. Phase 2 covers logical correctness bugs in the crypto protocol. Phase 3 covers architectural cleanup.

---

## Phase 1 — Crashes and Broken Features (< 2 hours each)

These fixes are one or two lines and have no cascading implications.

---

### Fix 1: `gofish/index.ts:40` — Wrong export name for `submitDecryptedShare`

The public module API re-exports `submitDecryptionShare`, which does not exist in `crypto.ts`. The function is `submitDecryptedShare`. Any consumer importing from `../gofish` gets `undefined` at runtime.

```diff
-  submitDecryptionShare,
+  submitDecryptedShare,
```

---

### Fix 2: `threshold-tally/game.ts:36` — `publishDkgCommitment` parameter shape mismatch

The boardgame.io move declares `params: { c0Hex: string; c1Hex: string }` and passes it directly to `logic.publishDkgCommitment`. The logic function expects `{ coefficients: string[] }` and calls `params.coefficients.map(...)` on the first line — always throws `Cannot read properties of undefined (reading 'map')`.

**Before (`game.ts:33–46`):**
```typescript
publishDkgCommitment: {
  move: ({ G, ctx, playerID }, params: { c0Hex: string; c1Hex: string }) => {
    try {
      if (ctx.phase !== "setup") return INVALID_MOVE;
      publishDkgCommitment(G, playerID, params);
```

**After:**
```typescript
publishDkgCommitment: {
  move: ({ G, ctx, playerID }, params: { coefficients: string[] }) => {
    try {
      if (ctx.phase !== "setup") return INVALID_MOVE;
      publishDkgCommitment(G, playerID, params);
```

The `logic.ts` transcript already reads `c0Hex: coefficients[0]` and `c1Hex: coefficients[1]` (lines 130–131), so the logic side is correct. Only the move wrapper needs updating.

---

### Fix 3: `gofish/crypto.ts` — Remove dead `demo-private` code paths that reach `decryptToCardId`

`decryptToCardId` (line 232) unconditionally throws. The only code paths that reach it are gated on `G.securityMode === "demo-private"`. Since `createCryptoGoFishState` now defaults to `"coop-reveal"` (Fix 2 from the security plan), these paths are dead but remain callable.

Three sites to guard:

**`handHasRank` (line 322):** Guard before entering the loop:
```diff
 function handHasRank(G: CryptoGoFishState, playerId: string, rank: string): boolean {
+  if (G.securityMode !== "demo-private") return false; // unreachable — callers gate on demo-private
   const hand = ...
```

**`respondToAsk` demo-private branch (~line 1066):** Add the same guard before any call to `decryptToCardId`.

**`goFish` demo-private branch (~line 1171):** Same guard.

This converts silent throws into safe no-ops without removing the code structure (enabling future re-implementation).

---

### Fix 4: `onepiece/game.ts:836` — `onTurnBegin` and `startTurn` both draw a card

`onTurnBegin` (line 834) fires automatically at turn start and draws a card + refreshes DON!!. The explicit `startTurn` move (line 869) duplicates the same logic. A player who calls `startTurn` gets double draws and double DON!! refreshes.

**Fix:** Remove `startTurn` from the moves object and from the game definition. The `onTurnBegin` hook is sufficient. Any UI calling `startTurn` should instead call `endTurn` (which boardgame.io handles by internally triggering `onTurnBegin` for the next player).

If the UI requires an explicit "acknowledge start of turn" action, replace `startTurn` with a no-op acknowledgment move that does not touch hand or DON!! state.

---

### Fix 5: `onepiece/game.ts:736` — `turn.order.next` returns string player ID instead of numeric index

In the play phase fallback branch, the function returns `ctx.currentPlayer` (a `string`) instead of a numeric index:

```diff
-        return ctx.numPlayers != null ? ctx.currentPlayer : 0;
+        return (parseInt(ctx.currentPlayer) + 1) % (ctx.numPlayers ?? 2);
```

This matches the pattern used in the play phase's inner turn config at line 831.

---

### Fix 6: `onepiece/game.ts:226` — `deckCardIds` recorded before `shuffleDeck`

`loadDeck` stores `mainDeckCards.map(c => c.id)` at line 226, then shuffles `player.mainDeck`. The crypto module encrypts in `deckCardIds` order but gameplay uses the shuffled order. Set `deckCardIds` after `shuffleDeck`:

```diff
-  G.deckCardIds[playerId] = mainDeckCards.map((c) => c.id);
-  G.lifeDeckIds[playerId] = lifeCards.map((c) => c.id);
   // ... shuffleDeck call ...
+  G.deckCardIds[playerId] = player.mainDeck.map((c) => c.id);
+  G.lifeDeckIds[playerId] = player.lifeDeck.map((c) => c.id);
```

---

## Phase 2 — Crypto Protocol Correctness (1–3 days)

These require careful changes to the mental poker decrypt chain.

---

### Fix 7: `war/crypto.ts` — `submitDecryptedShare` does not chain decryption layers

**Lines 821–853.** When each player submits their share, the code stores `G.decryptedCards[playerId] = decryptedCard` but never writes back to the reveal zone. Each player therefore decrypts the original ciphertext, not the previous player's output. After all shares are submitted, the code reads `decryptedCard.layers` from the **final submitter's** copy — which is a one-layer decryption of a two-layer card, so `layers === 1`, not 0, and `lookupCardIdFromPoint` fails, voiding the game.

The GoFish coop-reveal path (`gofish/crypto.ts:1540`) does this correctly:
```typescript
zone[cardIndex] = decryptedCard; // each player decrypts the previous player's output
```

**Fix in `submitDecryptedShare`, War module:**

After validating the share and marking `pending[playerId] = true`, write back to the zone:

```diff
  pending[playerId] = true;

- if (!G.decryptedCards) G.decryptedCards = {};
- G.decryptedCards[playerId] = decryptedCard;

+ // Write back so the next player decrypts the progressively stripped ciphertext
+ const revealZone = `reveal_${targetPlayerId}`;
+ if (!G.crypto.encryptedZones[revealZone]) G.crypto.encryptedZones[revealZone] = [];
+ G.crypto.encryptedZones[revealZone][0] = decryptedCard;
```

Then in the `allSubmitted` block, read from the zone rather than from `decryptedCard` (the last-submitted argument):

```diff
  if (allSubmitted) {
-   if (decryptedCard.layers === 0) {
-     const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, decryptedCard.ciphertext);
+   const finalCard = G.crypto.encryptedZones[revealZone]?.[0];
+   if (finalCard && finalCard.layers === 0) {
+     const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, finalCard.ciphertext);
```

---

### Fix 8: `war/crypto.ts:1055` — `approveDecrypt` uses only last approver's share

**Lines 1044–1066.** When all approvals are in, the completion block iterates card indices but reads `request.decryptionShares[playerId]` — where `playerId` is the argument of the *final* call to `approveDecrypt`. All other players' shares are discarded.

The root issue is that `approveDecrypt` stores each player's share in `request.decryptionShares[playerId]` without chaining. Unlike `submitDecryptedShare`, there is no zone to write back to.

**Fix:** Apply the same zone-chaining pattern. When a player stores their share, also update the zone card:

```typescript
// In approveDecrypt, after storing the share:
request.decryptionShares[playerId] = decryptedCard;

// Chain the decryption into the zone so subsequent players receive
// the progressively stripped ciphertext
const encryptedCards = G.crypto.encryptedZones[request.zoneId];
if (encryptedCards && request.cardIndices.length > 0) {
  const idx = request.cardIndices[0];
  encryptedCards[idx] = decryptedCard;
}
```

Then in the completion block, read from the zone rather than from `request.decryptionShares[playerId]`:

```diff
  for (let i = 0; i < encryptedCards.length; i++) {
    if (!request.cardIndices.includes(i)) continue;
-   const decrypted = request.decryptionShares[playerId]; // wrong: only last approver
+   const decrypted = encryptedCards[i]; // correct: fully-chained result
    if (decrypted && decrypted.layers === 0) {
```

---

### Fix 9: `war/crypto.ts:1176` — War-tie elimination ignores won pile

When war is triggered, a player with an empty encrypted deck is immediately declared the loser even if they have cards in `player.won` (which are unencrypted, won from previous rounds).

```diff
  const p1Cards = cryptoApi.getEncryptedCardCount(`deck_${p1Id}`);
  const p2Cards = cryptoApi.getEncryptedCardCount(`deck_${p2Id}`);

- if (p1Cards === 0) {
+ if (p1Cards === 0 && G.players[p1Id].won.length === 0) {
    G.winner = p2Id;
    G.phase = "gameOver";
- } else if (p2Cards === 0) {
+ } else if (p2Cards === 0 && G.players[p2Id].won.length === 0) {
    G.winner = p1Id;
    G.phase = "gameOver";
  }
```

Players with a non-empty won pile should be required to call `reshuffleWonPile` before drawing for war, matching the non-crypto game's pattern.

---

## Phase 3 — Architectural Cleanup (3–5 days)

These do not fix runtime bugs but are important for long-term correctness and maintainability.

---

### Fix 10: Extract shared crypto utilities to `crypto-utils.ts`

The following functions are copy-pasted nearly verbatim across `war/crypto.ts`, `gofish/crypto.ts`, `onepiece/crypto.ts`, and `poker/crypto.ts`:

| Function | Duplicated in |
|----------|--------------|
| `createCardIds` | war, gofish |
| `parseCardId` | war, gofish, onepiece |
| `getCurrentSetupPlayer` | war, gofish, onepiece, poker |
| `advanceSetupPlayer` | war, gofish, onepiece, poker |
| `resetSetupPlayer` | war, gofish, onepiece, poker |
| `lookupCardIdFromPoint` | war, gofish, onepiece |
| `deterministicShuffle` | gofish, onepiece |

**Fix:** Create `packages/frontend/src/game/modules/crypto-utils.ts` and move all seven functions there. Update each module to import from it. This is a pure refactor — no logic changes.

`lookupCardIdFromPoint` is also O(n) on every reveal (linear scan through a lookup table). It should build a pre-inverted `Map<hex, cardId>` at encrypt time and store it in game state.

---

### Fix 11: `G.phase` / `ctx.phase` divergence — add a phase-sync guard

In `gofish/crypto.ts` (~line 777) and `war/crypto.ts` (~line 599), `shuffleDeck` calls `events.endPhase()` only when `ctx.phase === "setup"`. If this condition is missed (e.g., reconnect, test environment), `G.phase` advances but boardgame.io's internal phase does not.

**Fix:** In both files, change the conditional to assert that `ctx.phase` matches the expected phase, and if not, log a warning but still call `endPhase` if the transition is warranted:

```typescript
if (G.phase === "play" && ctx.phase === "setup") {
  events.endPhase?.();
}
```

Or, simpler: rely on boardgame.io's `endIf` for phase transitions instead of calling `events.endPhase()` manually. The `endIf` already checks `G.phase === "play"` — making the explicit call redundant and error-prone.

---

### Fix 12: `threshold-tally/logic.ts:233` — guard against non-integer player IDs

`BigInt(Number(pid) + 1)` throws if `pid` is non-numeric. Add a validation at the top of `finalizeDkg` and `submitDecryptShare`:

```typescript
function playerIdToEvalPoint(pid: string): bigint {
  const n = Number(pid);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Player ID "${pid}" is not a non-negative integer; cannot use as DKG evaluation point`);
  }
  return BigInt(n + 1);
}
```

Replace all `BigInt(Number(pid) + 1)` occurrences with `playerIdToEvalPoint(pid)`.

---

## Missing Test Coverage

Each Phase 1 and Phase 2 fix should be accompanied by a test. Priority list:

| Module | Tests needed |
|--------|-------------|
| `war/crypto.ts` | `submitDecryptedShare` chains layers; `approveDecrypt` chains layers; war-tie with non-empty won pile |
| `gofish/crypto.ts` | `handHasRank` with non-demo-private mode returns false (no throw) |
| `threshold-tally` | New test file: `publishDkgCommitment` with `{ coefficients }` succeeds; `{ c0Hex, c1Hex }` returns INVALID_MOVE; round-trip vote |
| `onepiece/game.ts` | `onTurnBegin` draws exactly one card; no `startTurn` double-draw after removal |
| `onepiece/crypto.ts` | New test file for crypto game: key exchange → encrypt → shuffle → peek |
| `poker/crypto.ts` | New test file for crypto poker: encrypt → deal → cooperative reveal |
| `he-battleship` | New test file: document that boardBits path is the current active implementation |

---

## Implementation Order

| Fix | File(s) | Effort | Phase |
|-----|---------|--------|-------|
| Fix 1 — GoFish export name | `gofish/index.ts:40` | 1 line | 1 |
| Fix 2 — Threshold Tally param shape | `threshold-tally/game.ts:36` | 1 line | 1 |
| Fix 3 — GoFish demo-private guards | `gofish/crypto.ts:322` +2 sites | ~6 lines | 1 |
| Fix 4 — Remove `startTurn` double-draw | `onepiece/game.ts:869–906` | delete ~37 lines | 1 |
| Fix 5 — `turn.order.next` return type | `onepiece/game.ts:736` | 1 line | 1 |
| Fix 6 — `deckCardIds` after shuffle | `onepiece/game.ts:226` | 2 lines | 1 |
| Fix 7 — War `submitDecryptedShare` layer chain | `war/crypto.ts:821–853` | ~15 lines | 2 |
| Fix 8 — War `approveDecrypt` layer chain | `war/crypto.ts:1044–1066` | ~15 lines | 2 |
| Fix 9 — War won-pile elimination guard | `war/crypto.ts:1179,1182` | 2 lines | 2 |
| Fix 10 — Extract `crypto-utils.ts` | all four crypto modules | refactor only | 3 |
| Fix 11 — Phase sync guard | `gofish/crypto.ts:777`, `war/crypto.ts:599` | ~5 lines each | 3 |
| Fix 12 — Threshold DKG player ID guard | `threshold-tally/logic.ts:233,405` | ~10 lines | 3 |

Phases 1 fixes ship as one PR. Phase 2 ships as a second PR with tests. Phase 3 is a follow-up cleanup PR.

---

## Out of Scope

| Issue | Reason deferred |
|-------|-----------------|
| GoFish/War: no proof-of-correct-decryption | Requires DLEQ proofs per decryption share; 1–2 week effort; document as known limitation |
| `he-battleship`: Paillier not wired during play | Full HE Battleship redesign required |
| `onepiece/crypto.ts`: missing test file | Covered under test coverage work; crypto game not yet feature-complete |
| `poker/crypto.ts`: missing test file | Same |

---

_This plan addresses issues found in the May 2026 game module code review._
