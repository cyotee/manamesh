# Tech Stack Definition and Design Document

## Document Overview
**Version**: 1.0  
**Date**: September 28, 2025  
**Authors**: Grok (based on collaborative discussion with user)  
**Purpose**: This document defines the tech stack and high-level design for a browser-based multiplayer card game application, inspired by Untap.in. The app supports real-time/turn-based play for games like Magic: The Gathering (MTG), Lorcana, and One Piece, with features like deck building, user-uploaded cards, modular game mechanics, and a freemium model. It emphasizes decentralization to minimize server load, enable detached/offline play, and foster community involvement through open-sourcing.

The design prioritizes:
- **Modularity**: For game-specific deck state management and extensibility.
- **Decentralization**: Using P2P and IPFS for data sharing to reduce central server dependency.
- **Security/Fairness**: Cryptographic protocols for in-play decks; unencrypted decks out-of-play for sharing.
- **Freemium**: Core features free; premium for conveniences like cloud sync.
- **Open-Source**: Codebase releasable under MIT/Apache 2.0 to encourage community-hosted servers.

This is a living document; evolve it based on prototypes and feedback.

## High-Level Architecture
The app follows a hybrid centralized-decentralized model:
- **Frontend**: Browser-based (PWA for offline), packaged for desktop/mobile via Electron/Capacitor.
- **Backend**: Minimal Node.js server for signaling/matchmaking; community-hostable.
- **Storage**: Decentralized (IPFS/OrbitDB for assets/decks) with MongoDB as metadata aggregator.
- **Networking**: libp2p for P2P gameplay and discovery (mDNS/DHT).
- **Deployment**: Open-source codebase; your service hosts a reference server, but users/communities can self-host.

### Key Principles
- **Minimize Server Load**: P2P for gameplay; users seed data via IPFS/WebTorrent.
- **Detached Play**: Fully functional offline/LAN via mDNS; persists if service terminates.
- **Modularity**: Abstract interfaces for deck handlers, data providers, and servers.
- **Freemium Model**: Free: Local/P2P play, basic sharing. Premium: Cloud sync, ad-free, priority features.
- **Security**: In-play encryption (commitments, mental poker, ZKPs); out-of-play unencrypted for sharing.

## Tech Stack Components

### 1. Frontend / Game Engine
- **boardgame.io**: Core for turn-based game logic, multiplayer state management, and modular rules. Handles phases (e.g., draws, combats) and moves (e.g., peekTopX, searchLibrary).
  - **Why**: View-agnostic; integrates with Phaser for UI. Supports plugins for game-specific handlers.
  - **Implications**: Modular deck state (e.g., One Piece handler for top-X peeks; MTG for tutors/reshuffles) uses crypto libraries (e.g., elliptic for commitments, circom for ZKPs).
- **Phaser**: 2D rendering engine for card interactions (drag-and-drop, animations).
  - **Why**: Browser-native; performant for card stacking/flips. Integrates with boardgame.io for state-driven UI.
  - **Implications**: Loads assets from IPFS CIDs; uses IndexedDB for local caching.
- **React (with Hooks/Redux)**: UI framework for deck builder, lobbies, and menus.
  - **Why**: Component-based; handles dynamic states like search results from Atlas Search.
- **Additional Libraries**:
  - **helia/js-ipfs**: For IPFS node in browser; fetch/pin CIDs.
  - **webtorrent**: For torrenting IPFS packages; hybrid with IPFS for faster multi-source downloads.
  - **idb-keyval/IndexedDB**: Browser persistence for local decks/images; ~100MB quota for offline.
  - **Crypto Tools**: elliptic (elliptic curves for mental poker), circom/snarkyjs (ZKPs for verifications).

### 2. Backend / Server
- **Node.js with Express**: Minimal server for signaling, matchmaking, and MongoDB interactions.
  - **Why**: Non-blocking; integrates with libp2p for bootstrapping.
  - **Implications**: Open-source for community hosting; optional for detached play (fallback to manual signaling).
- **Deployment**: AWS Lambda/Heroku for your instance; Docker for self-hosting. Serverless for scaling.

### 3. Database / Storage
- **MongoDB with Atlas Search**: Metadata aggregator for CIDs/magnet links, user profiles, and search.
  - **Why**: NoSQL flexibility for varied card formats; Atlas Search for deck queries (full-text, fuzzy).
  - **Implications**: Stores `{cid: string, magnet: string, metadata: {...}}`; serves as directory, not full data host. Community servers can fork/replace with alternatives (e.g., PostgreSQL via modular provider).
- **OrbitDB**: Decentralized DB on IPFS for decks/assets.
  - **Why**: Offline-first, replicable stores (e.g., docstore for decks); CRDTs for conflicts.
  - **Implications**: Public stores for shared decks (unencrypted JSON); private for premium. Users pin/seeds, reducing your load.
- **IPFS/WebTorrent**: Content-addressed storage for packages (card lists, images).
  - **Why**: P2P distribution; CIDs ensure integrity. WebTorrent for swarm efficiency.
  - **Implications**: Users seed consumed data; fallback gateways (e.g., ipfs.io) for unpinned items.
- **AWS S3 (Fallback)**: Initial seeding or premium backups.
  - **Why**: Reliable for cold starts; phase out as community grows.

### 4. Networking / P2P
- **libp2p**: Core for P2P connections, discovery (mDNS for LAN, DHT for global), and PubSub.
  - **Why**: Browser-native; integrates with OrbitDB/IPFS. Supports WebRTC for gameplay channels.
  - **Implications**: Enables detached play (no server); users host nodes for matchmaking/seeding. Modular for crypto exchanges (e.g., proofs over channels).
- **WebRTC**: Built-in for data channels (via libp2p); STUN for NAT (public servers), TURN as fallback.

### 5. Security and Crypto
- **In-Play**: Modular handlers use commitments (Merkle trees), mental poker (elliptic), ZKPs (circom) for fairness/peeking prevention.
- **Out-of-Play**: Unencrypted for sharing; optional private OrbitDB stores.
- **Implications**: Reduces overhead outside play; community can extend crypto without breaking sharing.

### 6. Freemium Model
- **Free Tier**: Local decks (IndexedDB), P2P play (libp2p), public sharing (OrbitDB CIDs), ads in Phaser.
- **Premium Tier**: Cloud sync (MongoDB-mediated), ad-free, priority seeding, cross-device backups.
- **Implications**: Data syncing as value-add; rewards for community seeders (tracked in MongoDB). Open-source encourages free alternatives, but your service offers convenience.

### 7. Open-Source Strategy
- **License**: MIT/Apache 2.0 for codebase.
- **Implications**: Users self-host servers (e.g., Node.js for matchmaking, libp2p nodes for seeding). Standard APIs (e.g., GraphQL for `/getCIDs`) ensure interoperability. Community contributions for new games/handlers; risks fragmentation (mitigate with core repo governance).
- **Hosting**: GitHub for repo; docs for self-setup (e.g., Docker Compose for nodes).

### 8. Deployment and Operations
- **Your Service**: Minimal Node.js + MongoDB on AWS/Heroku; auto-scale with Lambda.
- **Community**: Self-hosted via open-source; incentivize with credits.
- **Monitoring**: Datadog/Sentry for errors; libp2p metrics for P2P health.
- **Testing**: Jest/Cypress for frontend; simulate P2P swarms locally.

### Risks and Mitigations
- **Data Availability**: Unpinned decks may vanish; mitigate with app prompts to pin and your seed nodes.
- **Latency**: IPFS fetches slow; cache in IndexedDB, use WebTorrent for acceleration.
- **Cheating**: Rely on in-play crypto; community servers could vary enforcement—standardize handlers.
- **Legal**: Disclaimers for IP (e.g., MTG cards); privacy for shared decks.
- **Adoption**: UX for P2P/sharing may intimidate; tutorials and incentives help.

This design ensures scalability, resilience, and community growth. For updates, iterate based on prototypes.