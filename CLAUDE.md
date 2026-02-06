# CLAUDE.md

Read AGENTS.md in this repo.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ManaMesh is a decentralized, browser-based multiplayer platform for competitive card games (MTG, Lorcana, One Piece). It prioritizes P2P networking and IPFS-based storage to minimize server dependency and enable offline/LAN play.

## Commands

```bash
# Development (from repo root)
yarn dev:frontend    # Vite dev server for frontend
yarn dev:backend     # nodemon + ts-node for backend

# Build & Test
yarn build           # Build all workspaces
yarn test            # Run Vitest tests (frontend)

# Single test file
yarn workspace @manamesh/frontend test src/game/logic.test.ts
```

## Architecture

### Monorepo Structure
- **packages/frontend**: React + Vite + boardgame.io + Phaser
- **packages/backend**: Node.js + Express + libp2p (optional signaling server)

### Frontend Key Directories
- `src/game/` - boardgame.io game definitions (`game.ts`) and pure game logic (`logic.ts`)
- `src/p2p/` - P2P networking layer:
  - `webrtc.ts` - WebRTC wrapper for peer connections
  - `codec.ts` - Encode/decode SDP offers as shareable join codes
  - `discovery/join-code.ts` - Two-way join code connection flow
- `src/components/` - React components (GameBoard, P2PLobby)
- `src/App.tsx` - Main app with lobby routing

### P2P Connection Priority (no server required for gameplay)
1. **Two-way join codes** - Exchange offer/answer codes out-of-band (Discord, etc.)
2. **libp2p DHT** - Public peer discovery via Protocol Labs bootstrap nodes
3. **mDNS** - LAN-only automatic discovery
4. **Signaling server** - Optional fallback (backend)

### Game Logic Pattern
Game state lives in `src/game/logic.ts` as pure functions. The boardgame.io wrapper in `game.ts` calls these functions from moves. Keep game logic separate from boardgame.io framework code for testability.

## Tech Stack
- **Frontend**: React, boardgame.io (turn-based logic), Phaser 3 (rendering), TypeScript
- **P2P/Storage**: libp2p, helia (IPFS), WebTorrent, IndexedDB (offline cache)
- **Backend**: Express, libp2p, OrbitDB
- **Crypto (fairness)**: elliptic (mental poker), circomlibjs (ZKPs)
- **Testing**: Vitest

## Design Principles
- Gameplay works without any server (P2P first)
- Game-specific rules are modular handlers (MTG tutors vs One Piece top-deck peeks)
- In-play deck state uses cryptographic commitments; out-of-play decks are unencrypted for sharing
- IndexedDB caches IPFS assets for offline play
