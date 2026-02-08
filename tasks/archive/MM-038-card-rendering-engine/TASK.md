# Task MM-038: Card Rendering Engine (Phaser 3)

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-02-07
**Dependencies:** MM-023, MM-037
**Worktree:** `feature/card-rendering-engine`

---

## Description

Build a Phaser 3-based card rendering engine that serves as a pure visual layer beneath a React wrapper. The engine renders card images, zone layouts, play area slots, and card state indicators (tap, counters, DON!! attachments, visibility overlays) for the One Piece TCG module. React manages all game state via boardgame.io; the Phaser scene receives state snapshots and draws them. Player interactions (drag-and-drop, click) are detected by Phaser and forwarded to React via an event bridge, which dispatches boardgame.io moves.

This task focuses on **layout and static rendering** — no animations. A follow-up task will add tweened card movements, flip effects, and deal sequences.

## Dependencies

- **MM-023** (Complete) - One Piece TCG Game Module. Provides zone definitions, play area slot system, card types, and visibility state machine.
- **MM-037** (Complete) - One Piece Card Scraper & Asset Pack Builder. Provides card images and ManaMesh-compatible manifests for rendering actual card faces.

## Design Decisions

### Architecture: React Wrapper + Phaser as Pure Visual Layer

React owns state (boardgame.io `G`), the Phaser scene is a dumb renderer:

```
boardgame.io state (G)
    ↓ React props
PhaserBoard (React component)
    ↓ SceneState interface
CardGameScene (Phaser.Scene)
    ↓ renders
Sprites, zones, indicators
    ↑ input events
EventBridge → React handler → boardgame.io move → G updates → re-render
```

**Why:** Matches ManaMesh's existing pattern where boardgame.io owns state and board components are pure views. Existing React hooks (`useCardImage`, asset cache) continue to work and feed data into Phaser. Animations can be added later without touching the state layer.

### Rendering: Phaser 3 (WebGL with Canvas fallback)

Phaser 3.80.1 is already in `package.json` but unused. Provides GPU-accelerated sprite batching, built-in input system, and tween engine for future animation work.

### Interaction: Drag-and-Drop + Click

Phaser handles hit testing and drag detection. Drag events emit through the EventBridge to React, which calls the appropriate boardgame.io move. Click events trigger context-sensitive actions (play card, tap/untap, peek).

### Responsive: Scale from the start

Phaser scene uses `Phaser.Scale.FIT` with a reference resolution (1280x720). Zone positions defined in normalized coordinates (0-1) and mapped to scene size. Re-layout on resize events.

## User Stories

### US-MM-038.1: Phaser Scene Bootstrap & React Integration

As a developer, I want a React component that wraps a Phaser game instance so that the scene renders inside the React component tree and receives state updates.

**Acceptance Criteria:**
- [ ] `PhaserBoard` React component creates and manages a Phaser.Game lifecycle (mount/unmount)
- [ ] Phaser canvas renders inside a React ref div
- [ ] `SceneState` interface defined — the contract between React and Phaser
- [ ] React converts boardgame.io `BoardProps<OnePieceGameState>` into `SceneState` and passes it to the scene
- [ ] Scene re-renders when `SceneState` changes (via scene registry or custom event)
- [ ] `EventBridge` interface defined — Phaser emits interaction events, React listens
- [ ] EventBridge callbacks map to boardgame.io moves
- [ ] Phaser game destroyed cleanly on React component unmount (no leaks)
- [ ] Canvas uses `Phaser.Scale.FIT` with 1280x720 reference resolution
- [ ] Scene scales correctly on window resize

### US-MM-038.2: Card Sprite Rendering

As a player, I want to see card images rendered as Phaser sprites so that I can visually identify my cards.

**Acceptance Criteria:**
- [ ] `CardSprite` class (extends Phaser.GameObjects.Container) renders a card
- [ ] Loads card face image from asset pack manifest (uses URL from `useCardImage` hook, passed via SceneState)
- [ ] Renders card back when card is face-down (encrypted/secret visibility state)
- [ ] Placeholder sprite when image is loading or unavailable
- [ ] Card dimensions configurable per zone (smaller in hand, larger in play area)
- [ ] Card sprites have hit areas for click and drag input
- [ ] Cards display card name text below/on the sprite when hovered or selected

### US-MM-038.3: Zone Layout System

As a player, I want to see distinct zones on the board so that I know where my deck, hand, play area, and trash are.

**Acceptance Criteria:**
- [ ] `ZoneRenderer` class renders a zone as a visual region with label
- [ ] Zone positions defined in normalized coordinates (0-1 range) via `ZoneLayoutConfig`
- [ ] All 7 One Piece zones rendered for each player:
  - Main Deck (stacked, face-down, card count badge)
  - Life Deck (stacked, mixed visibility, card count badge)
  - DON!! Deck (stacked, public, remaining count)
  - Trash (stacked, top card face-up)
  - Hand (fan layout, owner sees faces, opponent sees backs)
  - Play Area (grid of slots — see US-038.4)
  - DON!! Area (horizontal row of active DON!!)
- [ ] Two-player layout: Player 1 zones on bottom half, Player 2 on top half (mirrored)
- [ ] Opponent zones show face-down cards where visibility requires it
- [ ] Zone backgrounds have subtle tinting/borders to distinguish regions
- [ ] Zone labels display zone name and card count

### US-MM-038.4: Play Area Slot Rendering

As a player, I want to see my play area with distinct slots for Leader, Characters, and Stage so that I can manage my board presence.

**Acceptance Criteria:**
- [ ] Play area renders slot grid matching `PlayAreaSlot[]` from One Piece module
- [ ] Leader slot rendered in center-left position (slightly larger)
- [ ] Character slots (5) rendered in a horizontal row
- [ ] Stage slot rendered separately (optional, below/beside leader)
- [ ] Empty slots show a dashed outline placeholder
- [ ] Occupied slots render the card sprite
- [ ] DON!! attachments rendered as small overlapping sprites on the slot (stacked offset)
- [ ] DON!! count badge on each slot showing number of attached DON!!
- [ ] Slots are valid drag-drop targets

### US-MM-038.5: Card State Indicators

As a player, I want visual indicators on cards so that I can see their game state at a glance.

**Acceptance Criteria:**
- [ ] **Tapped state:** Card sprite rotated 90 degrees clockwise
- [ ] **Counter value:** Badge overlay showing counter amount (e.g., "+1000")
- [ ] **DON!! attachment:** Small DON!! icon with count overlaid on card
- [ ] **Visibility borders:**
  - `encrypted`: Dark overlay with lock icon
  - `owner-known`: Blue tinted border (only owner sees face)
  - `opponent-known`: Red tinted border
  - `all-known`: Yellow border (both know, not public)
  - `public`: No special border
  - `secret`: Full dark overlay
- [ ] **Power display:** Power value badge on character/leader cards in play area
- [ ] Indicators scale proportionally with card size
- [ ] Multiple indicators can stack without obscuring the card image

### US-MM-038.6: Drag-and-Drop Interaction

As a player, I want to drag cards between zones so that I can play cards, attach DON!!, and manage my board.

**Acceptance Criteria:**
- [ ] Cards in hand are draggable
- [ ] Dragging a card raises it above other sprites (z-index)
- [ ] Valid drop targets highlight when a card is being dragged over them
- [ ] Invalid drop targets show a "not allowed" indicator
- [ ] Dropping on a valid target emits an event through EventBridge with `{ cardId, sourceZone, targetZone, targetSlot? }`
- [ ] Dropping on an invalid target or empty space returns the card to its original position
- [ ] DON!! cards in DON!! Area are draggable onto play area slots (attach DON!!)
- [ ] Click on a card in play area toggles tap/untap (emits event)
- [ ] Click on Main Deck emits draw event
- [ ] Click on a card shows a larger preview (tooltip-style, not a modal)
- [ ] All interactions are disabled for the opponent's zones (view-only)

### US-MM-038.7: Asset Loading Integration

As a developer, I want the Phaser scene to load card images from the existing ManaMesh asset pipeline so that I don't duplicate the IPFS/cache infrastructure.

**Acceptance Criteria:**
- [ ] React side resolves card image URLs via existing `useCardImage` hook
- [ ] Image URLs passed to Phaser scene via `SceneState.cardImages` map (`cardId → url`)
- [ ] Phaser scene loads textures from URLs using `this.textures.addBase64` or `this.load.image`
- [ ] Texture cache managed to avoid reloading already-loaded images
- [ ] When a card image URL updates (e.g., IPFS load completes), sprite updates in-place
- [ ] Card back image loaded once from asset pack manifest `back` field
- [ ] Fallback: if image fails to load, show a styled placeholder with card name text

### US-MM-038.8: Responsive Layout

As a player, I want the game board to fit my screen whether I'm on desktop, tablet, or mobile.

**Acceptance Criteria:**
- [ ] Phaser game config uses `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }`
- [ ] Reference resolution: 1280x720 (16:9)
- [ ] Zone positions defined as normalized (0-1) coordinates, mapped to actual scene dimensions
- [ ] On resize, zones reposition and cards rescale
- [ ] Card sizes scale proportionally (minimum readable size enforced)
- [ ] Hand zone wraps or scrolls if too many cards for viewport width
- [ ] Touch input works on mobile (tap = click, touch-drag = drag-drop)
- [ ] Canvas maintains aspect ratio with letterboxing on non-16:9 screens

## Technical Details

### Key Interfaces

```typescript
// React → Phaser state contract
interface SceneState {
  players: Record<string, PlayerSceneState>;
  currentPlayer: string;
  viewingPlayer: string; // whose perspective we render
  phase: string;
  cardImages: Record<string, string>; // cardId → image URL
  cardBackUrl: string;
}

interface PlayerSceneState {
  zones: Record<string, ZoneSceneState>;
  playArea: SlotSceneState[];
}

interface ZoneSceneState {
  cards: CardSceneState[];
  zoneId: string;
}

interface CardSceneState {
  id: string;
  name: string;
  visibility: CardVisibilityState;
  isTapped: boolean;
  counter: number | null;
  power: number | null;
  attachedDon: number;
  position?: number; // index in zone
}

interface SlotSceneState {
  slotType: 'leader' | 'character' | 'stage';
  card: CardSceneState | null;
  attachedDon: number;
  position: number;
}

// Phaser → React event bridge
interface CardInteractionEvent {
  type: 'play' | 'draw' | 'tap' | 'untap' | 'attachDon' | 'detachDon' | 'peek' | 'discard';
  cardId?: string;
  sourceZone?: string;
  targetZone?: string;
  targetSlot?: number;
  playerId: string;
}

type EventBridgeCallback = (event: CardInteractionEvent) => void;
```

### Zone Layout (Normalized Coordinates)

```
┌─────────────────────────────────────────────────────┐
│  [Opp Hand]          [Opp Play Area]    [Opp Deck]  │  y: 0.0 - 0.15
│                                         [Opp Life]  │
│  [Opp Trash]  [Leader][C1][C2][C3][C4][C5] [Stage]  │  y: 0.15 - 0.40
│               [Opp DON!! Area]          [Opp DON]   │
│─────────────────────── center ───────────────────────│  y: 0.45 - 0.55
│               [My DON!! Area]           [My DON]    │
│  [My Trash]   [Leader][C1][C2][C3][C4][C5] [Stage]  │  y: 0.60 - 0.85
│                                         [My Life]   │
│  [My Hand]                              [My Deck]   │  y: 0.85 - 1.0
└─────────────────────────────────────────────────────┘
```

### File Structure

```
packages/frontend/src/
  phaser/
    PhaserBoard.tsx              # React wrapper component
    types.ts                     # SceneState, EventBridge, CardInteractionEvent
    CardGameScene.ts             # Main Phaser scene
    objects/
      CardSprite.ts              # Card container (image + overlays)
      ZoneRenderer.ts            # Zone background, label, card layout
      SlotRenderer.ts            # Play area slot rendering
      CardIndicators.ts          # Tap, counter, DON!!, visibility overlays
    layout/
      ZoneLayoutConfig.ts        # Normalized zone positions per game module
      OnePieceLayout.ts          # One Piece TCG specific layout
      ResponsiveScaler.ts        # Maps normalized coords → pixel coords
    input/
      DragDropManager.ts         # Card drag-drop logic
      EventBridge.ts             # Phaser → React event emitter
    assets/
      TextureManager.ts          # Bridge between React asset hooks and Phaser textures
      PlaceholderFactory.ts      # Generate placeholder card graphics
  components/
    OnePiecePhaserBoard.tsx      # One Piece-specific React board using PhaserBoard
```

### Integration Points

| System | How It Connects |
|--------|----------------|
| boardgame.io | `BoardProps<OnePieceGameState>` → `SceneState` conversion in `OnePiecePhaserBoard.tsx` |
| Asset pipeline | `useCardImage` hook resolves URLs → passed via `SceneState.cardImages` |
| One Piece types | `OnePieceCard`, `PlayAreaSlot`, `CardVisibilityState` imported from `game/modules/onepiece/` |
| Existing boards | `GoFishBoard.tsx` etc. remain unchanged — Phaser board is a new parallel component |

### Phaser Game Config

```typescript
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL with Canvas fallback
  parent: containerRef,
  width: 1280,
  height: 720,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [CardGameScene],
  backgroundColor: '#1a1a2e',
  input: {
    mouse: { target: containerRef },
    touch: { target: containerRef },
  },
};
```

## Files to Create/Modify

**New Files:**
- `packages/frontend/src/phaser/PhaserBoard.tsx` - React wrapper component
- `packages/frontend/src/phaser/types.ts` - SceneState, EventBridge, CardInteractionEvent interfaces
- `packages/frontend/src/phaser/CardGameScene.ts` - Main Phaser scene
- `packages/frontend/src/phaser/objects/CardSprite.ts` - Card container
- `packages/frontend/src/phaser/objects/ZoneRenderer.ts` - Zone rendering
- `packages/frontend/src/phaser/objects/SlotRenderer.ts` - Play area slot rendering
- `packages/frontend/src/phaser/objects/CardIndicators.ts` - State indicator overlays
- `packages/frontend/src/phaser/layout/ZoneLayoutConfig.ts` - Layout config type
- `packages/frontend/src/phaser/layout/OnePieceLayout.ts` - One Piece zone positions
- `packages/frontend/src/phaser/layout/ResponsiveScaler.ts` - Coordinate mapping
- `packages/frontend/src/phaser/input/DragDropManager.ts` - Drag-drop logic
- `packages/frontend/src/phaser/input/EventBridge.ts` - Event emitter bridge
- `packages/frontend/src/phaser/assets/TextureManager.ts` - Asset pipeline bridge
- `packages/frontend/src/phaser/assets/PlaceholderFactory.ts` - Placeholder card graphics
- `packages/frontend/src/components/OnePiecePhaserBoard.tsx` - One Piece board using Phaser

**Tests:**
- `packages/frontend/src/phaser/types.test.ts` - SceneState conversion, event types
- `packages/frontend/src/phaser/layout/ResponsiveScaler.test.ts` - Coordinate mapping math
- `packages/frontend/src/phaser/layout/OnePieceLayout.test.ts` - Zone positions valid
- `packages/frontend/src/phaser/objects/CardIndicators.test.ts` - Indicator logic
- `packages/frontend/src/phaser/input/EventBridge.test.ts` - Event emission/handling

**Modified Files:**
- `packages/frontend/src/App.tsx` - Add route or option to use Phaser board for One Piece games
- `packages/frontend/src/game/registry.ts` - Register Phaser board component for One Piece module

## Inventory Check

Before starting, verify:
- [ ] Phaser 3 is installed (`phaser` in package.json dependencies)
- [ ] One Piece module types available at `game/modules/onepiece/types.ts`
- [ ] One Piece zone definitions at `game/modules/onepiece/zones.ts`
- [ ] Asset manifest types at `assets/manifest/types.ts`
- [ ] `useCardImage` hook available for asset loading
- [ ] Card scraper output or sample card images available for testing

## Completion Criteria

- [ ] PhaserBoard React component mounts/unmounts cleanly
- [ ] All 7 One Piece zones render with correct layout for both players
- [ ] Play area slots render leader, character, and stage positions
- [ ] Card sprites load images from asset pipeline
- [ ] Face-down cards show card back
- [ ] Tap, counter, DON!!, and visibility indicators display correctly
- [ ] Drag-drop works: hand → play area, DON!! → slot
- [ ] Click interactions: draw from deck, tap/untap, card preview
- [ ] EventBridge dispatches events that map to boardgame.io moves
- [ ] Canvas scales responsively (desktop, tablet, mobile)
- [ ] Touch input works on mobile devices
- [ ] Tests pass
- [ ] Vite build succeeds with no new warnings from engine code

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
