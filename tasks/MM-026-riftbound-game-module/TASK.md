# Task MM-026: Riftbound Game Module

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-21
**Dependencies:** MM-019, MM-020
**Worktree:** `feature/game-riftbound`

---

## Description

Implement the Riftbound game module - ManaMesh's original card game. This is the lowest priority game module as it requires original game design work.

## Dependencies

- MM-019: Core Game Module Interface
- MM-020: Deck Plugin for boardgame.io

## User Stories

### US-MM-026.1: Riftbound Game Play

As a player, I want to play Riftbound so that I can experience ManaMesh's original game.

**Acceptance Criteria:**
- [ ] Module exports boardgame.io Game object
- [ ] Riftbound card schema (RiftboundCard extends CoreCard)
- [ ] Core game mechanics defined and implemented
- [ ] Basic win condition
- [ ] Zones defined per game design
- [ ] Tests cover game flow

## Technical Details

### Card Schema

```typescript
interface RiftboundCard extends CoreCard {
  cardType: string;       // TBD based on game design
  cost?: number;
  power?: number;
  abilities?: string[];
  // Additional fields TBD
}
```

### Notes

This task requires game design work before implementation. The following needs to be defined:
- Core game mechanics
- Card types and their roles
- Resource system (if any)
- Win conditions
- Zone definitions

Consider creating a separate design document or PRD section for Riftbound's rules.

## Files to Create/Modify

**New:**
- `packages/frontend/src/game/modules/riftbound/index.ts`
- `packages/frontend/src/game/modules/riftbound/types.ts`
- `packages/frontend/src/game/modules/riftbound/game.ts`

**Tests:**
- `packages/frontend/src/game/modules/riftbound/game.test.ts`

## Completion Criteria

- [ ] Game design documented
- [ ] All acceptance criteria met
- [ ] Basic game flow works
- [ ] Tests pass
- [ ] Build succeeds

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
