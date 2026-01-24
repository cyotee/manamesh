/**
 * Core Game Module Interface Types
 *
 * These interfaces define the contract that all game modules must implement.
 * Game modules are pluggable definitions for different card games (MTG, Poker, etc.)
 * that integrate with boardgame.io and the ManaMesh rendering system.
 */

import type { Game } from 'boardgame.io';

// =============================================================================
// Asset Types
// =============================================================================

/**
 * Types of assets that can be loaded from asset packs.
 */
export type AssetType =
  | 'card_face'
  | 'card_back'
  | 'token'
  | 'counter'
  | 'playmat'
  | 'icon';

/**
 * How cards are identified for asset lookup.
 * Different games use different ID schemes.
 */
export type CardIdFormat =
  | 'scryfall_uuid'     // MTG: Scryfall UUIDs
  | 'standard_52'       // Poker/War: suit-rank format (e.g., 'hearts-A')
  | 'set_collector'     // Set code + collector number
  | 'custom';           // Game-specific format

// =============================================================================
// Zone System
// =============================================================================

/**
 * Features available for zone interactions.
 * These determine what operations can be performed on cards in a zone.
 */
export type ZoneFeature =
  | 'search'    // Can search through cards (tutor)
  | 'peek'      // Can peek at top N cards (scry)
  | 'shuffle'   // Can shuffle the zone
  | 'reorder'   // Can manually reorder cards
  | 'reveal'    // Can reveal cards to opponents
  | 'draw'      // Can draw from this zone
  | 'play'      // Can play cards from this zone
  | 'tap'       // Cards can be tapped/untapped
  | 'counter'   // Cards can have counters
  | 'stack';    // Cards can be stacked (overlapping display)

/**
 * Visibility levels for zones and cards.
 */
export type Visibility =
  | 'public'      // Visible to all players
  | 'private'     // Not visible to any player (face down)
  | 'owner-only'  // Only visible to the owning player
  | 'hidden';     // Completely hidden (not rendered)

/**
 * Defines a logical zone where cards can exist.
 * Zones are the fundamental building blocks of game state organization.
 */
export interface ZoneDefinition {
  /** Unique identifier for this zone (e.g., 'library', 'hand', 'battlefield') */
  id: string;

  /** Display name for UI rendering */
  name: string;

  /** Who can see cards in this zone */
  visibility: Visibility;

  /** Whether this zone is shared between all players (e.g., community cards in Poker) */
  shared: boolean;

  /** Maximum number of cards allowed in this zone (undefined = unlimited) */
  maxCards?: number;

  /** Whether the order of cards matters (true for libraries, false for battlefields) */
  ordered: boolean;

  /** Available features/operations for this zone */
  features: ZoneFeature[];
}

// =============================================================================
// Card Schema
// =============================================================================

/**
 * Core card properties that all game cards share.
 * Game-specific cards extend this interface with additional fields.
 */
export interface CoreCard {
  /** Unique identifier for this card instance */
  id: string;

  /** Card name for display */
  name: string;

  /** IPFS CID for the card face image (optional if using asset pack lookup) */
  imageCid?: string;

  /** IPFS CID for the card back image (for double-faced cards) */
  backImageCid?: string;
}

/**
 * Card schema definition for a game module.
 * Describes the shape of cards used in this game.
 */
export interface CardSchema<T extends CoreCard = CoreCard> {
  /** Type guard to validate a card matches this schema */
  validate: (card: unknown) => card is T;

  /** Create a card instance from raw data */
  create: (data: Partial<T> & { id: string; name: string }) => T;

  /** Get the asset lookup key for a card (used to find card images) */
  getAssetKey: (card: T) => string;
}

// =============================================================================
// Asset Requirements
// =============================================================================

/**
 * Declares what asset types a game module requires and supports.
 */
export interface GameModuleAssetRequirements {
  /** Asset types that must be available for the game to function */
  required: AssetType[];

  /** Asset types that can be used but are not required */
  optional: AssetType[];

  /** How cards are identified for asset lookup */
  idFormat: CardIdFormat;
}

// =============================================================================
// Rendering Configuration
// =============================================================================

/**
 * How cards should be arranged within a zone.
 */
export type CardArrangement =
  | 'stack'   // Cards stacked on top of each other (deck)
  | 'fan'     // Cards spread in a fan pattern (hand)
  | 'grid'    // Cards arranged in a grid (battlefield)
  | 'row'     // Cards arranged in a horizontal row
  | 'column'; // Cards arranged in a vertical column

/**
 * Layout configuration for a single zone.
 */
export interface ZoneLayout {
  /** X position as percentage of screen width (0-100) */
  x: number;

  /** Y position as percentage of screen height (0-100) */
  y: number;

  /** Width as percentage of screen width */
  width: number;

  /** Height as percentage of screen height */
  height: number;

  /** How cards are arranged in this zone */
  cardArrangement: CardArrangement;

  /** Optional rotation angle in degrees */
  rotation?: number;

  /** Optional z-index for layering */
  zIndex?: number;
}

/**
 * Complete zone layout configuration for a game module.
 * Maps zone IDs to their layout settings.
 */
export interface ZoneLayoutConfig {
  /** Layout settings for each zone */
  zones: Record<string, ZoneLayout>;

  /** Default card dimensions (can be overridden per zone) */
  defaultCardSize?: {
    width: number;
    height: number;
  };
}

// =============================================================================
// Game State Types
// =============================================================================

/**
 * Configuration passed to game setup.
 */
export interface GameConfig {
  /** Number of players */
  numPlayers: number;

  /** Player IDs */
  playerIDs: string[];

  /** Optional game-specific settings */
  options?: Record<string, unknown>;
}

/**
 * Base game state structure.
 * Game modules extend this with game-specific state.
 */
export interface BaseGameState<TCard extends CoreCard = CoreCard> {
  /** Cards organized by zone and player */
  zones: Record<string, Record<string, TCard[]>>;

  /** Current game phase */
  phase?: string;

  /** Winner player ID (if game is over) */
  winner?: string;
}

/**
 * A move that can be made in the game.
 */
export interface GameMove<TState extends BaseGameState = BaseGameState> {
  /** Move name */
  name: string;

  /** Validate if the move is legal */
  validate?: (state: TState, playerID: string, ...args: unknown[]) => boolean;

  /** Execute the move */
  execute: (state: TState, playerID: string, ...args: unknown[]) => TState;
}

/**
 * Result of move validation.
 */
export interface MoveValidation {
  /** Whether the move is valid */
  valid: boolean;

  /** Error message if invalid */
  error?: string;
}

// =============================================================================
// Game Module Interface
// =============================================================================

/**
 * The main interface that all game modules must implement.
 *
 * A game module defines everything needed to play a specific card game:
 * - Identity (id, name, version)
 * - Card schema (what fields cards have)
 * - Zone definitions (where cards can be)
 * - Asset requirements (what images are needed)
 * - Game logic (initial state, move validation)
 * - Rendering hints (zone layouts)
 *
 * @template TCard - The card type used by this game
 * @template TState - The game state type
 *
 * @example
 * ```typescript
 * const PokerModule: GameModule<PokerCard, PokerState> = {
 *   id: 'poker',
 *   name: 'Texas Hold\'em Poker',
 *   version: '1.0.0',
 *   // ... rest of implementation
 * };
 * ```
 */
export interface GameModule<
  TCard extends CoreCard = CoreCard,
  TState extends BaseGameState<TCard> = BaseGameState<TCard>,
> {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  /** Unique identifier for this game module (e.g., 'poker', 'mtg', 'lorcana') */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Semantic version string */
  version: string;

  /** Optional description of the game */
  description?: string;

  // ---------------------------------------------------------------------------
  // Card Schema
  // ---------------------------------------------------------------------------

  /** Schema definition for cards used in this game */
  cardSchema: CardSchema<TCard>;

  // ---------------------------------------------------------------------------
  // Zone Definitions
  // ---------------------------------------------------------------------------

  /** All zones used in this game */
  zones: ZoneDefinition[];

  // ---------------------------------------------------------------------------
  // Asset Requirements
  // ---------------------------------------------------------------------------

  /** What assets this game needs */
  assetRequirements: GameModuleAssetRequirements;

  // ---------------------------------------------------------------------------
  // Game Logic
  // ---------------------------------------------------------------------------

  /**
   * Create the initial game state.
   * @param config - Game configuration including player count
   * @returns Initial game state
   */
  initialState: (config: GameConfig) => TState;

  /**
   * Validate whether a move is legal.
   * @param state - Current game state
   * @param move - The move to validate
   * @param playerID - Player attempting the move
   * @param args - Move arguments
   * @returns Validation result
   */
  validateMove: (
    state: TState,
    move: string,
    playerID: string,
    ...args: unknown[]
  ) => MoveValidation;

  /**
   * Get the boardgame.io Game definition.
   * This integrates the module with boardgame.io's framework.
   */
  getBoardgameIOGame: () => Game<TState>;

  // ---------------------------------------------------------------------------
  // Rendering (Optional)
  // ---------------------------------------------------------------------------

  /** Custom zone layout configuration */
  zoneLayout?: ZoneLayoutConfig;

  /**
   * Optional custom Phaser scene class for full rendering control.
   * If not provided, the default renderer will be used with zoneLayout.
   */
  // customRenderer?: new (...args: unknown[]) => Phaser.Scene;
}

// =============================================================================
// Game-Specific Card Extensions
// =============================================================================

/**
 * Standard 52-card deck card (used by Poker, War, etc.)
 */
export interface StandardCard extends CoreCard {
  /** Card suit */
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';

  /** Card rank */
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
}

/** Alias for War game cards (same as standard playing cards) */
export type WarCard = StandardCard;

/** Alias for Poker game cards (same as standard playing cards) */
export type PokerCard = StandardCard;

/**
 * Magic: The Gathering card
 */
export interface MTGCard extends CoreCard {
  /** Mana cost string (e.g., '{2}{U}{U}') */
  manaCost?: string;

  /** Card types (e.g., ['Creature', 'Artifact']) */
  types: string[];

  /** Subtypes (e.g., ['Human', 'Wizard']) */
  subtypes?: string[];

  /** Power (for creatures) */
  power?: number;

  /** Toughness (for creatures) */
  toughness?: number;

  /** Starting loyalty (for planeswalkers) */
  loyalty?: number;

  /** Oracle text / rules text */
  oracleText?: string;

  /** Set code */
  set: string;

  /** Collector number within the set */
  collectorNumber: string;
}

/**
 * Disney Lorcana card
 */
export interface LorcanaCard extends CoreCard {
  /** Ink cost to play */
  inkCost: number;

  /** Whether this card can be used as ink */
  inkable: boolean;

  /** Strength (for characters) */
  strength?: number;

  /** Willpower (for characters) */
  willpower?: number;

  /** Lore value when questing */
  lore?: number;

  /** Card abilities */
  abilities: string[];
}

/**
 * One Piece TCG card
 */
export interface OnePieceCard extends CoreCard {
  /** Card cost */
  cost: number;

  /** Card power */
  power?: number;

  /** Card color */
  color: 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

  /** Card type */
  cardType: 'leader' | 'character' | 'event' | 'stage';

  /** Card attributes */
  attributes?: string[];

  /** Card effect text */
  effect?: string;
}
