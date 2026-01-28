ManaMesh — Project Overview and Technology Choices
Project Intent
ManaMesh is an open-source, browser-based multiplayer platform for playing competitive card games such as Magic: The Gathering, One Piece Card Game, Lorcana, and others. It is inspired by existing play-testing tools like Untap.in, but designed from the ground up to be more performant, extensible, and resilient.
The core intent of the project is to create a community-owned and community-operated digital card game ecosystem that:

Allows players to build decks, play matches, and share deck lists in a way that mirrors real-world competitive card game culture.
Minimizes reliance on centralized servers by leveraging peer-to-peer networking and decentralized storage.
Remains playable even if the original hosting service is discontinued, through offline/LAN support and open-source code.
Enables community members to host their own matchmaking, signaling, or seeding servers without requiring a specific technology stack.
Provides a freemium model where core gameplay is free, while premium features (e.g., cloud deck sync, ad-free experience) add value without gating essential play.

ManaMesh is built for card game enthusiasts and developers who value openness, decentralization, and long-term sustainability.
Key Design Principles

Modularity – Game-specific rules (e.g., MTG tutors vs. One Piece top-deck peeks) are implemented as pluggable handlers.
Decentralization – Gameplay networking, asset distribution, and deck storage use peer-to-peer and IPFS-based technologies.
Security & Fairness – In-game deck state uses cryptographic commitments and mental poker techniques to prevent cheating while allowing open deck sharing outside of matches.
Open Source First – The entire codebase is intended to be released under a permissive license (MIT or Apache 2.0) to encourage community contributions and self-hosting.
Progressive Enhancement – The app works as a Progressive Web App (PWA) and can be packaged for desktop/mobile, supporting fully detached play.

Technology Choices
Frontend & Game Engine

React + Vite – Fast development server with hot module replacement for rapid iteration.
boardgame.io – Turn-based multiplayer game framework that handles state synchronization, moves, and phases. Chosen for its simplicity and excellent TypeScript support.
Phaser 3 – Lightweight 2D rendering engine for card interactions, animations, drag-and-drop, and visual effects.
TypeScript – Provides type safety across the entire stack, especially important for modular game rules and cryptographic operations.

Networking & Peer-to-Peer

libp2p (JavaScript implementation) – Core P2P networking layer supporting WebRTC data channels, mDNS (LAN discovery), and DHT (global peer discovery). Enables serverless matchmaking and gameplay in detached mode.

Decentralized Storage & Data Distribution

helia (JS IPFS implementation) – Browser-native IPFS node for adding, pinning, and retrieving content-addressed data.
OrbitDB – Decentralized, peer-replicated database built on IPFS. Used for storing and sharing deck lists and community card data.
WebTorrent – Optional hybrid torrenting for faster distribution of larger asset packages.
IndexedDB – Local browser persistence for offline deck storage and caching of IPFS content.

Backend & Metadata

Node.js + Express – Minimal backend for optional centralized services (signaling, matchmaking, premium sync).
MongoDB Atlas – Serves as a searchable directory of IPFS CIDs and magnet links. Stores user profiles, premium subscription data, and metadata for discoverability. Community servers can replace or fork this component.

Cryptography & Fair Play

elliptic – Elliptic curve operations used in mental poker protocols.
circomlibjs / snarkyjs – Zero-knowledge proof support for verifiable deck operations (e.g., proving a search was performed correctly without revealing the deck).

Build & Development Tools

Yarn Workspaces – Monorepo management for frontend and backend packages.
Vitest – Fast unit testing integrated with Vite.
ESLint + Prettier – Code quality and formatting.

Why These Choices?



Goal
Technology Choice
Reason



Fast iteration
Vite + React + TypeScript
Instant HMR, excellent developer experience


Turn-based multiplayer logic
boardgame.io
Proven, simple, TypeScript-first framework


Card visuals & interaction
Phaser 3
Lightweight, mature, great for 2D card games


Decentralized gameplay
libp2p
Browser-native P2P with WebRTC, mDNS, and DHT support


Decentralized asset storage
helia + OrbitDB + IPFS
Content-addressed, peer-seeded distribution; resilient to central failure


Searchable metadata
MongoDB Atlas + Atlas Search
Fast full-text search over CIDs; easy to self-host or replace


Fair play without full trust
Mental poker, commitments, ZKPs
Prevents cheating while allowing open deck sharing outside matches


Community ownership
Open-source (MIT/Apache) + modular design
Anyone can host servers, contribute games, or fork the project


Development Setup

## Prerequisites

- Node.js 20.x or later
- Yarn 4.x (Berry)

## Cloning with Submodules

This repository uses git submodules for forked dependencies. Clone with:

```bash
git clone --recurse-submodules https://github.com/cyotee/manamesh.git
```

Or if you've already cloned:

```bash
git submodule update --init --recursive
```

## Vendor Submodules

The `vendor/` directory contains forked versions of boardgame.io dependencies:

| Package | Path | Description |
|---------|------|-------------|
| boardgame.io | vendor/boardgame.io | Core game framework (forked for P2P transport) |
| @boardgame.io/p2p | vendor/boardgameIO-p2p | P2P transport layer |

### Working with Submodules

**Update submodules to latest:**
```bash
git submodule update --remote --merge
```

**Make changes to a submodule:**
```bash
cd vendor/boardgame.io
# Make your changes
git commit -am "Your changes"
git push origin main
cd ../..
git add vendor/boardgame.io
git commit -m "Update boardgame.io submodule"
```

**Switch submodule to a different branch:**
```bash
cd vendor/boardgame.io
git checkout feature-branch
cd ../..
git add vendor/boardgame.io
git commit -m "Switch boardgame.io to feature-branch"
```

## Installation

```bash
yarn install
```

## Running

```bash
# Start frontend development server
yarn dev:frontend

# Run tests
yarn test

# Build all packages
yarn build
```

## P2P Transport Options

ManaMesh uses a hybrid P2P transport system that automatically selects the best connection method. This eliminates dependency on centralized STUN servers while maintaining compatibility with various network environments.

### Transport Priority

The system tries transports in this order (first successful wins):

| Priority | Transport | Best For | STUN Required |
|----------|-----------|----------|---------------|
| 1 | **LAN / Local Network** | Same WiFi/network, LAN parties | No |
| 2 | **Direct IP** | VPN users, port-forwarded setups | No |
| 3 | **Circuit Relay** | NAT traversal via Protocol Labs nodes | No |
| 4 | **Join Code** | Fallback with copy/paste SDP exchange | Yes (Google STUN) |

### Configuring Transports

#### In-App Settings

Click the **settings gear** in the P2P Lobby to open the Transport Settings modal:

- **Enable/Disable** individual transports
- **Force Transport** - Select a specific transport for testing
- **Verbose Logging** - Enable detailed console logs for debugging
- **Generate URL** - Create shareable links with your transport config

#### URL Parameters

Override transport settings via URL for testing or sharing:

```bash
# Force a specific transport
http://localhost:3000/?transport=relay     # Force Circuit Relay only
http://localhost:3000/?transport=lan       # Force LAN only
http://localhost:3000/?transport=joinCode  # Force Join Code only

# Reset to defaults
http://localhost:3000/?transport=all       # Enable all transports

# Enable specific transports
http://localhost:3000/?transport=lan,relay # Only LAN and Relay

# Enable verbose logging
http://localhost:3000/?verbose=true
```

### Transport Details

#### LAN / Local Network (Recommended for Local Play)
- Uses mDNS for automatic peer discovery on the same network
- No internet required - works completely offline
- Lowest latency for local multiplayer

#### Direct IP
- Manual IP:port exchange for custom setups
- Ideal for VPN connections or port-forwarded home servers
- Bypasses NAT issues when you control the network

#### Circuit Relay
- NAT traversal via Protocol Labs' decentralized relay network
- No STUN servers - uses libp2p circuit relay v2
- Works across most network configurations

#### Join Code (Legacy Fallback)
- Two-way SDP offer/answer exchange via copy/paste
- Uses Google STUN servers for ICE candidate gathering
- Most compatible but requires external code sharing (Discord, etc.)

### Persistence

- Settings are automatically saved to `localStorage`
- URL parameters override localStorage for the current session
- Use "Reset to Defaults" to clear saved preferences

### Troubleshooting

**Connection fails on all transports:**
1. Check if both players have at least one common transport enabled
2. Try forcing a specific transport to isolate the issue
3. Enable verbose logging and check the browser console

**LAN transport not working:**
- Verify both devices are on the same network
- Some networks block mDNS - try Direct IP instead

**Relay transport slow:**
- Relay adds latency due to routing through third-party nodes
- If on same network, ensure LAN transport is enabled

## Game Modules

ManaMesh uses a pluggable game module system. Each game (War, Poker, MTG, etc.) is implemented as a module that provides:
- Card types and schemas
- Zone definitions (deck, hand, battlefield, etc.)
- Game logic and moves
- boardgame.io integration

### Available Game Modules

| Module | Status | Description |
|--------|--------|-------------|
| War | Complete | Classic War card game - flip cards, higher wins |
| Poker | Ready | Texas Hold'em (planned) |
| MTG | Ready | Magic: The Gathering (planned) |

### Testing the War Game Module

The War game module is the first complete implementation. To run its tests:

```bash
# Run War game tests
yarn workspace @manamesh/frontend test src/game/modules/war/game.test.ts

# Run with watch mode for development
yarn workspace @manamesh/frontend test src/game/modules/war/game.test.ts --watch

# Run all game module tests
yarn workspace @manamesh/frontend test src/game/modules/
```

#### War Game Rules

1. **Setup**: A standard 52-card deck is shuffled and split evenly between two players (26 cards each)
2. **Gameplay**: Each player flips their top card simultaneously
3. **Winning a Round**: The player with the higher card wins both cards
4. **War**: If cards match, each player places 3 cards face-down and 1 face-up. Higher face-up card wins all cards
5. **Victory**: First player to collect all 52 cards wins

#### War Module Structure

```
packages/frontend/src/game/modules/war/
├── types.ts       # WarCard, WarState, zone definitions
├── game.ts        # boardgame.io Game, moves, validation
├── index.ts       # Module exports
└── game.test.ts   # 56 tests covering full game flow
```

#### Using the War Module

```typescript
import { WarModule, WarGame } from './game/modules/war';

// Get the boardgame.io Game definition
const game = WarModule.getBoardgameIOGame();

// Create initial state
const state = WarModule.initialState({
  numPlayers: 2,
  playerIDs: ['0', '1'],
});

// Validate a move
const result = WarModule.validateMove(state, 'flipCard', '0');
```

Future Vision
ManaMesh aims to become a platform where the community collectively maintains card data, hosts game servers, and extends support for new games. By combining modern web technologies with decentralization primitives, we hope to create a lasting, player-owned alternative in the digital card game space.