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


Future Vision
ManaMesh aims to become a platform where the community collectively maintains card data, hosts game servers, and extends support for new games. By combining modern web technologies with decentralization primitives, we hope to create a lasting, player-owned alternative in the digital card game space.