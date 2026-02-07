# Task Index: ManaMesh

**Repo:** MM
**Last Updated:** 2026-02-06

## Active Tasks

| ID | Title | Status | Dependencies | Worktree |
|----|-------|--------|--------------|----------|
| MM-023 | One Piece TCG Game Module | Complete | MM-019, MM-020, MM-029 | - |
| MM-024 | MTG Game Module | Ready | MM-019, MM-020 | `feature/game-mtg` |
| MM-025 | Lorcana Game Module | Ready | MM-019, MM-020 | `feature/game-lorcana` |
| MM-026 | Riftbound Game Module | Ready | MM-019, MM-020 | `feature/game-riftbound` |
| MM-033 | One Piece Card Data Sources Research | Complete | - | - |
| MM-034 | Ethereum Wallet Integration | Complete | MM-029 | - |
| MM-035 | Bet Settlement & Escrow Vault | In Review | MM-034, MM-036 | - |
| MM-036 | Foundry Setup | Complete | - | - |
| MM-037 | One Piece Card Scraper & Asset Pack Builder | Complete | MM-033 | - |

## Status Legend

- **Ready** - All dependencies met, can be launched with `/backlog:launch`
- **In Progress** - Implementation agent working (has worktree)
- **In Review** - Implementation complete, awaiting code review
- **Changes Requested** - Review found issues, needs fixes
- **Complete** - Review passed, ready to archive with `/backlog:prune`
- **Blocked** - Waiting on dependencies

## Ready for Launch

All active tasks are ready (dependencies complete):

| ID | Title | Launch Command |
|----|-------|----------------|
| MM-023 | One Piece TCG Game Module (Rules-Agnostic + Crypto) | `/backlog:launch MM-023` |
| MM-024 | MTG Game Module | `/backlog:launch MM-024` |
| MM-025 | Lorcana Game Module | `/backlog:launch MM-025` |
| MM-026 | Riftbound Game Module | `/backlog:launch MM-026` |
| MM-033 | One Piece Card Data Sources Research | `/backlog:launch MM-033` |
| MM-034 | Ethereum Wallet Integration | `/backlog:launch MM-034` |
| MM-035 | Bet Settlement & Escrow Vault | `/backlog:launch MM-035` |
| MM-036 | Foundry Setup | `/backlog:launch MM-036` |
| MM-037 | One Piece Card Scraper & Asset Pack Builder | `/backlog:launch MM-037` |

## Dependency Graph

```
MM-019 (Complete, archived) ✓
└── MM-020 (Complete, archived) ✓
    ├── MM-024 (Ready - MTG)
    ├── MM-025 (Ready - Lorcana)
    └── MM-026 (Ready - Riftbound)

MM-029 (Complete, archived) ✓
├── MM-023 (Ready - One Piece TCG, also depends on MM-019, MM-020)
└── MM-034 (Ready - Ethereum Wallet Integration)
    └── MM-035 (Ready - Bet Settlement, also depends on MM-036)

MM-036 (Ready - Foundry Setup, no dependencies)
└── MM-035 (depends on MM-034 + MM-036)

MM-033 (Complete) ✓
└── MM-037 (Ready - One Piece Card Scraper)

MM-002 (Complete, archived) ✓
├── MM-003 (Complete, archived) ✓
├── MM-004 (Complete, archived) ✓
└── MM-032 (Complete, archived) ✓
```

## Cross-Repo Dependencies

Tasks in other repos that depend on this repo's tasks:
- (none yet)

## Archived Tasks

| ID | Title | Completed | Location |
|----|-------|-----------|----------|
| MM-001 | Frontend Skeleton + boardgame.io Core | 2026-01-21 | archive/MM-001.md |
| MM-002 | WebRTC + Two-Way Join Codes | 2026-01-21 | archive/MM-002.md |
| MM-003 | libp2p DHT Discovery | 2026-01-22 | archive/MM-003.md |
| MM-004 | mDNS Local Discovery | 2026-01-28 | archive/MM-004.md |
| MM-005 | boardgame.io P2P Transport | 2026-01-22 | archive/MM-005.md |
| MM-006 | IPFS Asset Loading + Caching | 2026-01-21 | archive/MM-006.md |
| MM-007 | Backend Signaling Fallback | 2026-01-28 | archive/MM-007.md |
| MM-008 | Stabilize Tests & Acceptance Criteria | 2026-01-28 | archive/MM-008.md |
| MM-009 | Implement Public Game Indexing | 2026-01-28 | archive/MM-009.md |
| MM-010 | Fix Public Game Key Encoding | 2026-01-28 | archive/MM-010.md |
| MM-011 | Confirm/Document Runtime Support | 2026-01-28 | archive/MM-011.md |
| MM-012 | Add DHT Record Expiry/Republish | 2026-01-28 | archive/MM-012.md |
| MM-013 | Fix AbortController Reuse in Gateway | 2026-01-28 | archive/MM-013.md |
| MM-014 | Clear Timeout Timers on Success | 2026-01-28 | archive/MM-014.md |
| MM-015 | Fix IPFS Config and Gateway Priority | 2026-01-28 | archive/MM-015.md |
| MM-016 | IPFS Code Cleanup and Test Improvements | 2026-01-28 | archive/MM-016.md |
| MM-017 | Set Up boardgame.io Fork Submodules | 2026-01-28 | archive/MM-017.md |
| MM-018 | Standard Playing Cards Asset Pack | 2026-01-28 | archive/MM-018.md |
| MM-019 | Core Game Module Interface | 2026-01-28 | archive/MM-019.md |
| MM-020 | Deck Plugin for boardgame.io | 2026-01-28 | archive/MM-020.md |
| MM-021 | War Game Module | 2026-01-28 | archive/MM-021.md |
| MM-022 | Poker Game Module (with Crypto) | 2026-01-28 | archive/MM-022-poker-game-module/ |
| MM-027 | Asset Pack Manifest Parser | 2026-01-28 | archive/MM-027.md |
| MM-028 | Asset Pack Loader | 2026-01-28 | archive/MM-028-asset-pack-loader/ |
| MM-029 | Cryptographic Deck Plugin (Mental Poker) | 2026-01-28 | archive/MM-029-crypto-deck-plugin/ |
| MM-030 | War Game Crypto Integration | 2026-01-28 | archive/MM-030-war-crypto-integration/ |
| MM-031 | Blockchain-Enabled Poker | 2026-01-28 | archive/MM-031-blockchain-poker/ |
| MM-032 | Hybrid P2P Transport | 2026-01-28 | archive/MM-032-hybrid-p2p-transport/ |
