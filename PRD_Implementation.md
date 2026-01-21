Product Requirements & Implementation Plan — manamesh (implementation + testing only)

Purpose
-------
Keep this PRD narrowly focused on what must be implemented and tested for an MVP that demonstrates the core product features: a boardgame.io turn engine, P2P gameplay channels, and IPFS-backed asset loading.

High-level Goals (MVP)
----------------------
- Deliver a runnable frontend that can host/join a room and run a simple two-player card game using boardgame.io.
- Provide fully decentralized P2P gameplay channels with NO signaling server required.
- Load game assets from IPFS and cache them in IndexedDB.
- Provide automated unit and integration tests that validate game logic and P2P message exchange.

P2P Implementation Strategy (Decentralized-First)
-------------------------------------------------
We prioritize serverless P2P approaches to stay true to the decentralization goals. Implementation order:

### Priority 1: Two-Way Join Codes (Fully Serverless)
- Player A creates game, generates an "offer code" containing WebRTC SDP offer
- Player A shares code out-of-band (Discord, text, etc.)
- Player B enters code, generates an "answer code" containing WebRTC SDP answer
- Player B shares answer code back to Player A
- Player A enters answer code → Direct WebRTC connection established
- **Pros**: Zero servers, works anywhere, simple to implement
- **Cons**: Requires two code exchanges (slightly clunky UX)
- **Use case**: Private games between friends, remote testing

### Priority 2: libp2p DHT Discovery (Public Infrastructure)
- Players connect to public libp2p bootstrap nodes (run by Protocol Labs)
- Player A publishes offer to DHT under a game room key
- Player B looks up room key, retrieves offer, publishes answer
- Direct P2P connection established
- **Pros**: Single join code UX, no server YOU run
- **Cons**: Depends on public libp2p infrastructure availability
- **Use case**: Public game lobbies, seamless matchmaking

### Priority 3: mDNS Local Discovery (LAN Only)
- Automatic peer discovery on local network via multicast DNS
- Zero configuration, zero servers
- **Pros**: Instant local testing, zero setup
- **Cons**: LAN only, won't work over internet
- **Use case**: Local development, LAN parties

### Priority 4: Signaling Server (Optional Fallback)
- Minimal WebSocket server (~50 lines) for WebRTC signaling
- Only implement if users request it or other methods prove unreliable
- Can be self-hosted or deployed to free tiers (Fly.io, Railway)
- **Pros**: Most reliable, cleanest UX
- **Cons**: Requires running/hosting a server
- **Use case**: Fallback when P2P discovery fails, corporate networks

Scope (what to implement now)
----------------------------
- Frontend (`packages/frontend`):
  - Lobby UI to create/join rooms and start games.
  - boardgame.io game definition for a simple two-player card game (draw, play, end turn). [DONE]
  - P2P layer with multiple discovery methods:
    - WebRTC wrapper for data channels
    - Two-way join code system (encode/decode SDP offers/answers)
    - libp2p DHT integration for single-code discovery
    - mDNS for LAN discovery (local testing)
  - Custom boardgame.io multiplayer transport using P2P layer
  - IPFS asset loader (helia/js-ipfs) with IndexedDB caching utilities.
  - Unit tests (Vitest) for game logic and select integration tests for P2P interactions.
- Backend (`packages/backend`):
  - Signaling server implementation deferred (Priority 4 - only if needed)
  - Small metadata endpoint for CID lookups (optional but helpful for debugging).

Milestones (implementation-focused)
----------------------------------
1) Frontend skeleton + boardgame.io core [DONE]
  - Implement lobby and the simplest playable game (deck, draw, play mechanics).
  - Add unit tests for moves and critical game-state transitions.
  - Dark theme UI implemented.

2) P2P Layer: WebRTC + Two-Way Join Codes
  - Implement WebRTC wrapper for creating/managing data channels.
  - Implement SDP offer/answer encoding as shareable codes (base64 + compression).
  - Create UI for "Create Game" (shows offer code) and "Join Game" (enter offer, show answer).
  - Implement answer code entry to complete connection.
  - Test with two browser tabs locally, then with remote user.

3) P2P Layer: libp2p DHT Discovery
  - Integrate libp2p with public bootstrap nodes.
  - Implement DHT-based room publishing/discovery.
  - Create UI for browsing public games or joining via single room code.
  - Test peer discovery across different networks.

4) P2P Layer: mDNS Local Discovery
  - Implement mDNS discovery for LAN play.
  - Auto-discover peers on local network.
  - Useful for local development and LAN parties.

5) boardgame.io P2P Transport
  - Create custom multiplayer transport that uses P2P layer.
  - Integrate with existing game logic.
  - Ensure game state syncs correctly between peers.

6) IPFS asset loading and caching
  - Add helia/js-ipfs integration and IndexedDB caching for images/assets.
  - Test asset load success/fallback behavior (gateway fallback).

7) Backend signaling fallback (OPTIONAL - implement last if needed)
  - Minimal WebSocket signaling endpoint (~50 lines).
  - Only implement if decentralized methods prove unreliable for users.
  - Can be self-hosted or deployed to free tiers.

8) Stabilize tests & acceptance criteria (ongoing)
  - Harden unit and integration tests until they consistently pass locally.
  - Integration test: two browser instances complete a game via P2P.

Implementation tasks (file-level)
--------------------------------
- `packages/frontend/src/game/` — boardgame.io game definitions, moves, and flows. [DONE]
- `packages/frontend/src/components/` — React components (GameBoard, Lobby, etc.). [DONE]
- `packages/frontend/src/p2p/` — P2P networking layer:
  - `webrtc.ts` — WebRTC wrapper for data channels, offer/answer creation
  - `codec.ts` — Encode/decode SDP to shareable join codes (base64 + compression)
  - `discovery/join-code.ts` — Two-way join code discovery mechanism
  - `discovery/dht.ts` — libp2p DHT-based discovery
  - `discovery/mdns.ts` — mDNS local network discovery
  - `transport.ts` — Custom boardgame.io multiplayer transport
  - `index.ts` — Unified P2P API exposing all discovery methods
- `packages/frontend/src/assets/` — IPFS loader and IndexedDB cache utilities.
- `packages/frontend/src/App.tsx` — lobby, routing, and mounting the game client. [DONE]
- `packages/backend/src/index.ts` — signaling endpoint (OPTIONAL, implement last if needed).
- `package.json` scripts (root and workspaces): ensure `dev:frontend`, `dev:backend`, `build`, `test` map to workspace scripts. [DONE]

Testing & acceptance criteria
-----------------------------
Acceptance criteria (minimal)
- Two browser tabs on same machine can connect via join codes and complete a game.
- Two users on different machines/networks can connect via join codes and complete a game (remote testing).
- Game logic unit tests (Vitest) cover core moves and at least one edge case (e.g., drawing from an empty deck).
- IPFS assets referenced by CIDs load in the frontend and are retrievable from cache after first load.

Testing plan
- Unit tests: Vitest for game logic (fast, CI-friendly).
- P2P unit tests: Mock WebRTC to test codec and connection logic.
- Integration test (local): Two browser tabs connect via join codes, play a game.
- Integration test (remote): Developer and tester on different networks connect via join codes.
- Manual verification: Test all discovery methods (join codes, DHT, mDNS) in appropriate environments.

Quality gates
- `yarn build` must produce type-checked builds for all workspaces.
- Unit tests must pass locally before merging feature branches touching game logic.
- P2P connection must work without any server running (join code method).

Risks & mitigations (implementation-focused)
-----------------------------------------
- P2P connection reliability: Two-way join codes work universally; DHT depends on public infrastructure; mDNS for LAN only. Multiple fallback options ensure connectivity.
- NAT traversal: STUN servers (free, public) handle most cases. Symmetric NAT may require TURN or signaling server fallback.
- Join code UX: Two exchanges required - mitigate with clear UI instructions and copy buttons.
- libp2p DHT latency: DHT lookups can be slow - implement timeouts and show loading states.
- IPFS slow fetches: provide gateway fallback and ensure IndexedDB caching to reduce repeated fetches.
- Flaky integration tests: make the integration test deterministic by using logged events and timeouts; retry a small number of times before failing the test.

Next steps (immediate)
----------------------
1. Implement WebRTC wrapper (`packages/frontend/src/p2p/webrtc.ts`)
   - Create/manage RTCPeerConnection
   - Handle offer/answer creation
   - Manage ICE candidates
   - Data channel for game messages

2. Implement join code codec (`packages/frontend/src/p2p/codec.ts`)
   - Encode SDP + ICE candidates to compressed base64 string
   - Decode back to usable SDP

3. Create P2P lobby UI
   - "Create Game" button → shows offer code with copy button
   - "Join Game" → paste offer code, shows answer code
   - "Enter Answer" → host enters answer code to connect

4. Integrate with boardgame.io
   - Custom multiplayer transport using P2P data channel

5. Test locally with two browser tabs

6. Test remotely with another user

Owner & collaboration
---------------------
- Core implementer for frontend tasks: `@manamesh/frontend` workspace.
- Backend signaling: `@manamesh/backend` workspace (DEFERRED - only if decentralized methods prove insufficient).
