# ManaMesh Architecture & Implementation Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [Monorepo Structure](#monorepo-structure)
3. [Frontend Architecture](#frontend-architecture)
4. [Game Module System](#game-module-system)
5. [Cryptographic Primitives](#cryptographic-primitives)
6. [P2P Networking Layer](#p2p-networking-layer)
7. [Asset Loading System](#asset-loading-system)
8. [Blockchain Integration](#blockchain-integration)
9. [Smart Contracts](#smart-contracts)

---

## Project Overview

ManaMesh is a decentralized, browser-based multiplayer platform for competitive card and board games (Magic: The Gathering, One Piece Card Game, Lorcana, etc.). It prioritizes P2P networking so gameplay works without any server. Each game module demonstrates a different cryptographic paradigm for provably fair play between untrusted peers.

**Core principles:**

- **P2P-first** — Gameplay works without any server; backend is optional
- **Modularity** — Game-specific rules as pluggable handlers
- **Decentralization** — IPFS for assets, libp2p for networking
- **Security & Fairness** — Cryptographic commitments prevent cheating
- **Open Source** — Permissive license for community hosting

---

## Monorepo Structure

```
manamesh/
├── packages/
│   ├── frontend/                    # React app (main application)
│   │   └── src/
│   │       ├── App.tsx             # Main app + routing
│   │       ├── game/               # Game modules & registry
│   │       │   ├── modules/        # war, poker, gofish, etc.
│   │       │   ├── registry.ts    # GameInfo map
│   │       │   └── game.ts         # Simple card game
│   │       ├── components/          # React UI components
│   │       ├── crypto/              # Cryptographic primitives
│   │       ├── p2p/                 # P2P networking layer
│   │       ├── phaser/              # Phaser 3 rendering
│   │       ├── assets/              # IPFS loader, caches, manifests
│   │       ├── blockchain/          # On-chain settlement integration
│   │       ├── wallet/              # Ethereum wallet integration
│   │       ├── deck/                # Deck utilities
│   │       └── hooks/               # React hooks
│   └── backend/                     # Optional Node.js server
│       └── src/
│           ├── index.ts             # Express + HTTP
│           └── signaling.ts         # WebSocket signaling
├── contracts/                       # Solidity smart contracts
│   └── src/
│       ├── GameVault.sol           # Escrow + settlement
│       ├── ChipToken.sol           # ERC20 chip token
│       ├── ChipTokenFactory.sol    # Token factory
│       ├── Counter.sol             # Nonce counter
│       ├── interfaces/             # Contract interfaces
│       └── libraries/              # SignatureVerifier
├── vendor/                          # Git submodules (forked deps)
│   ├── boardgame.io/               # boardgame.io fork
│   └── boardgameIO-p2p/            # P2P transport fork
└── tasks/                          # Project management
```

### Workspace Configuration

The project uses Yarn v4 workspaces for monorepo management:

```json
{
  "packageManager": "yarn@4.6.0",
  "workspaces": ["packages/*", "vendor/*"]
}
```

### Key Commands

```bash
# Development
yarn dev:frontend    # Vite dev server for frontend
yarn dev:backend     # nodemon + ts-node for backend

# Build & Test
yarn build           # Build all workspaces
yarn test            # Run Vitest tests (frontend)

# Single workspace test
yarn workspace @manamesh/frontend test src/game/modules/war/game.test.ts
```

---

## Frontend Architecture

### Tech Stack

| Layer       | Technology                   |
| ----------- | ---------------------------- |
| Framework   | React 18 + TypeScript        |
| Build Tool  | Vite                         |
| Game Engine | boardgame.io (turn-based)    |
| Rendering   | Phaser 3 (2D card visuals)   |
| State       | React Context + boardgame.io |
| Styling     | CSS-in-JS (inline styles)    |

### App Entry Point (`App.tsx`)

The main `App.tsx` orchestrates the application's flow:

```
AppContent
├── GameSelector          # Select game type
├── ModeSelect            # Choose local/P2P mode
├── LocalGame             # Hotseat multiplayer
├── P2PLobby              # P2P connection UI
└── P2PGame               # P2P gameplay
```

**Key patterns:**

- `Client` from `boardgame.io/react` wraps each game
- `Local` multiplayer for hotseat play
- `P2PMultiplayer` transport for network play
- `WalletProvider` wraps the entire app for blockchain integration
- `AppErrorBoundary` catches render errors with stack trace display

### State Management

1. **boardgame.io Game State** — Turn-based game logic (authoritative)
2. **React useState/useReducer** — UI state (modals, selections)
3. **IndexedDB** — Persistent deck/asset storage
4. **localStorage** — P2P transport preferences

### Component Architecture

| Component                                 | Purpose                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `GameSelector`                            | Browse and select game modules                 |
| `P2PLobby`                                | Create/join P2P games with transport selection |
| `WarBoard` / `PokerBoard` / `GoFishBoard` | Game-specific boards                           |
| `MerkleBattleshipBoard`                   | Battleship with Merkle commitments             |
| `ThresholdTallyBoard`                     | Threshold crypto demo                          |
| `DeckBuilderPage`                         | Deck construction UI                           |
| `AssetPackManagement`                     | Asset pack CRUD                                |
| `TransportSettings`                       | P2P transport configuration                    |

---

## Game Module System

### Module Interface (`src/game/modules/types.ts`)

Every game module implements the `GameModule` interface:

```typescript
interface GameModule<TCard extends CoreCard, TState extends BaseGameState> {
  id: string; // Unique identifier
  name: string; // Display name
  version: string; // Semantic version
  cardSchema: CardSchema<TCard>; // Card validation/creation
  zones: ZoneDefinition[]; // Play area definitions
  assetRequirements: GameModuleAssetRequirements;
  initialState: (config: GameConfig) => TState;
  validateMove: (state, move, playerID, ...args) => MoveValidation;
  getBoardgameIOGame: () => Game<TState>;
  zoneLayout?: ZoneLayoutConfig; // Rendering hints
}
```

### Zone System

Zones define where cards can exist and their properties:

```typescript
interface ZoneDefinition {
  id: string; // 'library', 'hand', 'battlefield'
  name: string; // Display name
  visibility: Visibility; // 'public' | 'private' | 'owner-only' | 'hidden'
  shared: boolean; // Shared between players?
  maxCards?: number; // Capacity limit
  ordered: boolean; // Order matters?
  features: ZoneFeature[]; // 'search' | 'peek' | 'shuffle' | 'draw' | 'play' | 'tap'
}
```

### Registry (`src/game/registry.ts`)

Central registry mapping game IDs to `GameInfo`:

```typescript
export interface GameInfo<T = unknown> {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  getGame: () => Game<T>;
  getCryptoGame?: () => Game<T>; // Crypto-enabled variant
  BoardComponent?: ComponentType<BoardProps<T>>;
}
```

### Available Games

| ID                  | Name              | Players | Crypto                   |
| ------------------- | ----------------- | ------- | ------------------------ |
| `simple`            | Simple Card Game  | 2       | None                     |
| `war`               | War               | 2       | SRA Mental Poker         |
| `poker`             | Texas Hold'em     | 2-6     | SRA Mental Poker         |
| `gofish`            | Go Fish (Demo)    | 2-4     | Basic Mental Poker       |
| `gofish-secure`     | Go Fish (Coop)    | 2-4     | Cooperative Decryption   |
| `gofish-zk`         | Go Fish (ZK)      | 2-4     | ZK Proof Scaffolding     |
| `merkle-battleship` | Merkle Battleship | 2       | Merkle Tree              |
| `threshold-tally`   | Threshold Tally   | 2-3     | Feldman DKG + EC ElGamal |
| `onepiece`          | One Piece TCG     | 2       | Cooperative Decryption   |

---

## Cryptographic Primitives

All crypto primitives are in `src/crypto/` and re-exported from `src/crypto/index.ts`.

### Mental Poker (SRA Commutative Encryption)

**Purpose:** Card games requiring hidden shuffled decks (War, Poker, Go Fish).

**Files:**

- `mental-poker/sra.ts` — SRA encryption/decryption
- `mental-poker/shuffle-proof.ts` — Commit-reveal shuffle proof
- `mental-poker/commitment.ts` — Seed commitment
- `mental-poker/types.ts` — Type definitions

**How it works:**

1. Each player generates an EC key pair
2. Key shares distributed via Shamir SSS (key escrow)
3. Deck encrypted sequentially — each player adds one encryption layer
4. Deck shuffled with commit-reveal proof
5. Cards revealed via cooperative decryption (all players contribute)
6. Abandonment recovery: reconstruct key from Shamir shares when threshold met

**Key types:**

```typescript
interface SRAKeyPair {
  publicKey: string; // Base64 encoded
  privateKey: string; // Base64 encoded
}

interface EncryptedCard {
  ciphertext: string; // Base64 encoded
  playerId: string; // Who encrypted
}

interface ShuffleProof {
  commit: string; // SHA256(seed)
  reveal: string; // seed (after commit)
  permutation: number[]; // Card order after shuffle
}
```

### Shamir's Secret Sharing

**Files:**

- `shamirs/split.ts` — Split secret into shares
- `shamirs/reconstruct.ts` — Reconstruct from shares
- `shamirs/types.ts` — Share structure

**Configuration:**

- Threshold: 2-of-N players (configurable)
- Prime field: secp256k1 curve order

### Merkle Tree Commitments

**Purpose:** Board games requiring binding placement (Merkle Battleship).

**File:** `crypto/merkle.ts`

**How it works:**

1. Player commits to 10x10 board by publishing Merkle root
2. Each cell: `SHA256(gameId|playerId|cellIndex|bit|salt)`
3. On guess: reveal cell value + Merkle proof
4. `applyReveal` verifies proof against committed root

### Threshold Homomorphic Encryption

**Purpose:** Aggregation where individual inputs stay private but aggregate is decryptable.

**Files:**

- `ec-elgamal-exp.ts` — EC ElGamal with message-in-exponent encoding
- `feldman-dkg.ts` — Feldman DKG for distributed key generation
- `dleq.ts` — DLEQ proofs for verifiable partial decryption

**Flow:**

1. Players run Feldman DKG to create shared public key
2. Each encrypts input with shared public key (EC ElGamal)
3. Ciphertexts auto-aggregate via homomorphic addition
4. Any 2 of 3 players combine partial decryptions to reveal total
5. DLEQ proofs verify partial decryptions are valid

### Supporting Primitives

| Primitive   | File             | Purpose                                            |
| ----------- | ---------------- | -------------------------------------------------- |
| SHA-256     | `sha256.ts`      | Hashing for commitments                            |
| secp256k1   | `secp256k1.ts`   | Elliptic curve operations                          |
| ECDSA       | `ecdsa.ts`       | ZK verdict signing                                 |
| Paillier HE | `paillier.ts`    | Additive homomorphic encryption (demo)             |
| Stable JSON | `stable-json.ts` | Deterministic serialization for ZK payload hashing |

### Crypto Plugin (`crypto/plugin/`)

boardgame.io plugin that manages crypto state:

```typescript
interface CryptoPluginState {
  keyPairs: Record<string, SRAKeyPair>; // Player key pairs
  escrowShares: Record<string, string[]>; // Shamir shares per player
  encryptedDeck: EncryptedCard[]; // Deck ciphertexts
  shuffledDeck: EncryptedCard[]; // After shuffle
  pendingDecrypts: PendingDecrypt[]; // Cooperative decrypt requests
}
```

---

## P2P Networking Layer

### Architecture Overview

```
App.tsx
  └── startP2P()                    # Initialize libp2p node
  └── GameSelector → ModeSelect
        └── P2PLobby               # Create/join room
              └── TransportManager  # Try: LAN → Direct IP → Relay → JoinCode
                    ├── DHTConnection      # libp2p DHT discovery
                    ├── LANConnection      # mDNS local discovery
                    ├── RelayConnection    # Circuit relay
                    └── JoinCodeConnection # Manual SDP copy/paste
              └── onConnected(connection, role)
                    └── P2PGame
                          └── Client(game, transport: P2PMultiplayer)
                                └── WebRTC data channel
```

### Core Exports (`src/p2p/index.ts`)

```typescript
// WebRTC
export { PeerConnection, type ConnectionState, type ConnectionOffer };

// Codec
export { encodeOffer, decodeOffer, isValidJoinCode };

// Transport
export { P2PTransport, P2PMultiplayer, type P2PRole };

// Discovery
export { JoinCodeConnection }; // Manual SDP exchange
export { LANConnection, MDNSDiscovery }; // LAN via mDNS
export { DHTConnection }; // Global via DHT
export { SignalingConnection }; // Server-assisted (fallback)

// libp2p
export { createNode, getNode, stopNode };
```

### Transport Manager (`transport-manager.ts`)

Orchestrates multiple transport strategies:

```
1. LAN (mDNS)        — Zero-config local network
2. Direct IP          — Manual IP:port exchange
3. Circuit Relay      — libp2p relay v2 (decentralized)
4. Join Code          — Copy/paste SDP (legacy fallback)
```

Priority order: first successful connection wins. Users can configure via URL parameters:

```
/?transport=relay       # Force specific transport
/?transport=lan,relay   # Enable subset
/?verbose=true          # Debug logging
```

### boardgame.io Integration

`P2PMultiplayer` bridges WebRTC to boardgame.io:

```typescript
interface P2PTransportOpts {
  connection: JoinCodeConnection | LANConnection | DHTConnection;
  role: "host" | "guest";
  playerID: string;
  matchID: string;
  numPlayers: number;
}
```

### Connection Types

| Type      | Discovery | NAT Traversal           | Use Case          |
| --------- | --------- | ----------------------- | ----------------- |
| LAN       | mDNS      | None                    | Same network      |
| Direct IP | Manual    | Manual                  | VPN, port-forward |
| Relay     | DHT       | libp2p circuit relay v2 | NAT'd networks    |
| Join Code | None      | STUN                    | Legacy fallback   |

---

## Asset Loading System

### Loading Architecture

```
Asset Request
      ↓
IndexedDB Cache (pack-level 'manamesh-card-images')
      ↓ miss
fetcher.fetchBlob(source, path)
      ↓
Helia (browser IPFS node)
      ↓ fail/timeout
HTTP Gateways (ipfs.io, dweb.link, cloudflare-ipfs.com)
      ↓
Cache Result → IndexedDB
```

### Key Files

| File                          | Purpose                                   |
| ----------------------------- | ----------------------------------------- |
| `assets/ipfs-loader.ts`       | Core loader with Helia + gateway fallback |
| `assets/config.ts`            | Gateway URLs, timeouts                    |
| `assets/cache.ts`             | IndexedDB caching layer                   |
| `assets/loader/loader.ts`     | Asset pack manifest parsing               |
| `assets/loader/zip-loader.ts` | ZIP pack extraction                       |
| `assets/manifest/parser.ts`   | Manifest schema validation                |

### Asset Pack Structure

```
assets/packs/standard-playing-cards/
├── manifest.json      # Pack metadata, card list, CIDs
├── cards/             # Card images (PNG)
└── README.md
```

### Manifest Schema

```typescript
interface AssetManifest {
  id: string;
  name: string;
  version: string;
  assets: {
    id: string;
    type: "card_face" | "card_back" | "token" | "playmat";
    path: string;
    cid: string; // IPFS CID
  }[];
}
```

### Configuration

```typescript
{
  gateways: [
    'https://ipfs.io/ipfs/',
    'https://dweb.link/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
  ],
  heliaInitTimeout: 5000,
  heliaFetchTimeout: 10000,
  gatewayTimeout: 15000,
  preferGateway: false,
}
```

---

## Blockchain Integration

### Architecture

```
Frontend                    Blockchain
   │                            │
   ├── WalletProvider           │
   │   └── useWallet() hook     │
   │                            │
   ├── BlockchainService        │
   │   └── settlePot()          ├── GameVault.sol
   │   └── getBalances()        └── ChipToken.sol
   │                            │
   └── EIP-712 Signing          │
       └── signHandResult()     │
```

### Key Files

| File                            | Purpose                       |
| ------------------------------- | ----------------------------- |
| `blockchain/types.ts`           | Service interface definitions |
| `blockchain/mock-service.ts`    | Mock implementation for dev   |
| `blockchain/wallet/context.tsx` | React context for wallet      |
| `wallet/signing/sign.ts`        | EIP-712 signature generation  |
| `wallet/signing/verify.ts`      | Signature verification        |

### BlockchainService Interface

```typescript
interface BlockchainService {
  settlePot(handResult: PokerHandResult): Promise<SettlementResult>;
  getBalances(playerIDs: string[]): Promise<Record<string, number>>;
  generateHandId(): string;
}
```

### EIP-712 Hand Result Signing

Players sign hand results off-chain before on-chain settlement:

```typescript
interface PokerHandResult {
  handId: string;
  players: {
    address: string;
    holeCards: [string, string]; // e.g., ['hearts-A', 'spades-K']
    actions: string[]; // 'fold', 'call', 'raise'
  }[];
  communityCards: string[];
  pot: number;
  winner: string;
  signature: string;
}
```

---

## Smart Contracts

### Contract Overview

| Contract                | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `GameVault.sol`         | Escrow deposits, settle hands, handle disputes |
| `ChipToken.sol`         | ERC20 token for game chips                     |
| `ChipTokenFactory.sol`  | Create new chip token instances                |
| `SignatureVerifier.sol` | EIP-712 signature verification library         |

### GameVault.sol

**Key functions:**

```solidity
// Player joins a game, depositing chips
function joinGame(bytes32 gameId, uint256 buyIn) external;

// Host settles final hand result
function settleHands(
    PokerHandResult calldata result,
    bytes[] calldata signatures
) external;

// Dispute a hand (replay verification)
function disputeHand(bytes32 gameId, PokerHandResult calldata result) external;

// Claim chips if opponent abandons
function claimAbandonment(bytes32 gameId) external;
```

### ChipToken.sol

Standard ERC20 with:

- `mint()` — Create new chips
- `burn()` — Destroy chips
- `permit()` — EIP-712 approval

### SignatureVerifier.sol

Library for verifying EIP-712 signatures:

```solidity
function verifyPokerHandResult(
    PokerHandResult memory result,
    bytes memory signature,
    address signer
) internal view returns (bool);
```

---

## Game Module Implementations

### War (`war/`)

**Phases:** `flip` → `resolve` → `gameOver`

**Crypto phases:** `keyExchange` → `keyEscrow` → `encrypt` → `shuffle` → `flip` → `reveal` → `resolve` → `gameOver`

**Moves:** `submitPublicKey`, `distributeKeyShares`, `encryptDeck`, `shuffleDeck`, `flipCard`, `approveDecrypt`, `releaseKey`, `surrender`

### Poker (`poker/`)

**Phases:** `preflop` → `flop` → `turn` → `river` → `showdown`

**Crypto phases:** `keyExchange` → `keyEscrow` → `encrypt` → `shuffle` → `preflop` → `flop` → `turn` → `river` → `showdown`

**Files:**

- `game.ts` — boardgame.io game definition
- `crypto.ts` — Mental poker integration
- `hands.ts` — Hand evaluation (`evaluateHand`, `compareHands`, `findBestHand`)
- `betting.ts` — Betting logic (`initBettingRound`, `processFold/Check/Call/Bet/Raise/AllIn`)
- `types.ts` — `PokerCard`, `PokerState`, `PokerHandResult`

### Go Fish (`gofish/`)

Three security variants sharing one engine:

| Variant         | securityMode   | Key Feature                                   |
| --------------- | -------------- | --------------------------------------------- |
| `gofish`        | `demo-private` | Keys in shared state (insecure demo)          |
| `gofish-secure` | `coop-reveal`  | Cooperative decryption, no keys in state      |
| `gofish-zk`     | `zk-attest`    | ZK proof scaffolding with verifier signatures |

**Shuffle:** Multi-party commit-reveal seed sub-protocol:

1. Commit: `SHA256(seedHex)` via `commitShuffleSeed`
2. Reveal: `seedHex` via `revealShuffleSeed`
3. Final: XOR all seeds → `finalSeedHex` → Fisher-Yates

### Merkle Battleship (`merkle-battleship/`)

**Phases:** `placement` → `battle` → `gameOver`

**Commitment:** Each cell = `SHA256(utf8("${gameId}|${playerId}|${cellIndex}|${bit}|") || salt)`

**Fleet:** Carrier(5), Battleship(4), Cruiser(3), Submarine(3), Destroyer(2) = 17 ship cells

### Threshold Tally Arena (`threshold-tally/`)

**Phases:** `setup` (DKG) → `commit` → `decrypt` → `resolve`

**DKG Flow:**

1. `publishDkgCommitment` — Feldman commitments
2. `confirmDkgShare` — Confirm receipt
3. `publishPublicShare` — Publish public key shares
4. `finalizeDkg` — Derive combined public key

**Threshold:** t=2 (any 2 of 3 players can decrypt aggregate)

### One Piece TCG (`onepiece/`)

Rules-agnostic state manager with cooperative decryption:

- `zones.ts` — Zone definitions per game rules
- `visibility.ts` — Per-zone visibility rules
- `peek.ts` — Cooperative decryption for hole cards
- `proofChain.ts` — Action provenance tracking

---

## Development Notes

### Vendor Submodules

| Package           | Path                     | Purpose                              |
| ----------------- | ------------------------ | ------------------------------------ |
| boardgame.io      | `vendor/boardgame.io`    | Core game framework (forked for P2P) |
| @boardgame.io/p2p | `vendor/boardgameIO-p2p` | P2P transport layer                  |

### Known Limitations

- **HE Battleship is demo-only** — Not registered in game registry
- **Go Fish ZK is scaffolding** — Actual ZK circuits not generated
- **Paillier/Feldman DKG** — Demo-quality (reduced key sizes)
- **Shuffle proof** — Commit-reveal, not true ZK
- **SRA hash-to-curve** — try-and-increment, not proper `hash_to_curve`
- **Backend MongoDB** — Not yet implemented (signaling only)

### Testing

```bash
# Run all frontend tests
yarn test

# Run specific module tests
yarn workspace @manamesh/frontend test src/game/modules/war/game.test.ts

# Run crypto tests
yarn workspace @manamesh/frontend test src/crypto/
```

### Build

```bash
# Build frontend
yarn build

# Type check (pre-existing third-party errors expected)
yarn workspace @manamesh/frontend tsc --noEmit
```

---

## See Also

- [ManaMesh Architecture Skill](../.opencode/skills/manamesh-architecture/SKILL.md)
- [ManaMesh Game Modules Skill](../.opencode/skills/manamesh-game-modules/SKILL.md)
- [ManaMesh Crypto Skill](../.opencode/skills/manamesh-crypto/SKILL.md)
- [ManaMesh P2P Skill](../.opencode/skills/manamesh-p2p/SKILL.md)
- [ManaMesh Assets Skill](../.opencode/skills/manamesh-assets/SKILL.md)
- [ManaMesh Contracts Skill](../.opencode/skills/manamesh-contracts/SKILL.md)
- [Project README](../README.md)
- [AGENTS.md](../AGENTS.md) — Agent-oriented context
