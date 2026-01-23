# Task Index: ManaMesh

**Repo:** MM
**Last Updated:** 2026-01-22

## Active Tasks

| ID | Title | Status | Dependencies | Worktree |
|----|-------|--------|--------------|----------|
| MM-003 | libp2p DHT Discovery | Complete | MM-002 | N/A |
| MM-004 | mDNS Local Discovery | Complete | MM-002 | N/A |
| MM-005 | boardgame.io P2P Transport | Complete | MM-002 | N/A |
| MM-007 | Backend Signaling Fallback | Complete | MM-002, MM-003, MM-004 | N/A |
| MM-008 | Stabilize Tests & Acceptance Criteria | Complete | None | N/A |
| MM-009 | Implement Public Game Indexing | Complete | MM-003 | N/A |
| MM-010 | Fix Public Game Key Encoding | Complete | MM-003 | N/A |
| MM-011 | Confirm/Document Runtime Support | Complete | MM-003 | N/A |
| MM-012 | Add DHT Record Expiry/Republish | Complete | MM-003 | N/A |
| MM-013 | Fix AbortController Reuse in Gateway | Complete | None | N/A |
| MM-014 | Clear Timeout Timers on Success | Complete | None | N/A |
| MM-015 | Fix IPFS Config and Gateway Priority | Complete | None | N/A |
| MM-016 | IPFS Code Cleanup and Test Improvements | Complete | None | N/A |
| MM-017 | Set Up boardgame.io Fork Submodules | Complete | None | N/A |
| MM-018 | Standard Playing Cards Asset Pack | In Progress | None | N/A |
| MM-019 | Core Game Module Interface | Ready | MM-017 | `feature/game-module-core` |
| MM-020 | Deck Plugin for boardgame.io | Blocked | MM-017, MM-019 | `feature/deck-plugin` |
| MM-021 | War Game Module | Blocked | MM-019, MM-020, MM-018 | `feature/game-war` |
| MM-022 | Poker Game Module | Blocked | MM-019, MM-020, MM-018 | `feature/game-poker` |
| MM-023 | One Piece TCG Game Module | Blocked | MM-019, MM-020 | `feature/game-onepiece` |
| MM-024 | MTG Game Module | Blocked | MM-019, MM-020 | `feature/game-mtg` |
| MM-025 | Lorcana Game Module | Blocked | MM-019, MM-020 | `feature/game-lorcana` |
| MM-026 | Riftbound Game Module | Blocked | MM-019, MM-020 | `feature/game-riftbound` |
| MM-027 | Asset Pack Manifest Parser | Ready | None | `feature/asset-manifest-parser` |
| MM-028 | Asset Pack Loader | Blocked | MM-027 | `feature/asset-loader` |

## Status Legend

- **Ready** - All dependencies met, can be launched with `/backlog:launch`
- **In Progress** - Implementation agent working (has worktree)
- **In Review** - Implementation complete, awaiting code review
- **Changes Requested** - Review found issues, needs fixes
- **Complete** - Review passed, ready to archive with `/backlog:prune`
- **Blocked** - Waiting on dependencies

## Quick Filters

### Ready for Agent
Tasks with all dependencies met:
- MM-007: Backend Signaling Fallback (was deferred, now ready)
- MM-008: Stabilize Tests & Acceptance Criteria
- MM-009: Implement Public Game Indexing (unblocked by MM-003)
- MM-010: Fix Public Game Key Encoding (unblocked by MM-003)
- MM-011: Confirm/Document Runtime Support (unblocked by MM-003)
- MM-013: Fix AbortController Reuse in Gateway (from MM-006 review)
- MM-014: Clear Timeout Timers on Success (from MM-006 review)
- MM-015: Fix IPFS Config and Gateway Priority (from MM-006 review)
- MM-016: IPFS Code Cleanup and Test Improvements (from MM-006 review)
- MM-017: Set Up boardgame.io Fork Submodules
- MM-018: Standard Playing Cards Asset Pack
- MM-027: Asset Pack Manifest Parser

### Blocked
Tasks waiting on dependencies:
- MM-019: Core Game Module Interface (waiting on MM-017)
- MM-020: Deck Plugin for boardgame.io (waiting on MM-017, MM-019)
- MM-021: War Game Module (waiting on MM-019, MM-020, MM-018)
- MM-022: Poker Game Module (waiting on MM-019, MM-020, MM-018)
- MM-023: One Piece TCG Game Module (waiting on MM-019, MM-020)
- MM-024: MTG Game Module (waiting on MM-019, MM-020)
- MM-025: Lorcana Game Module (waiting on MM-019, MM-020)
- MM-026: Riftbound Game Module (waiting on MM-019, MM-020)
- MM-028: Asset Pack Loader (waiting on MM-027)

## Dependency Graph

```
MM-003 (Complete) ✓
├── MM-009 (Ready - public game indexing)
├── MM-010 (Ready - key encoding fix)
├── MM-011 (Ready - runtime compat)
└── MM-012 (Complete) ✓

MM-004 (Complete) ✓
MM-005 (Complete) ✓
MM-007 (Ready - all deps complete)

MM-008 (Ready)

MM-013 (Ready - abort controller fix)
MM-014 (Ready - timeout cleanup)
MM-015 (Ready - config fix)
MM-016 (Ready - code cleanup)

MM-017 (Ready - bgio submodules)
└── MM-019 (Blocked - game module core)
    └── MM-020 (Blocked - deck plugin)
        ├── MM-021 (Blocked - War) ← also needs MM-018
        ├── MM-022 (Blocked - Poker) ← also needs MM-018
        ├── MM-023 (Blocked - One Piece)
        ├── MM-024 (Blocked - MTG)
        ├── MM-025 (Blocked - Lorcana)
        └── MM-026 (Blocked - Riftbound)

MM-018 (Ready - playing cards asset pack)
├── MM-021 (Blocked - War)
└── MM-022 (Blocked - Poker)

MM-027 (Ready - manifest parser)
└── MM-028 (Blocked - asset loader)
```

## Cross-Repo Dependencies

Tasks in other repos that depend on this repo's tasks:
- (none yet)

## Archived Tasks

| ID | Title | Completed | Location |
|----|-------|-----------|----------|
| MM-001 | Frontend Skeleton + boardgame.io Core | 2026-01-21 | archive/MM-001.md |
| MM-002 | WebRTC + Two-Way Join Codes | 2026-01-21 | archive/MM-002.md |
| MM-006 | IPFS Asset Loading + Caching | 2026-01-21 | archive/MM-006.md |
