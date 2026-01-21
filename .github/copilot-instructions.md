# Copilot instructions for contributors and AI coding agents

> UPDATED: concise, repo-specific guidance (inserted by AI agent)

This short guide captures repository-specific knowledge an AI agent needs to be productive.

### Quick repo facts
- Monorepo managed by Yarn v4 workspaces (`packages/*`).
- TypeScript across workspaces. Frontend uses Vite; backend runs via `ts-node` in dev.

### Common commands (repo root)
- Frontend dev: `yarn dev:frontend` (runs `vite`).
- Backend dev: `yarn dev:backend` (runs `nodemon --exec ts-node src/index.ts`).
- Build all: `yarn build` (runs workspace `build` scripts).
- Run tests: `yarn test` (Vitest used in frontend workspace).

### Quick pointers
- UI entry: `packages/frontend/src/App.tsx`.
- Game logic: add/modify boardgame.io `moves`/`flow` in frontend (game state is authoritative).
- Signaling/API: `packages/backend/src/index.ts`.

See the rest of this file for design and architecture context (original content preserved below).
## Project Overview
- **manamesh** is a modular, open-source platform for browser-based multiplayer card games (e.g., MTG, Lorcana, One Piece).
- Architecture is hybrid: minimal Node.js backend (signaling, matchmaking, metadata) + decentralized P2P frontend (gameplay, asset sharing).
- Key design goals: minimize server load, enable offline/detached play, and support community-driven extensibility.

## Major Components
- **Frontend** (`packages/frontend/`):
  - Built with React, boardgame.io (game logic), Phaser (2D rendering), and P2P libraries (libp2p, IPFS, WebTorrent).
  - Modular game handlers for different card games; assets and decks loaded via IPFS/WebTorrent.
  - IndexedDB used for offline/local storage.
- **Backend** (`packages/backend/`):
  - Node.js + Express server for matchmaking, signaling, and MongoDB metadata aggregation.
  - Designed to be community-hostable and optional for detached play.

## Developer Workflows
- **Install dependencies:**
  - Run `npm install` at the root, then in each package (`packages/frontend`, `packages/backend`).
- **Build:**
  - Frontend: `npm run build` in `packages/frontend` (uses Vite).
  - Backend: `npm run build` in `packages/backend`.
- **Run (dev):**
  - Frontend: `npm run dev` in `packages/frontend`.
  - Backend: `npm run dev` in `packages/backend`.
- **Test:**
  - (If implemented) Use `npm test` in the relevant package.

## Key Patterns & Conventions
- **Modularity:**
  - Game logic and deck state are abstracted for easy extension (see `CardGameTechStackDesign.markdown`).
  - Use interfaces for deck handlers, data providers, and server modules.
- **Decentralized Storage:**
  - Prefer IPFS/WebTorrent for assets/decks; MongoDB is only for metadata.
  - Use CIDs/magnet links for referencing assets.
- **P2P Networking:**
  - Use libp2p for gameplay and discovery; supports mDNS (LAN) and DHT (global).
  - Detached/offline play is a first-class feature—avoid hard dependencies on backend.
- **Security:**
  - In-play decks use cryptographic protocols (commitments, ZKPs) for fairness.
  - Out-of-play decks are unencrypted for sharing.
- **Freemium Model:**
  - Free: local/P2P play, public sharing. Premium: cloud sync, ad-free, priority features.

## Integration Points
- **Frontend ↔ Backend:**
  - REST/GraphQL APIs for matchmaking and metadata (see backend `src/`).
  - P2P channels for gameplay; backend is not required for local/LAN play.
- **External Services:**
  - MongoDB Atlas for metadata aggregation.
  - IPFS gateways and WebTorrent for asset distribution.

## References
- See `CardGameTechStackDesign.markdown` for detailed architecture, tech stack, and rationale.
- Key code: `packages/frontend/src/`, `packages/backend/src/`.

---

**When contributing code or using AI agents, follow the modular, decentralized, and open-source principles outlined above.**
