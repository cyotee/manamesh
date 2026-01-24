/**
 * War Game Module Types
 *
 * Type definitions for the War card game.
 */

import type { StandardCard, ZoneDefinition, GameModule } from '../types';

// =============================================================================
// Card Types
// =============================================================================

/**
 * War game uses standard playing cards.
 * Re-export for convenience.
 */
export type WarCard = StandardCard;

/**
 * Card rank values for comparison.
 * Ace is high in War.
 */
export const RANK_VALUES: Record<WarCard['rank'], number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14,
};

/**
 * Get the numeric value of a card for comparison.
 */
export function getCardValue(card: WarCard): number {
  return RANK_VALUES[card.rank];
}

/**
 * Compare two cards, returning positive if a wins, negative if b wins, 0 if tie.
 */
export function compareCards(a: WarCard, b: WarCard): number {
  return getCardValue(a) - getCardValue(b);
}

// =============================================================================
// Game State
// =============================================================================

/**
 * Per-player state in War.
 */
export interface WarPlayerState {
  /** Face-down deck to draw from */
  deck: WarCard[];
  /** Currently played card(s) - face-up during round */
  played: WarCard[];
  /** Won cards pile */
  won: WarCard[];
}

/**
 * War game state.
 */
export interface WarState {
  /** Player states indexed by player ID */
  players: Record<string, WarPlayerState>;

  /** Whether a "war" is currently in progress (matching cards) */
  warInProgress: boolean;

  /** Winner player ID (null if game not over) */
  winner: string | null;

  /** Current game phase */
  phase: 'flip' | 'resolve' | 'gameOver';

  /** Zones for the deck plugin (mirrors players state) */
  zones: Record<string, Record<string, WarCard[]>>;
}

// =============================================================================
// Zone Definitions
// =============================================================================

/**
 * War game zones.
 */
export const WAR_ZONES: ZoneDefinition[] = [
  {
    id: 'deck',
    name: 'Deck',
    visibility: 'hidden',
    shared: false,
    ordered: true,
    features: ['shuffle', 'draw'],
  },
  {
    id: 'played',
    name: 'Played Card',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['reveal'],
  },
  {
    id: 'won',
    name: 'Won Cards',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['stack'],
  },
];

// =============================================================================
// Move Types
// =============================================================================

/**
 * Result of comparing played cards.
 */
export interface RoundResult {
  /** Winner player ID, or null if war */
  winner: string | null;
  /** Whether this triggers a war */
  isWar: boolean;
  /** Cards won this round (empty if war) */
  cardsWon: WarCard[];
}

// =============================================================================
// Module Type
// =============================================================================

/**
 * War game module type.
 */
export type WarGameModule = GameModule<WarCard, WarState>;
