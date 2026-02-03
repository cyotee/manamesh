---
project: ManaMesh
version: 1.0
created: 2026-01-20
last_updated: 2026-01-31
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

#### boardgame.io P2P Transport

Using the experimental [boardgame.io/p2p](https://github.com/boardgameio/p2p) package for WebRTC-based multiplayer without a lobby server. This integrates directly with boardgame.io's transport layer.

### Feature 2: boardgame.io Game Engine

Turn-based multiplayer using boardgame.io for state synchronization. Game-specific rules implemented as pluggable handlers (MTG tutors, One Piece top-deck peeks, etc.).

### Feature 3: IPFS Asset Distribution

Card images and assets loaded from IPFS with IndexedDB caching for offline play. Gateway fallback for reliability.

### Feature 5: Asset Pack Format

Hierarchical, extensible format for bundling and distributing game assets.

#### Asset Pack Types

| Type | Description | Example |
|------|-------------|---------|
| Token Pack | Generic game tokens | Counters, markers, damage tokens |
| Card Back Pack | Card back images | Standard back, alternate backs |
| Card Face Pack | Card face images for a set/expansion | MTG "Foundations" set |
| Bundle Pack | Collection of other packs | "MTG Complete" bundling all sets |

#### Initial Asset Packs

| Pack | Game(s) | Source |
|------|---------|--------|
| Standard Playing Cards | War, Poker | [OpenGameArt cards_0.zip](https://opengameart.org/sites/default/files/cards_0.zip) |

The OpenGameArt playing card set provides the 52-card standard deck images needed for War and Poker game modules.

#### Manifest Structure

```json
{
  "manifest_version": "1.0",
  "pack_id": "mtg-foundations-2024",
  "pack_type": "card_faces",
  "name": "MTG Foundations 2024",
  "game_module": "mtg",
  "version": "1.0.0",
  "ipns_key": "k51qzi5uqu5d...",  // Optional mutable reference

  "asset_schema": {
    "id_format": "scryfall_uuid",  // Game module defines this
    "asset_types": ["card_face", "card_back"]
  },

  "assets": [
    {
      "id": "12345678-abcd-...",
      "type": "card_face",
      "file": "cards/12345678.webp",  // Local file in archive
      "checksum": "sha256:abc123..."
    },
    {
      "id": "87654321-dcba-...",
      "type": "card_face",
      "cid": "bafybeig...",  // External IPFS reference
      "checksum": "sha256:def456..."
    }
  ],

  "includes": [
    {
      "cid": "bafybei...",  // Reference to child pack
      "name": "MTG Token Pack"
    },
    {
      "inline": { /* embedded child manifest */ }
    }
  ],

  "overrides": {
    "card_back": {
      "default": "backs/standard.webp",
      "per_card": {
        "dfc-uuid-123": "backs/transform.webp"
      }
    }
  }
}
```

#### Distribution Formats

| Format | Use Case | Contents |
|--------|----------|----------|
| Bare Manifest | Reference-only packs | Just `.json` manifest with CID references |
| Archive (tar.gz/zip) | Self-contained packs | Manifest + bundled asset files |
| IPFS Directory | Large packs | Manifest + assets as IPFS directory |

#### Game Module Integration

Game modules declare accepted asset types:

```typescript
interface GameModuleAssetRequirements {
  required: AssetType[];   // Must have (e.g., card_faces)
  optional: AssetType[];   // Can use (e.g., tokens, alt_backs)
  id_format: string;       // How cards are identified
}
```

#### Versioning

- **Immutable**: Each pack version is a unique IPFS CID
- **Mutable**: Optional IPNS key for "latest" pointer
- **Checksum**: SHA-256 for each asset ensures integrity

### Feature 4: Cryptographic Fair Play

In-play deck state uses commitments and mental poker techniques. Out-of-play decks are unencrypted for sharing.

### Feature 6: Game Module System

Pluggable module system for supporting different card games with game-specific state, zones, and rendering. Game modules are implemented in TypeScript using boardgame.io's game definition and plugin APIs.

#### Supported Games (Priority Order)

| Game | Priority | Rationale |
|------|----------|-----------|
| War | P0 | Simplest possible rules, minimal state - validates core module system |
| Poker | P0 | Simple rules with shared deck - validates shared zones |
| One Piece | P1 | Anime TCG - simpler than MTG, good mid-complexity validation |
| MTG | P2 | Most complex, proves full capability |
| Lorcana | P2 | Disney TCG, different mechanics |
| Riftbound | P3 | Community game |

#### boardgame.io Integration

Game modules are built on boardgame.io's Game definition API and plugin system:

- **Game Definition**: Each module exports a boardgame.io `Game` object with moves, phases, and victory conditions
- **TypeScript**: Full type safety using boardgame.io's TypeScript support (`Ctx`, `Game<G>`, `Move<G>`)
- **Plugins**: Shared functionality (deck operations, zones) implemented as boardgame.io plugins

```typescript
import { Game, Ctx } from 'boardgame.io';
import { DeckPlugin } from '@manamesh/deck-plugin';

// Example: War game module
export const WarGame: Game<WarState> = {
  name: 'war',

  setup: ({ ctx }): WarState => ({
    players: initializeDecks(ctx.numPlayers),
    played: [],
    winner: null,
  }),

  plugins: [DeckPlugin],

  moves: {
    flipCard: ({ G, ctx, playerID }) => {
      // Move top card from deck to played zone
    },
    resolveRound: ({ G, ctx }) => {
      // Compare cards, winner takes both
    },
  },

  endIf: ({ G }) => {
    if (G.winner) return { winner: G.winner };
  },
};
```

#### Module Loading

- **Built-in modules**: Core games compiled into the app (War, Poker, etc.)
- **Dynamic modules**: Community modules loaded at runtime from IPFS/URLs

```typescript
// Module loading
const module = await loadGameModule('ipfs://bafybei.../mtg-module');
// or
import { PokerModule } from '@manamesh/game-poker';
```

#### Core Module Interface

```typescript
interface GameModule {
  // Identity
  id: string;                    // e.g., 'poker', 'mtg', 'lorcana'
  name: string;                  // Display name
  version: string;               // Semver

  // Card Schema
  cardSchema: CardSchema;        // Core + game-specific fields

  // Zone Definitions
  zones: ZoneDefinition[];       // Library, hand, battlefield, etc.

  // Asset Requirements
  assetRequirements: {
    required: AssetType[];       // e.g., ['card_faces']
    optional: AssetType[];       // e.g., ['tokens', 'alt_backs']
    idFormat: string;            // How cards are identified
  };

  // Game State
  initialState(config: GameConfig): GameState;
  validateMove(state: GameState, move: Move): MoveValidation;

  // Rendering (optional customization)
  zoneLayout?: ZoneLayoutConfig;      // Custom zone positions
  customRenderer?: PhaserSceneClass;  // Full custom rendering
}
```

#### Card Schema (Core + Extensions)

```typescript
// Core schema all games share
interface CoreCard {
  id: string;              // Unique identifier
  name: string;            // Card name
  imageCid?: string;       // IPFS CID for card image
  backImageCid?: string;   // For double-faced cards
}

// Game-specific extensions
interface MTGCard extends CoreCard {
  manaCost?: string;
  types: string[];
  subtypes?: string[];
  power?: number;
  toughness?: number;
  loyalty?: number;
  oracleText?: string;
  set: string;
  collectorNumber: string;
}

interface PokerCard extends CoreCard {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string;  // 'A', '2'-'10', 'J', 'Q', 'K'
}

// War uses same schema as Poker (standard 52-card deck)
type WarCard = PokerCard;

interface LorcanaCard extends CoreCard {
  inkCost: number;
  inkable: boolean;
  strength?: number;
  willpower?: number;
  lore?: number;
  abilities: string[];
}

// One Piece TCG card types
type OnePieceCardType = 'character' | 'leader' | 'event' | 'stage' | 'don';

interface OnePieceCard extends CoreCard {
  cardType: OnePieceCardType;
  cost?: number;             // Play cost (not applicable to DON!!)
  power?: number;            // Base power (Characters, Leaders)
  counter?: number;          // Counter value when used in combat
  color: OnePieceColor[];    // Card color(s) - can be multi-color
  attributes?: string[];     // Character attributes (Slash, Strike, etc.)
  trigger?: string;          // Trigger effect text (Life cards)
  effectText?: string;       // Card effect text
  set: string;               // Set code (OP01, OP02, etc.)
  cardNumber: string;        // Collector number within set
  rarity: 'C' | 'UC' | 'R' | 'SR' | 'SEC' | 'L' | 'SP';
  life?: number;             // Starting life (Leaders only)
}

type OnePieceColor = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

// DON!! cards have minimal schema
interface OnePieceDonCard extends CoreCard {
  cardType: 'don';
  // DON!! cards have no other properties - they're power boosters
}
```

#### Zone System

```typescript
interface ZoneDefinition {
  id: string;              // 'library', 'hand', 'battlefield'
  name: string;            // Display name
  visibility: 'public' | 'private' | 'owner-only' | 'hidden';
  shared: boolean;         // Shared between players (Poker deck)
  maxCards?: number;       // Hand limit, etc.
  ordered: boolean;        // Stack order matters (library)
  features: ZoneFeature[]; // 'search', 'peek', 'shuffle'
}

// Example zones - War (simplest)
const warZones: ZoneDefinition[] = [
  { id: 'deck', shared: false, visibility: 'hidden', ordered: true },
  { id: 'played', shared: false, visibility: 'public', ordered: false },  // Current card
  { id: 'won', shared: false, visibility: 'public', ordered: false },     // Won cards pile
];

// Example zones - Poker
const pokerZones: ZoneDefinition[] = [
  { id: 'deck', shared: true, visibility: 'hidden', ordered: true },
  { id: 'hand', shared: false, visibility: 'owner-only', ordered: false },
  { id: 'community', shared: true, visibility: 'public', ordered: false },
  { id: 'discard', shared: true, visibility: 'public', ordered: false },
];

// Example zones - One Piece TCG
const onePieceZones: ZoneDefinition[] = [
  { id: 'mainDeck', shared: false, visibility: 'hidden', ordered: true, features: ['peek', 'shuffle', 'search'] },
  { id: 'lifeDeck', shared: false, visibility: 'mixed', ordered: true },  // Mixed: cards can be face-up, face-down, or owner-known
  { id: 'donDeck', shared: false, visibility: 'public', ordered: false }, // DON!! supply - unordered, public count
  { id: 'trash', shared: false, visibility: 'public', ordered: true, features: ['search'] },
  { id: 'hand', shared: false, visibility: 'owner-only', ordered: false },
  { id: 'playArea', shared: false, visibility: 'public', ordered: false, features: ['slots'] },  // Flexible slot positioning
  { id: 'donArea', shared: false, visibility: 'public', ordered: false },  // Active DON!! cards
];

const mtgZones: ZoneDefinition[] = [
  { id: 'library', shared: false, visibility: 'hidden', ordered: true, features: ['search', 'shuffle'] },
  { id: 'hand', shared: false, visibility: 'owner-only', ordered: false },
  { id: 'battlefield', shared: false, visibility: 'public', ordered: false },
  { id: 'graveyard', shared: false, visibility: 'public', ordered: true },
  { id: 'exile', shared: false, visibility: 'public', ordered: false },
  { id: 'command', shared: false, visibility: 'public', ordered: false },
];
```

#### One Piece Game Module (Detailed Requirements)

The One Piece module is a **rules-agnostic** game state manager with cooperative decryption. It does not enforce game rules—it manages state and ensures fair deck operations through cryptographic protocols.

##### Design Philosophy

| Principle | Description |
|-----------|-------------|
| Rules-Agnostic | Module manages game state only; rules enforcement is player responsibility |
| Cooperative Decryption | Both players participate in deck operations to prevent cheating |
| Verifiable State | All state transitions produce cryptographic proofs |
| Full Visibility Control | Cards can exist in multiple visibility states with tracked transitions |

##### One Piece Zones

| Zone | Visibility | Ordered | Shared | Features |
|------|------------|---------|--------|----------|
| Main Deck | Hidden (encrypted) | Yes | No | Peek, shuffle, search with cooperative decryption |
| Life Deck | Mixed per-card | Yes | No | Face-up, face-down, owner-known states |
| DON!! Deck | Public | No | No | Counter-like supply, no shuffle needed |
| Trash | Public | Yes | No | Search, move cards to other zones |
| Hand | Owner-only | No | No | Standard hand zone |
| Play Area | Public | No | No | Flexible slots for Leader, Characters, Stage |
| DON!! Area | Public | No | No | Active/attached DON!! cards |

##### Card Visibility State Machine

Cards can exist in the following visibility states:

```typescript
type CardVisibilityState =
  | 'encrypted'      // Unknown to all (in shuffled deck)
  | 'public'         // Visible to all players
  | 'secret'         // Hidden from all (rare - transitional state)
  | 'owner-known'    // Owner can see, opponent cannot
  | 'opponent-known' // Opponent can see, owner cannot (rare)
  | 'all-known';     // Both players know but not publicly revealed

interface CardStateTransition {
  cardId: string;
  fromState: CardVisibilityState;
  toState: CardVisibilityState;
  zone: string;
  position?: number;           // Position in ordered zones
  timestamp: number;
  proof: CryptographicProof;   // Both players sign
}
```

##### Valid State Transitions

| From | To | Trigger | Proof Required |
|------|----|---------|----------------|
| encrypted → owner-known | Deck peek operation | Cooperative decrypt, owner signs |
| encrypted → public | Reveal (draw, flip life) | Cooperative decrypt, both sign |
| owner-known → public | Play card, reveal | Owner signature |
| owner-known → encrypted | Return to deck, shuffle | Re-encrypt, both sign shuffle |
| public → encrypted | Rare (return + shuffle) | Re-encrypt protocol |
| any → trash (public) | Discard/destroy | State change proof |

##### Deck Peek Operation (Main Deck)

The critical operation for One Piece is peeking at the top N cards of the Main Deck, allowing the owner to see them while keeping them hidden from the opponent.

```typescript
interface DeckPeekRequest {
  playerId: string;
  deckZone: 'mainDeck' | 'lifeDeck';
  count: number;              // How many cards to peek
  requestProof: Signature;    // Player signs request
}

interface DeckPeekProtocol {
  // Step 1: Owner requests peek
  request: DeckPeekRequest;

  // Step 2: Opponent acknowledges and provides decryption share
  opponentAck: {
    requestHash: string;
    decryptionShare: DecryptionShare;  // Mental poker partial decrypt
    proof: Signature;
  };

  // Step 3: Owner completes decryption (only owner sees result)
  ownerDecrypt: {
    // Owner combines shares to see cards
    // Cards transition to 'owner-known' state
    cardStates: CardStateTransition[];
  };

  // Step 4: Owner may reorder peeked cards
  reorder?: {
    newPositions: number[];    // New positions for peeked cards
    proof: Signature;          // Owner commits to new order
  };
}
```

##### Play Area Slot System

The Play Area uses flexible slots rather than fixed zones:

```typescript
interface PlayAreaSlot {
  id: string;
  slotType: 'leader' | 'character' | 'stage' | 'custom';
  cardId?: string;          // Card occupying this slot
  attachedDon: number;      // Number of DON!! attached to this slot
  position: { x: number; y: number };  // Rendering position
}

interface OnePiecePlayArea {
  leaderSlot: PlayAreaSlot;                    // Exactly one leader
  characterSlots: PlayAreaSlot[];              // 5 character slots typically
  stageSlot?: PlayAreaSlot;                    // Optional stage card

  // DON!! attachment is per-slot, tracked as count
  attachDon(slotId: string, count: number): void;
  detachDon(slotId: string, count: number): void;
}
```

##### Proof Chain Architecture

All state transitions produce cryptographic proofs forming an auditable chain:

```typescript
interface CryptographicProof {
  transitionId: string;          // Unique ID for this transition
  previousProofHash: string;     // Chain to previous proof

  transitionData: {
    type: 'peek' | 'reveal' | 'move' | 'shuffle' | 'attach_don';
    details: TransitionDetails;
  };

  signatures: {
    player1: Signature;          // First player's signature
    player2: Signature;          // Second player's signature
    timestamp: number;
  };

  // Hash of this proof (used as previousProofHash in next)
  proofHash: string;
}

// The chain can be verified by either player or external arbiter
function verifyProofChain(proofs: CryptographicProof[]): boolean;
```

##### Module Configuration

```typescript
interface OnePieceModuleConfig {
  // Starting game state
  startingLife: number;        // Cards dealt to Life Deck (typically 5)
  startingDon: number;         // DON!! cards in DON!! Deck (typically 10)
  startingHand: number;        // Cards drawn to starting hand (typically 5)

  // Play area configuration
  maxCharacterSlots: number;   // Maximum characters in play (typically 5)
  allowStageCard: boolean;     // Whether stage cards are allowed

  // Crypto configuration
  deckEncryption: 'mental-poker';  // Algorithm for deck encryption
  proofChainEnabled: boolean;      // Whether to generate proof chain
}

const defaultOnePieceConfig: OnePieceModuleConfig = {
  startingLife: 5,
  startingDon: 10,
  startingHand: 5,
  maxCharacterSlots: 5,
  allowStageCard: true,
  deckEncryption: 'mental-poker',
  proofChainEnabled: true,
};
```

#### Game Actions

Standard actions available to all modules:

| Action | Description | Zones |
|--------|-------------|-------|
| `draw` | Move top card(s) from deck to hand | library → hand |
| `play` | Move card from hand to battlefield | hand → battlefield |
| `discard` | Move card to discard/graveyard | any → graveyard |
| `shuffle` | Randomize zone order | library |
| `search` | View and select from zone | library (tutor) |
| `peek` | View top N cards privately | library (scry) |
| `reveal` | Show card to opponent(s) | any |
| `tap/untap` | Toggle card state | battlefield |
| `counter` | Add/remove counters | any card |
| `token` | Create token card | → battlefield |

#### Rendering Options

1. **Default renderer**: Module provides zone definitions, shared Phaser scene renders
2. **Custom layout**: Module provides `ZoneLayoutConfig` for zone positioning
3. **Full custom**: Module exports a Phaser Scene class for complete control

```typescript
interface ZoneLayoutConfig {
  zones: {
    [zoneId: string]: {
      x: number;
      y: number;
      width: number;
      height: number;
      cardArrangement: 'stack' | 'fan' | 'grid';
    };
  };
}

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
| WebTorrent | Large asset pack distribution | Read |
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
├── vendor/           # Forked dependencies (git submodules)
│   ├── boardgame.io/       # cyotee/boardgame.io
│   └── boardgameIO-p2p/    # cyotee/boardgameIO-p2p
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
| boardgame.io | fork | Turn-based game framework (submodule) |
| @boardgame.io/p2p | fork | P2P transport (submodule) |
| phaser | ^3.80.1 | 2D rendering engine |
| helia | ^4.0.1 | Browser IPFS node |
| libp2p | ^3.0.3 | P2P networking |
| elliptic | ^6.5.5 | Cryptographic operations |

### Forked Dependencies

Critical dependencies are maintained as forks installed via git submodules. This allows:
- Immediate bug fixes without waiting for upstream PR acceptance
- Custom modifications for ManaMesh-specific needs
- Version pinning independent of upstream releases
- Local development with linked node modules

| Upstream | Fork | Purpose |
|----------|------|---------|
| [boardgameio/boardgame.io](https://github.com/boardgameio/boardgame.io) | [cyotee/boardgame.io](https://github.com/cyotee/boardgame.io) | Core game framework |
| [boardgameio/p2p](https://github.com/boardgameio/p2p) | [cyotee/boardgameIO-p2p](https://github.com/cyotee/boardgameIO-p2p) | P2P transport |

**Submodule workflow:**
```bash
# Submodules installed to vendor/
git submodule update --init --recursive

# Link as node modules
yarn link ./vendor/boardgame.io
yarn link ./vendor/boardgameIO-p2p
```

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
| M6 | IPFS Asset Loading + Caching | Done |
| M7 | Stabilize Tests & Acceptance Criteria | Ongoing |
| M8 | Game Module System: Core Interface | Planned |
| M9 | Game Module: War (simplest validation) | Planned |
| M10 | Game Module: Poker (shared deck validation) | Planned |
| M11 | Game Module: One Piece | Planned |
| M12 | Game Module: MTG | Planned |
| M13 | Game Module: Lorcana | Planned |
| M14 | Game Module: Riftbound | Planned |
| M15 | Asset Pack System | Planned |

## Appendix

### Glossary

| Term | Definition |
|------|------------|
| SDP | Session Description Protocol - WebRTC connection metadata |
| DHT | Distributed Hash Table - decentralized peer lookup |
| mDNS | Multicast DNS - local network service discovery |
| CID | Content Identifier - IPFS content-addressed hash |
| IPNS | InterPlanetary Name System - mutable pointers to IPFS content |
| Mental Poker | Cryptographic protocol for fair card games without trusted third party |
| Asset Pack | Bundled collection of game assets (images, etc.) with manifest |
| Game Module | Plugin defining rules, zones, and asset requirements for a specific card game |
| Zone | Logical location for cards (library, hand, battlefield, etc.) |
| Tutor | Search through a zone (typically library) to find specific cards |
| Scry | Peek at top N cards of library and optionally reorder |
| boardgame.io Game | Game definition object with setup, moves, phases, and victory conditions |
| boardgame.io Plugin | Reusable module that extends game functionality (e.g., deck operations) |
| DON!! | One Piece TCG resource cards used to boost character power |
| Life Deck | One Piece zone containing face-down cards that act as life points |
| Cooperative Decryption | Protocol where both players provide decryption shares to reveal cards fairly |
| Proof Chain | Sequence of cryptographically signed state transitions for auditability |
| Card Visibility State | Current visibility of a card (encrypted, public, owner-known, etc.) |
| Play Area Slot | Flexible position in play area for Leader, Character, or Stage cards |

### References

#### boardgame.io
- [boardgame.io Documentation](https://boardgame.io/documentation/)
- [TypeScript Support](https://boardgame.io/documentation/#/typescript) - Type definitions for Game, Ctx, moves
- [Game Definition API](https://boardgame.io/documentation/#/api/Game) - Setup, moves, phases, endIf
- [Plugin System](https://boardgame.io/documentation/#/plugins) - Extending game functionality
- [boardgame.io/p2p](https://github.com/boardgameio/p2p) - Experimental P2P transport (upstream)

#### ManaMesh Forks (Submodules)
- [cyotee/boardgame.io](https://github.com/cyotee/boardgame.io) - Our fork of boardgame.io core
- [cyotee/boardgameIO-p2p](https://github.com/cyotee/boardgameIO-p2p) - Our fork of P2P transport

#### P2P & Storage
- [libp2p Documentation](https://docs.libp2p.io/)
- [IPFS/Helia Documentation](https://helia.io/)

#### Assets
- [OpenGameArt Playing Cards](https://opengameart.org/sites/default/files/cards_0.zip) - Standard 52-card deck images for War/Poker

#### One Piece TCG
- [Official One Piece TCG Rules](https://en.onepiece-cardgame.com/rule/) - Game rules reference
- [One Piece TCG Card Database](https://onepiece-cardgame.dev/) - Community card database

#### Project Documents
- CardGameTechStackDesign.markdown (detailed architecture)
- PRD_Implementation.md (implementation tasks)
