# Task Index: ManaMesh

**Repo:** MM
**Last Updated:** 2026-01-26

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
| MM-018 | Standard Playing Cards Asset Pack | Complete | None | N/A |
| MM-019 | Core Game Module Interface | Complete | MM-017 | N/A |
| MM-020 | Deck Plugin for boardgame.io | Complete | MM-017, MM-019 | N/A |
| MM-021 | War Game Module | Complete | MM-019, MM-020, MM-018 | N/A |
| MM-022 | Poker Game Module (with Crypto) | Complete | MM-019, MM-020, MM-018, MM-029 | N/A |
| MM-023 | One Piece TCG Game Module | Ready | MM-019, MM-020 | `feature/game-onepiece` |
| MM-024 | MTG Game Module | Ready | MM-019, MM-020 | `feature/game-mtg` |
| MM-025 | Lorcana Game Module | Ready | MM-019, MM-020 | `feature/game-lorcana` |
| MM-026 | Riftbound Game Module | Ready | MM-019, MM-020 | `feature/game-riftbound` |
| MM-027 | Asset Pack Manifest Parser | Complete | None | N/A |
| MM-028 | Asset Pack Loader | Complete | MM-027 | N/A |
| MM-029 | Cryptographic Deck Plugin (Mental Poker) | Complete | MM-020 | N/A |
| MM-030 | War Game Crypto Integration | Complete | MM-021, MM-029 | N/A |
| MM-031 | Blockchain-Enabled Poker | Ready | MM-022, MM-029 | `feature/blockchain-poker` |

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
- MM-028: Asset Pack Loader (unblocked by MM-027)

### Ready for Agent
Game modules now ready (all deps complete):
- MM-022: Poker Game Module
- MM-023: One Piece TCG Game Module
- MM-024: MTG Game Module
- MM-025: Lorcana Game Module
- MM-026: Riftbound Game Module
- MM-028: Asset Pack Loader
- MM-030: War Game Crypto Integration

### Blocked
Tasks waiting on dependencies:
- MM-031: Blockchain-Enabled Poker (waiting on MM-022)

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

MM-017 (Complete) ✓
└── MM-019 (Complete) ✓
    └── MM-020 (Complete) ✓
        ├── MM-021 (Complete) ✓
        │   └── MM-030 (Ready - War Crypto Integration)
        ├── MM-022 (Ready - Poker)
        ├── MM-023 (Ready - One Piece)
        ├── MM-024 (Ready - MTG)
        ├── MM-025 (Ready - Lorcana)
        ├── MM-026 (Ready - Riftbound)
        └── MM-029 (Complete) ✓
            ├── MM-030 (Ready - War Crypto Integration)
            └── MM-031 (Blocked - Blockchain Poker)

MM-018 (Complete) ✓
├── MM-021 (Complete) ✓
└── MM-022 (Ready - Poker)
    └── MM-031 (Blocked - Blockchain Poker)

MM-027 (Complete) ✓
└── MM-028 (Ready - asset loader)
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
