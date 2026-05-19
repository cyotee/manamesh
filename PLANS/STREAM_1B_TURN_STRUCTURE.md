# Stream 1b: Turn Structure — Detailed Implementation Plan

## Overview

Stream 1b implements the core turn structure for One Piece TCG without cryptography. The game uses boardgame.io's phase system with per-phase turn configurations and stage-based active player states.

**Goal**: Make One Piece TCG playable with standard rules (draw → main → end turn structure, DON!! system, win condition).

---

## Current State

After Stream 1a, the game has:

- 6 phases: `setup → keyExchange → encrypt → shuffle → play → gameOver/voided`
- All gameplay moves gated to `play` phase with `if (G.phase !== "play") return INVALID_MOVE`
- Single `turn.order` function that doesn't distinguish turn stages
- No player-gating on moves (any player can call any move)
- No auto-draw on game start
- No DON!! refresh each turn
- `endIf` only checks `G.winner` and `G.phase === "voided"`, not `leaderLife === 0`
- `takeLifeDamage` doesn't decrement `leaderLife`

---

## Implementation Steps

### Step 1: Add Player-Gating to All Play Phase Moves

**Problem**: Currently any player can call any move. In One Piece TCG, only the current player can act during their turn.

**Fix**: Add `ctx.currentPlayer !== playerId` check to every play phase move that takes an explicit `playerId`.

**Affected functions**:

- `playCard(G, ctx, playerId, cardId, slotPosition)`
- `playEvent(G, ctx, playerId, cardId)`
- `trashFromPlay(G, ctx, playerId, slotPosition)`
- `attachDonToSlot(G, ctx, playerId, slotPosition, count)`
- `detachDonFromSlot(G, ctx, playerId, slotPosition, count)`
- `takeLifeDamage(G, ctx, playerId)`
- `requestPeek(G, ctx, playerId, deckZone, count)`
- `ackPeek(G, ctx, requestId, decryptionShare, signature)`
- `decryptPeek(G, ctx, requestId)`
- `reorderPeek(G, ctx, requestId, newPositions, signature)`
- `finishPeek(G, ctx, requestId)`
- `declareWinner(G, ctx, winnerId)` — also check that `playerId !== ctx.currentPlayer` can't declare for others mid-game

**Pattern**:

```typescript
function playCard(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
  slotPosition: number,
): OnePieceState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;
  // ... rest of function
}
```

**Note**: `drawCard`, `drawDon`, `surrender` already use `playerId ?? ctx.currentPlayer` so they implicitly handle this correctly.

---

### Step 2: Wire `leaderLife` into `takeLifeDamage`

**Problem**: `takeLifeDamage` doesn't decrement `G.leaderLife[playerId]`. Also, when life deck is exhausted (life = 0), the player loses.

**Fix**: In `takeLifeDamage`:

1. Decrement `G.leaderLife[playerId]` by 1
2. When `G.leaderLife[playerId] <= 0`, set `G.winner` to the opponent and `G.phase` to `"gameOver"`

```typescript
function takeLifeDamage(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
): OnePieceState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  const player = G.players[playerId];
  if (!player || player.lifeDeck.length === 0) return INVALID_MOVE;

  const card = player.lifeDeck.shift()!;
  player.hand.push(card);

  transitionCardVisibility(G, card.id, "owner-known", playerId, "lifeDamage");

  G.leaderLife[playerId] = Math.max(0, (G.leaderLife[playerId] ?? 1) - 1);

  if (G.leaderLife[playerId] === 0) {
    const opponent = Object.keys(G.players).find((id) => id !== playerId);
    if (opponent) {
      G.winner = opponent;
      G.phase = "gameOver";
    }
  }

  syncZones(G);
  return G;
}
```

---

### Step 3: Update Global `endIf` to Check Win Condition

**Problem**: The global `endIf` only checks `G.winner` and `G.phase === "voided"`. If `leaderLife` reaches 0 via `takeLifeDamage` and sets `G.winner`, the `endIf` will fire. But if the last life card is taken and `leaderLife === 0` via some other path, it may not fire.

**Fix**: Add explicit `leaderLife === 0` check to global `endIf`:

```typescript
endIf: ({ G }) => {
  if (G.phase === "voided") {
    return { draw: true, reason: "voided" };
  }
  if (G.winner) {
    return { winner: G.winner };
  }
  // Auto-declare winner if any leader has 0 life
  for (const [playerId, life] of Object.entries(G.leaderLife)) {
    if (life !== undefined && life <= 0) {
      const opponent = Object.keys(G.players).find(id => id !== playerId);
      if (opponent) {
        return { winner: opponent };
      }
    }
  }
  return undefined;
},
```

**Note**: `takeLifeDamage` now sets `G.winner` and `G.phase` directly, so this is a backup check.

---

### Step 4: Add Turn Stages to `play` Phase

**Pattern**: Use boardgame.io's per-phase `turn` configuration with `activePlayers` stages.

boardgame.io stages work as follows:

- `activePlayers: { all: "stageName" }` — all players are in that stage
- `activePlayers: { currentPlayer: { only: "stageName" } }` — only current player is active, in that stage
- Players advance stages via `ctx.events.stage("nextStageName")`

For One Piece TCG, each player's turn has 3 stages:

1. **`draw`** — Auto-draw 1 card from main deck. Player can optionally draw DON!!.
2. **`main`** — Play cards, activate effects, attach/detach DON!!, etc.
3. **`end`** — End the turn. Player can trigger end-of-turn effects.

**File**: `game.ts` — update the `play` phase definition

```typescript
play: {
  turn: {
    order: {
      first: ({ G }) => 0,
      next: ({ G, ctx }) => {
        const playerOrder = ctx.playOrder ?? ["0", "1"];
        return (ctx.currentPlayer + 1) % playerOrder.length;
      },
    },
    activePlayers: {
      currentPlayer: { only: "main" },
    },
    onTurnBegin: ({ G, ctx }) => {
      // Auto-advance to draw stage at start of turn
      ctx.events!.stage("draw");
    },
  },
  moves: {
    // Stage advancement moves (no-op triggers)
    advanceToMain: {
      move: ({ G, ctx }) => {
        if (G.phase !== "play") return INVALID_MOVE;
        ctx.events!.stage("main");
        return G;
      },
      client: false,
    },
    endTurn: {
      move: ({ G, ctx }) => {
        if (G.phase !== "play") return INVALID_MOVE;
        // Reset active DON!! at end of turn
        const player = G.players[ctx.currentPlayer];
        if (player) {
          player.activeDon = 0;
        }
        syncZones(G);
        return G;
      },
      client: false,
    },
    // ... all other existing play moves ...
  },
  endIf: ({ G }) => {
    // Win condition checked globally, not here
    return undefined;
  },
  onEnd: ({ G }) => {
    // Nothing needed on phase end
  },
},
```

**Important**: Remove `if (G.phase !== "play") return INVALID_MOVE` from moves that have their own phase gating via the `play` phase definition. The phase definition itself ensures only play moves are available. Keep the player-gating checks (`ctx.currentPlayer !== playerId`).

---

### Step 5: Auto-Deal Starting Hand on Transition to `play`

**Problem**: When all crypto phases complete and we transition to `play`, no cards are dealt to players.

**Fix**: Update the `shuffle` phase's `advanceToPlay` move (or add an `onEnd` on `shuffle` phase) to deal starting hands.

**Option A — via `advanceToPlay` move** (when crypto is real):

```typescript
advanceToPlay: {
  move: ({ G, ctx }) => {
    if (G.phase !== "shuffle") return INVALID_MOVE;
    G.phase = "play";
    // Deal starting hand to each player
    for (const playerId of Object.keys(G.players)) {
      const player = G.players[playerId];
      for (let i = 0; i < G.config.startingHand; i++) {
        if (player.mainDeck.length > 0) {
          const card = player.mainDeck.shift()!;
          player.hand.push(card);
          transitionCardVisibility(G, card.id, "owner-known", playerId, "initialDraw");
        }
      }
    }
    syncZones(G);
    return G;
  },
  client: false,
},
```

**Option B — via `shuffle` phase `onEnd` callback**:

```typescript
shuffle: {
  // ...
  onEnd: ({ G }) => {
    G.phase = "play";
    for (const playerId of Object.keys(G.players)) {
      const player = G.players[playerId];
      for (let i = 0; i < G.config.startingHand; i++) {
        if (player.mainDeck.length > 0) {
          const card = player.mainDeck.shift()!;
          player.hand.push(card);
          transitionCardVisibility(G, card.id, "owner-known", playerId, "initialDraw");
        }
      }
    }
    syncZones(G);
  },
},
```

**Recommendation**: Use Option B (`onEnd` on `shuffle` phase) since it's cleaner and the phase system will call `onEnd` automatically when the phase ends.

---

### Step 6: Auto-Draw at Start of Each Turn

**Problem**: In One Piece TCG, players draw 1 card at the start of their turn.

**Fix**: In the `draw` stage `onBegin` (or via a move that auto-advances), draw 1 card for the current player.

**Approach**: Since `onTurnBegin` can't directly call moves, use an auto-advancing pattern:

```typescript
onTurnBegin: ({ G, ctx }) => {
  // Auto-draw 1 card for the current player
  const player = G.players[ctx.currentPlayer];
  if (player && player.mainDeck.length > 0) {
    const card = player.mainDeck.shift()!;
    player.hand.push(card);
    transitionCardVisibility(G, card.id, "owner-known", ctx.currentPlayer, "turnStartDraw");
  }
  syncZones(G);
  // Auto-advance to main stage
  ctx.events!.stage("main");
},
```

**Note**: If `onTurnBegin` is not available, create a `startTurn` move that is called by the board component, which does the auto-draw and advances the stage.

**Alternative if `onTurnBegin` not available** (boardgame.io version check needed):
Add a `startTurn` move that is called by the UI at the start of each turn, which:

1. Draws 1 card for `ctx.currentPlayer`
2. Advances to `main` stage

```typescript
startTurn: {
  move: ({ G, ctx }) => {
    if (G.phase !== "play") return INVALID_MOVE;
    // Only current player can start their turn
    const pid = ctx.currentPlayer;
    const player = G.players[pid];
    if (player && player.mainDeck.length > 0) {
      const card = player.mainDeck.shift()!;
      player.hand.push(card);
      transitionCardVisibility(G, card.id, "owner-known", pid, "turnStartDraw");
    }
    syncZones(G);
    return G;
  },
  client: false,
},
```

**If using stages via `ctx.events.stage()`**:

```typescript
startTurn: {
  move: ({ G, ctx }) => {
    if (G.phase !== "play") return INVALID_MOVE;
    const pid = ctx.currentPlayer;
    const player = G.players[pid];
    if (player && player.mainDeck.length > 0) {
      const card = player.mainDeck.shift()!;
      player.hand.push(card);
      transitionCardVisibility(G, card.id, "owner-known", pid, "turnStartDraw");
    }
    syncZones(G);
    ctx.events!.stage("main");
    return G;
  },
  client: false,
},
```

---

### Step 7: DON!! Refresh Each Turn

**Problem**: DON!! cards are a limited resource that refreshes each turn.

**Fix**: At the start of each turn (in `startTurn` or `onTurnBegin`), reset `activeDon` to 0 and move all DON!! cards back from play area to DON!! area.

**In `startTurn` move**:

```typescript
// Return all DON!! from play area to DON!! area at start of turn
const player = G.players[pid];
if (player) {
  // Count DON!! attached to slots
  let attachedDon = 0;
  for (const slot of player.playArea) {
    if (slot.attachedDon > 0) {
      attachedDon += slot.attachedDon;
      slot.attachedDon = 0;
    }
  }
  // Return DON!! cards to DON!! area
  for (let i = 0; i < attachedDon; i++) {
    player.donArea.push({
      id: `don-${pid}-refresh-${i}`,
      name: "DON!!",
      cardType: "don",
    });
  }
  player.activeDon = 0;
}
```

---

### Step 8: Add `playCard` Cost Check

**Problem**: Currently `playCard` doesn't check if the player has enough active DON!! to play the card.

**Fix**: In `playCard`, check `card.cost <= player.activeDon`:

```typescript
function playCard(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
  slotPosition: number,
): OnePieceState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const cardIndex = player.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) return INVALID_MOVE;

  const card = player.hand[cardIndex];
  if (typeof card.cost === "number" && card.cost > player.activeDon) {
    return INVALID_MOVE; // Not enough DON!!
  }
  // ... rest of function
}
```

---

### Step 9: Add `endTurn` Move That Resets DON!! and Passes

**Add to play phase moves**:

```typescript
endTurn: {
  move: ({ G, ctx }) => {
    if (G.phase !== "play") return INVALID_MOVE;
    if (ctx.currentPlayer !== playerId) return INVALID_MOVE;
    const pid = ctx.currentPlayer;
    const player = G.players[pid];
    if (!player) return INVALID_MOVE;
    // Return all DON!! from play area to DON!! area
    let attachedDon = 0;
    for (const slot of player.playArea) {
      if (slot.attachedDon > 0) {
        attachedDon += slot.attachedDon;
        slot.attachedDon = 0;
      }
    }
    for (let i = 0; i < attachedDon; i++) {
      player.donArea.push({ id: `don-${pid}-end-${Date.now()}-${i}`, name: "DON!!", cardType: "don" });
    }
    player.activeDon = 0;
    syncZones(G);
    ctx.events!.endTurn();
    return G;
  },
  client: false,
},
```

---

## File Changes

| File                                     | Changes                            |
| ---------------------------------------- | ---------------------------------- |
| `src/game/modules/onepiece/game.ts`      | Primary target — all changes below |
| `src/game/modules/onepiece/types.ts`     | No changes needed                  |
| `src/game/modules/onepiece/game.test.ts` | Update/add tests for new behavior  |

---

## Test Cases to Add/Update

### `game.test.ts`

1. **`loadDeck advances to keyExchange`** — verify both players loading advances phase
2. **`takeLifeDamage decrements leaderLife`** — verify leader life goes from 5 → 4 → ... → 0
3. **`takeLifeDamage declares winner at 0 life`** — verify opponent wins when leader life hits 0
4. **`endIf declares winner on leaderLife 0`** — verify backup win condition
5. **`playCard costs DON!!`** — verify card with cost > activeDon is rejected
6. **`endTurn resets activeDon`** — verify DON!! returns to DON!! area
7. **`startTurn draws 1 card`** — verify auto-draw on turn start
8. **`startTurn resets activeDon`** — verify DON!! refresh on turn start

---

## Dependencies

- No new dependencies
- No new files needed
- All work is in `src/game/modules/onepiece/game.ts`

---

## Open Questions / Decisions

1. **boardgame.io `onTurnBegin` availability**: Need to verify that `onTurnBegin` is available in the version of boardgame.io being used. If not, the `startTurn` move approach is needed.

2. **`ctx.events!.stage()` availability**: Need to verify that stage advancement via `ctx.events.stage()` works in the current bgio version. The `!` assert is a TypeScript workaround.

3. **DON!! refresh timing**: Should DON!! refresh happen at the START of the turn (before draw) or at the END of the turn (after playing)? Real One Piece TCG refreshes at the start of your turn. Plan follows real rules.

4. **Starting hand timing**: Should the 5-card starting hand be dealt automatically when transitioning `shuffle → play`, or should it require a `startGame` move? Plan uses `shuffle.onEnd` for automatic dealing.

5. **Attack declaration**: Real One Piece TCG has an explicit "attack" action where you declare attackers. The current model doesn't have this — cards are played directly. This is a rules simplification. The plan doesn't add attack declaration.

---

## Implementation Order

1. Step 1 (player gating) — foundation, no dependencies
2. Step 2 (leaderLife in takeLifeDamage) — foundation for win condition
3. Step 3 (endIf check) — depends on Step 2
4. Step 8 (playCard cost check) — independent
5. Step 6 (auto-deal starting hand) — depends on understanding of shuffle → play transition
6. Step 6 alternative (if onEnd not working) — deal via `advanceToPlay` move
7. Step 4 (turn stages + startTurn/endTurn moves) — core turn structure
8. Step 7 (DON!! refresh) — depends on Step 4
9. Step 9 (endTurn move) — depends on Step 4
10. Update tests
11. Run full test suite

---

## Reference: boardgame.io Stage API

boardgame.io stages are defined via `ctx.events.stage("stageName")` and checked via `ctx.stage`.

```typescript
// Move that advances through stages
move: ({ G, ctx, events }) => {
  if (ctx.stage === "draw") {
    // Do draw things
    events.stage("main");
  } else if (ctx.stage === "main") {
    // Do main things
    events.stage("end");
  }
  return G;
};
```

```typescript
// Phase with stage configuration
phase: {
  turn: {
    activePlayers: {
      currentPlayer: { only: "draw" },
    },
  },
  moves: {
    advance: {
      move: ({ G, ctx, events }) => {
        if (ctx.stage === "draw") {
          events.stage("main");
        }
        return G;
      },
    },
  },
}
```

---

_Last updated: April 12, 2026_
