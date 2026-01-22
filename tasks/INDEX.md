# Task Index: ManaMesh

**Repo:** MM
**Last Updated:** 2026-01-21

## Active Tasks

| ID | Title | Status | Dependencies | Worktree |
|----|-------|--------|--------------|----------|
| MM-001 | Frontend Skeleton + boardgame.io Core | Complete | None | N/A |
| MM-002 | WebRTC + Two-Way Join Codes | Complete | MM-001 | N/A |
| MM-003 | libp2p DHT Discovery | In Progress | MM-002 | `feature/libp2p-dht` |
| MM-004 | mDNS Local Discovery | Ready | MM-002 | `feature/mdns-discovery` |
| MM-005 | boardgame.io P2P Transport | In Progress | MM-002 | `feature/bgio-p2p-transport` |
| MM-006 | IPFS Asset Loading + Caching | Complete | MM-001 | N/A |
| MM-007 | Backend Signaling Fallback | Blocked | MM-002, MM-003, MM-004 | `feature/signaling-server` |
| MM-008 | Stabilize Tests & Acceptance Criteria | Ready | MM-001, MM-002 | `feature/test-stabilization` |
| MM-009 | Implement Public Game Indexing | Blocked | MM-003 | `feature/public-game-indexing` |
| MM-010 | Fix Public Game Key Encoding | Blocked | MM-003 | `feature/fix-dht-key-encoding` |
| MM-011 | Confirm/Document Runtime Support | Blocked | MM-003 | `feature/runtime-compat` |
| MM-012 | Add DHT Record Expiry/Republish | Blocked | MM-003 | `feature/dht-record-expiry` |

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
- MM-003: libp2p DHT Discovery
- MM-004: mDNS Local Discovery
- MM-005: boardgame.io P2P Transport
- MM-008: Stabilize Tests & Acceptance Criteria

### Blocked
Tasks waiting on dependencies:
- MM-007: Backend Signaling Fallback → DEFERRED (waiting on MM-003, MM-004)
- MM-009: Implement Public Game Indexing (waiting on MM-003)
- MM-010: Fix Public Game Key Encoding (waiting on MM-003)
- MM-011: Confirm/Document Runtime Support (waiting on MM-003)
- MM-012: Add DHT Record Expiry/Republish (waiting on MM-003)

## Dependency Graph

```
MM-001 (Complete)
├── MM-002 (Complete) ✓
│   ├── MM-003 (In Progress)
│   │   ├── MM-009 (Blocked - public game indexing)
│   │   ├── MM-010 (Blocked - key encoding fix)
│   │   ├── MM-011 (Blocked - runtime compat)
│   │   └── MM-012 (Blocked - record expiry)
│   ├── MM-004 (Ready)
│   ├── MM-005 (In Progress)
│   └── MM-007 (Blocked - needs MM-003, MM-004)
├── MM-006 (Complete) ✓
└── MM-008 (Ready)
```

## Cross-Repo Dependencies

Tasks in other repos that depend on this repo's tasks:
- (none yet)
