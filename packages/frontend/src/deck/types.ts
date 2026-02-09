/**
 * Deck Builder Types
 *
 * Data contracts for the deck builder module. These types are framework-agnostic
 * (no React dependency) so the core logic is fully testable.
 */

import type { CardManifestEntry } from '../assets/manifest/types';

// =============================================================================
// Deck List
// =============================================================================

/**
 * A saved deck list. Stores card IDs + quantities, not full card objects.
 * Cards are resolved from the asset pack at runtime.
 */
export interface DeckList {
  /** Unique deck ID (UUID) */
  id: string;
  /** User-chosen deck name */
  name: string;
  /** Game type (always 'onepiece' for now) */
  game: 'onepiece';
  /** Asset pack ID this deck was built from */
  packId: string;
  /** Leader card ID */
  leaderId: string;
  /** Non-leader cards: cardId → quantity */
  cards: Record<string, number>;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
}

/**
 * Serializable deck format for YAML/TOML export.
 */
export interface DeckListExport {
  name: string;
  game: 'onepiece';
  pack: string;
  leader: string;
  cards: Record<string, number>;
}

// =============================================================================
// Validation
// =============================================================================

export type DeckValidationErrorType =
  | 'no-leader'
  | 'multiple-leaders'
  | 'wrong-deck-size'
  | 'over-copy-limit'
  | 'color-mismatch';

export interface DeckValidationError {
  type: DeckValidationErrorType;
  message: string;
  /** Card IDs involved in the error */
  cardIds?: string[];
}

export type DeckValidationWarningType =
  | 'low-counter-count'
  | 'high-cost-curve'
  | 'single-color-heavy';

export interface DeckValidationWarning {
  type: DeckValidationWarningType;
  message: string;
}

export interface DeckValidationResult {
  /** True if the deck passes all tournament rules */
  isValid: boolean;
  /** Rule violations */
  errors: DeckValidationError[];
  /** Non-blocking suggestions */
  warnings: DeckValidationWarning[];
  /** Total non-leader cards */
  totalCards: number;
  /** Whether a leader is set */
  hasLeader: boolean;
}

// =============================================================================
// Statistics
// =============================================================================

export interface DeckStats {
  /** Total non-leader cards */
  totalCards: number;
  /** Cost → count (non-leader only) */
  costCurve: Record<number, number>;
  /** Color → count */
  colorDistribution: Record<string, number>;
  /** Card type → count */
  typeBreakdown: Record<string, number>;
  /** Average cost of non-leader cards */
  avgCost: number;
  /** Counter analysis */
  counterDistribution: {
    withCounter: number;
    withoutCounter: number;
    avgCounter: number;
  };
  /** Power distribution for characters */
  powerDistribution: Record<number, number>;
}

// =============================================================================
// Card Filters
// =============================================================================

export interface CardFilters {
  search: string;
  colors: string[];
  cardTypes: string[];
  costMin: number | null;
  costMax: number | null;
  powerMin: number | null;
  powerMax: number | null;
  sets: string[];
  rarities: string[];
  sortBy: CardSortField;
  sortDir: 'asc' | 'desc';
}

export type CardSortField = 'name' | 'cost' | 'power' | 'color' | 'set' | 'rarity';

export const DEFAULT_FILTERS: CardFilters = {
  search: '',
  colors: [],
  cardTypes: [],
  costMin: null,
  costMax: null,
  powerMin: null,
  powerMax: null,
  sets: [],
  rarities: [],
  sortBy: 'cost',
  sortDir: 'asc',
};

// =============================================================================
// Deck Builder State
// =============================================================================

/**
 * Undo/redo action for deck construction.
 */
export interface DeckAction {
  type: 'add' | 'remove' | 'set-leader' | 'clear-leader';
  cardId: string;
  quantity?: number;
}

/**
 * Enriched card entry with resolved metadata for display.
 */
export interface EnrichedCard extends CardManifestEntry {
  /** Resolved colors from metadata */
  colors: string[];
  /** Resolved card type */
  cardType: string;
  /** Resolved cost */
  cost: number | null;
  /** Resolved power */
  power: number | null;
  /** Resolved counter */
  counter: number | null;
  /** Resolved rarity */
  rarity: string;
  /** Resolved set ID */
  set: string;
  /** Effect/ability text */
  effectText: string;
  /** Traits */
  traits: string[];
  /** Life (leaders only) */
  life: number | null;
}

/**
 * Extract enriched card data from a manifest entry's metadata.
 */
export function enrichCard(entry: CardManifestEntry): EnrichedCard {
  const meta = entry.metadata ?? {};
  return {
    ...entry,
    colors: ((meta.colors ?? meta.color) as string[] | undefined)
      ?.flatMap(c => String(c).toLowerCase().split(/[\s\/]+/))
      .filter(c => c.length > 0) ?? [],
    cardType: String(meta.cardType ?? meta.card_type ?? 'unknown').toLowerCase(),
    cost: meta.cost != null ? Number(meta.cost) : null,
    power: meta.power != null ? Number(meta.power) : null,
    counter: meta.counter != null ? Number(meta.counter) : null,
    rarity: String(meta.rarity ?? 'C'),
    set: String(meta.set ?? entry.id.replace(/-\d+$/, '')),
    effectText: String(meta.text ?? meta.effectText ?? ''),
    traits: (meta.traits as string[] | undefined) ?? [],
    life: meta.life != null ? Number(meta.life) : null,
  };
}
