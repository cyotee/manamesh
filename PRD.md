---
project: ManaMesh
version: 1.0
created: 2026-01-20
last_updated: 2026-01-20
---

# ManaMesh - Product Requirements Document

## Vision

ManaMesh is an open-source, browser-based multiplayer platform for playing competitive card games (MTG, Lorcana, One Piece, etc.). Built on decentralized technologies, it enables peer-to-peer gameplay without server dependency, ensuring the platform remains playable even if the original hosting service is discontinued.

## Problem Statement

Existing card game platforms (like Untap.in) rely on centralized servers, creating single points of failure and limiting community ownership. Players want a resilient, extensible platform where they can build decks, play matches, and share deck lists without depending on a single service provider.

## Target Users

| User Type | Description | Primary Needs |
|-----------|-------------|---------------|
| Competitive Players | Card game enthusiasts who test decks and play matches | Reliable P2P gameplay, deck building, fair play mechanics |
| Community Hosts | Users who want to run their own game servers | Self-hostable codebase, modular architecture |
| Game Developers | Contributors adding support for new card games | Pluggable game handlers, clear interfaces |

## Goals

### Primary Goals

1. Deliver fully decentralized P2P gameplay with NO signaling server required
2. Support multiple card games through modular game handlers
3. Enable offline/LAN play and community self-hosting
4. Provide cryptographic fairness for in-play deck operations

### Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| P2P Game Completion | Two players complete a full game via P2P | Manual + integration test |
| Self-Hostability | Community can fork and run their own instance | Documentation + Docker setup |
| Build Stability | All workspaces build without errors | `yarn build` passes |

## Non-Goals (Out of Scope)

- Official tournament hosting or ranking systems
- Mobile-native apps (PWA only for MVP)
- Real-money transactions or betting
- Automated rules enforcement beyond basic game flow
- Card image hosting (IPFS/community-seeded only)

## Key Features

### Feature 1: P2P Gameplay (Decentralized-First)

Multiple connection methods prioritized by decentralization:
1. **Two-way join codes** - Exchange SDP offers out-of-band (zero servers)
2. **libp2p DHT** - Single join code via public bootstrap nodes
3. **mDNS** - Automatic LAN discovery
4. **Signaling server** - Optional fallback only if needed

### Feature 2: boardgame.io Game Engine

Turn-based multiplayer using boardgame.io for state synchronization. Game-specific rules implemented as pluggable handlers (MTG tutors, One Piece top-deck peeks, etc.).

### Feature 3: IPFS Asset Distribution

Card images and assets loaded from IPFS with IndexedDB caching for offline play. Gateway fallback for reliability.

### Feature 4: Cryptographic Fair Play

In-play deck state uses commitments and mental poker techniques. Out-of-play decks are unencrypted for sharing.

## Technical Requirements

### Architecture

Monorepo with two packages:
- **Frontend** (`packages/frontend`): React + Vite + boardgame.io + Phaser
- **Backend** (`packages/backend`): Node.js + Express + libp2p (optional)

### Integrations

| System | Purpose | Type |
|--------|---------|------|
| libp2p | P2P networking, DHT discovery | Read/Write |
| IPFS (helia) | Decentralized asset storage | Read |
| IndexedDB | Local caching, offline storage | Read/Write |
| WebRTC | Direct peer data channels | Read/Write |

### Networks

| Network | Purpose | Priority |
|---------|---------|----------|
| Browser (WebRTC) | Primary P2P transport | P0 |
| LAN (mDNS) | Local discovery | P1 |
| Internet (DHT) | Global discovery | P1 |

### Security Requirements

- Cryptographic commitments for in-play deck state (prevent cheating)
- Mental poker protocols for verifiable shuffles
- ZKP support for provable search operations (future)
- No centralized auth required for basic gameplay

### Constraints

- Must work without any server running (join code method)
- Browser-only for MVP (no native apps)
- WebRTC data channels for game state (not media)

## Development Approach

### Repository Structure

```
manamesh/
├── packages/
│   ├── frontend/     # React + boardgame.io + Phaser
│   │   └── src/
│   │       ├── game/       # boardgame.io definitions
│   │       ├── p2p/        # P2P networking layer
│   │       ├── components/ # React UI
│   │       └── assets/     # IPFS loader
│   └── backend/      # Optional signaling server
├── tasks/            # Task management
└── design.yaml       # Repo configuration
```

### Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| Game Logic | `frontend/src/game/` | Pure game state functions |
| P2P Layer | `frontend/src/p2p/` | WebRTC, codecs, discovery |
| UI | `frontend/src/components/` | React components |
| Backend | `backend/src/` | Optional signaling/metadata |

### Key Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| boardgame.io | ^0.50.2 | Turn-based game framework |
| phaser | ^3.80.1 | 2D rendering engine |
| helia | ^4.0.1 | Browser IPFS node |
| libp2p | ^3.0.3 | P2P networking |
| elliptic | ^6.5.5 | Cryptographic operations |

### Testing Requirements

- Unit tests (Vitest) for game logic and P2P codecs
- Integration test: two browser tabs connect and complete a game
- `yarn build` must produce type-checked builds
- P2P connection must work without any server running

### Documentation Standards

- CLAUDE.md for AI agent context
- PRD.md for product requirements
- Task files in tasks/ directory

## Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| M1 | Frontend skeleton + boardgame.io core | Done |
| M2 | P2P Layer: WebRTC + Two-Way Join Codes | In Progress |
| M3 | P2P Layer: libp2p DHT Discovery | Planned |
| M4 | P2P Layer: mDNS Local Discovery | Planned |
| M5 | boardgame.io P2P Transport Integration | Planned |
| M6 | IPFS Asset Loading + Caching | Planned |
| M7 | Stabilize Tests & Acceptance Criteria | Ongoing |

## Appendix

### Glossary

| Term | Definition |
|------|------------|
| SDP | Session Description Protocol - WebRTC connection metadata |
| DHT | Distributed Hash Table - decentralized peer lookup |
| mDNS | Multicast DNS - local network service discovery |
| CID | Content Identifier - IPFS content-addressed hash |
| Mental Poker | Cryptographic protocol for fair card games without trusted third party |

### References

- [boardgame.io Documentation](https://boardgame.io/documentation/)
- [libp2p Documentation](https://docs.libp2p.io/)
- [IPFS/Helia Documentation](https://helia.io/)
- CardGameTechStackDesign.markdown (detailed architecture)
- PRD_Implementation.md (implementation tasks)
