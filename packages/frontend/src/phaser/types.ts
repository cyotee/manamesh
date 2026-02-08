/**
 * Phaser Card Rendering Engine Types
 *
 * Defines the contract between React (state owner) and Phaser (visual layer).
 * React converts boardgame.io state into SceneState; Phaser renders it.
 * Phaser emits CardInteractionEvents back to React via the EventBridge.
 */

import type { CardVisibilityState, SlotType } from '../game/modules/onepiece/types';

// =============================================================================
// React → Phaser: Scene State
// =============================================================================

/**
 * Complete state snapshot passed from React to the Phaser scene.
 * The scene re-renders whenever this changes.
 */
export interface SceneState {
  /** Per-player state keyed by player ID */
  players: Record<string, PlayerSceneState>;
  /** Player whose turn it is */
  currentPlayer: string;
  /** Player whose perspective we render (local player) */
  viewingPlayer: string;
  /** Current game phase */
  phase: string;
  /** Map of cardId → resolved image URL (from useCardImage hook) */
  cardImages: Record<string, string>;
  /** Default card back image URL */
  cardBackUrl: string;
  /** Whether interactions are enabled (false during setup phases) */
  interactionsEnabled: boolean;
}

/**
 * A single player's zone and play area state for rendering.
 */
export interface PlayerSceneState {
  /** All zones for this player, keyed by zone ID */
  zones: Record<string, ZoneSceneState>;
  /** Play area slots (leader, characters, stage) */
  playArea: SlotSceneState[];
}

/**
 * State of a single zone for rendering.
 */
export interface ZoneSceneState {
  /** Zone identifier (matches ZONE_IDS from onepiece/zones.ts) */
  zoneId: string;
  /** Cards currently in this zone */
  cards: CardSceneState[];
}

/**
 * Renderable state of a single card.
 */
export interface CardSceneState {
  /** Unique card instance ID */
  id: string;
  /** Card display name */
  name: string;
  /** Current visibility state */
  visibility: CardVisibilityState;
  /** Whether the card is tapped (rotated 90deg) */
  isTapped: boolean;
  /** Counter value (e.g., +1000 power boost), null if none */
  counter: number | null;
  /** Power value for characters/leaders in play, null if not applicable */
  power: number | null;
  /** Number of DON!! attached to this card */
  attachedDon: number;
  /** Index position within the zone */
  position: number;
}

/**
 * Renderable state of a play area slot.
 */
export interface SlotSceneState {
  /** Slot type (leader, character, stage) */
  slotType: SlotType;
  /** Card in this slot, or null if empty */
  card: CardSceneState | null;
  /** Number of DON!! attached to the slot's card */
  attachedDon: number;
  /** Slot position index */
  position: number;
}

// =============================================================================
// Phaser → React: Interaction Events
// =============================================================================

/** All interaction event types the Phaser scene can emit. */
export type CardInteractionType =
  | 'play'
  | 'draw'
  | 'tap'
  | 'untap'
  | 'attachDon'
  | 'detachDon'
  | 'peek'
  | 'discard'
  | 'preview';

/**
 * Event emitted by Phaser when the player interacts with a card or zone.
 * React maps these to boardgame.io moves.
 */
export interface CardInteractionEvent {
  /** What kind of interaction occurred */
  type: CardInteractionType;
  /** Card involved (if any) */
  cardId?: string;
  /** Zone the card came from */
  sourceZone?: string;
  /** Zone the card was dropped into */
  targetZone?: string;
  /** Target slot index in play area (if dropping onto a slot) */
  targetSlot?: number;
  /** Player who performed the interaction */
  playerId: string;
}

/**
 * Callback type for handling interaction events.
 */
export type EventBridgeCallback = (event: CardInteractionEvent) => void;

// =============================================================================
// Layout Types
// =============================================================================

/**
 * Normalized position (0–1 range) for responsive layout.
 * Mapped to actual pixel coordinates by ResponsiveScaler.
 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Layout configuration for all zones of a single player.
 */
export interface PlayerZoneLayout {
  mainDeck: NormalizedRect;
  lifeDeck: NormalizedRect;
  donDeck: NormalizedRect;
  trash: NormalizedRect;
  hand: NormalizedRect;
  playArea: NormalizedRect;
  donArea: NormalizedRect;
}

/**
 * Complete board layout for a two-player game.
 */
export interface BoardLayout {
  /** Local player (bottom half) */
  local: PlayerZoneLayout;
  /** Opponent (top half, mirrored) */
  opponent: PlayerZoneLayout;
}

// =============================================================================
// Card Dimensions
// =============================================================================

/** Standard card aspect ratio (poker-size: 2.5 x 3.5 inches) */
export const CARD_ASPECT_RATIO = 2.5 / 3.5;

/** Card sizes for different contexts */
export interface CardDimensions {
  width: number;
  height: number;
}

export const CARD_SIZES = {
  /** Cards in the play area */
  normal: { width: 80, height: 112 } as CardDimensions,
  /** Cards in hand (slightly smaller) */
  hand: { width: 70, height: 98 } as CardDimensions,
  /** Stacked decks (only top visible) */
  deck: { width: 80, height: 112 } as CardDimensions,
  /** Leader card (slightly larger) */
  leader: { width: 90, height: 126 } as CardDimensions,
  /** DON!! cards (smaller) */
  don: { width: 50, height: 70 } as CardDimensions,
  /** Card preview on hover */
  preview: { width: 200, height: 280 } as CardDimensions,
} as const;
