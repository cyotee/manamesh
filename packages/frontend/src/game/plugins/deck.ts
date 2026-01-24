/**
 * Deck Plugin for boardgame.io
 *
 * Provides shared deck operations that can be used by any game module:
 * - shuffle: Randomize deck order
 * - draw: Draw cards from top of deck
 * - deal: Distribute cards to players
 * - peek: View top cards without removing
 * - search: Find cards matching criteria
 * - moveCard: Move card between zones
 *
 * Works with both shared decks (Poker) and per-player decks (War).
 */

import type { Ctx } from 'boardgame.io';
import type { CoreCard } from '../modules/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Zone identifier - either a shared zone or player-specific zone.
 * Format: "zoneName" for shared zones, "zoneName:playerId" for player zones.
 */
export type ZoneId = string;

/**
 * Parsed zone reference.
 */
export interface ZoneRef {
  /** The zone name (e.g., 'deck', 'hand') */
  zone: string;
  /** Player ID if this is a player-specific zone, undefined for shared zones */
  playerId?: string;
}

/**
 * Game state structure expected by the deck plugin.
 * Games must have zones organized by zone name, then by 'shared' or player ID.
 */
export interface DeckPluginGameState<TCard extends CoreCard = CoreCard> {
  zones: Record<string, Record<string, TCard[]>>;
}

/**
 * Result of a draw operation.
 */
export interface DrawResult<TCard extends CoreCard = CoreCard> {
  /** Cards that were drawn */
  cards: TCard[];
  /** Whether the draw was successful (may be partial if deck didn't have enough) */
  success: boolean;
  /** Number of cards that couldn't be drawn (deck was empty) */
  shortfall: number;
}

/**
 * Result of a deal operation.
 */
export interface DealResult<TCard extends CoreCard = CoreCard> {
  /** Cards dealt to each player (playerId -> cards) */
  dealt: Record<string, TCard[]>;
  /** Whether the deal was successful */
  success: boolean;
  /** Number of cards that couldn't be dealt */
  shortfall: number;
}

/**
 * Result of a search operation.
 */
export interface SearchResult<TCard extends CoreCard = CoreCard> {
  /** Cards matching the predicate */
  cards: TCard[];
  /** Indices of matching cards in the zone */
  indices: number[];
}

/**
 * Result of a move operation.
 */
export interface MoveResult {
  /** Whether the move was successful */
  success: boolean;
  /** Error message if move failed */
  error?: string;
}

/**
 * The deck plugin API available in ctx.deck
 */
export interface DeckPluginApi<TCard extends CoreCard = CoreCard> {
  /**
   * Shuffle cards in a zone using Fisher-Yates algorithm.
   * @param zoneId - Zone to shuffle (e.g., 'deck' or 'deck:0')
   */
  shuffle: (zoneId: ZoneId) => void;

  /**
   * Draw cards from the top of a zone.
   * @param zoneId - Zone to draw from
   * @param count - Number of cards to draw (default: 1)
   * @returns Draw result with cards and success status
   */
  draw: (zoneId: ZoneId, count?: number) => DrawResult<TCard>;

  /**
   * Deal cards from a zone to multiple players' zones.
   * @param fromZoneId - Zone to deal from (usually a shared deck)
   * @param toZone - Zone name to deal to (e.g., 'hand')
   * @param count - Cards per player
   * @param playerIds - Players to deal to
   * @returns Deal result with dealt cards
   */
  deal: (
    fromZoneId: ZoneId,
    toZone: string,
    count: number,
    playerIds: string[]
  ) => DealResult<TCard>;

  /**
   * Peek at cards from the top of a zone without removing them.
   * @param zoneId - Zone to peek at
   * @param count - Number of cards to peek (default: 1)
   * @returns Array of cards (may be shorter if zone has fewer cards)
   */
  peek: (zoneId: ZoneId, count?: number) => TCard[];

  /**
   * Search for cards matching a predicate.
   * @param zoneId - Zone to search
   * @param predicate - Function to test each card
   * @returns Search result with matching cards and their indices
   */
  search: (
    zoneId: ZoneId,
    predicate: (card: TCard) => boolean
  ) => SearchResult<TCard>;

  /**
   * Move a specific card from one zone to another.
   * @param cardId - ID of the card to move
   * @param fromZoneId - Source zone
   * @param toZoneId - Destination zone
   * @param toIndex - Optional index to insert at (default: end)
   * @returns Move result with success status
   */
  moveCard: (
    cardId: string,
    fromZoneId: ZoneId,
    toZoneId: ZoneId,
    toIndex?: number
  ) => MoveResult;

  /**
   * Move cards from top of one zone to another.
   * @param fromZoneId - Source zone
   * @param toZoneId - Destination zone
   * @param count - Number of cards to move (default: 1)
   * @returns Move result with success status
   */
  moveTop: (
    fromZoneId: ZoneId,
    toZoneId: ZoneId,
    count?: number
  ) => MoveResult;

  /**
   * Get the number of cards in a zone.
   * @param zoneId - Zone to count
   * @returns Number of cards
   */
  count: (zoneId: ZoneId) => number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse a zone ID into zone name and optional player ID.
 * Format: "zoneName" for shared, "zoneName:playerId" for player-specific.
 */
export function parseZoneId(zoneId: ZoneId): ZoneRef {
  const colonIndex = zoneId.indexOf(':');
  if (colonIndex === -1) {
    return { zone: zoneId };
  }
  return {
    zone: zoneId.substring(0, colonIndex),
    playerId: zoneId.substring(colonIndex + 1),
  };
}

/**
 * Build a zone ID from zone name and optional player ID.
 */
export function buildZoneId(zone: string, playerId?: string): ZoneId {
  return playerId ? `${zone}:${playerId}` : zone;
}

/**
 * Get cards from a zone in the game state.
 * For shared zones, looks for 'shared' key.
 * For player zones, looks for player ID key.
 */
export function getZoneCards<TCard extends CoreCard>(
  G: DeckPluginGameState<TCard>,
  zoneId: ZoneId
): TCard[] | undefined {
  const { zone, playerId } = parseZoneId(zoneId);
  const zoneData = G.zones[zone];
  if (!zoneData) return undefined;

  // If player specified, get player's cards
  if (playerId !== undefined) {
    return zoneData[playerId];
  }

  // For shared zone, look for 'shared' key
  return zoneData['shared'];
}

/**
 * Set cards in a zone in the game state.
 * Mutates G in place (boardgame.io uses Immer).
 */
export function setZoneCards<TCard extends CoreCard>(
  G: DeckPluginGameState<TCard>,
  zoneId: ZoneId,
  cards: TCard[]
): void {
  const { zone, playerId } = parseZoneId(zoneId);

  // Ensure zone exists
  if (!G.zones[zone]) {
    G.zones[zone] = {};
  }

  const key = playerId ?? 'shared';
  G.zones[zone][key] = cards;
}

/**
 * Fisher-Yates shuffle algorithm.
 * Returns a new shuffled array.
 */
export function fisherYatesShuffle<T>(array: T[]): T[] {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// =============================================================================
// Plugin Implementation
// =============================================================================

/**
 * Plugin data stored in game state.
 * Currently minimal - could track operation history if needed.
 */
export interface DeckPluginData {
  /** Tracks number of shuffles for debugging/replay */
  shuffleCount: number;
}

/**
 * Context type with deck plugin API.
 */
export interface CtxWithDeck extends Ctx {
  deck: DeckPluginApi;
}

/**
 * Create the deck plugin for boardgame.io.
 *
 * @example
 * ```typescript
 * import { DeckPlugin } from './plugins/deck';
 *
 * const game: Game = {
 *   plugins: [DeckPlugin],
 *   moves: {
 *     drawCard: ({ G, ctx }) => {
 *       const { cards } = (ctx as CtxWithDeck).deck.draw('deck:' + ctx.currentPlayer);
 *       // cards are automatically moved to... where the game logic puts them
 *     },
 *   },
 * };
 * ```
 */
/**
 * Extended API type that includes internal tracking.
 */
interface DeckPluginApiInternal<TCard extends CoreCard = CoreCard>
  extends DeckPluginApi<TCard> {
  _pendingShuffles: number;
}

export const DeckPlugin = {
  name: 'deck',

  setup: (): DeckPluginData => ({
    shuffleCount: 0,
  }),

  api: <TCard extends CoreCard = CoreCard>({
    G,
  }: {
    G: DeckPluginGameState<TCard>;
    ctx: Ctx;
    data: DeckPluginData;
  }): DeckPluginApiInternal<TCard> => {
    // Create the api object first so we can reference it for tracking
    const api: DeckPluginApiInternal<TCard> = {
      _pendingShuffles: 0,

      shuffle: (zoneId: ZoneId): void => {
        const cards = getZoneCards(G, zoneId);
        if (!cards) return;

        const shuffled = fisherYatesShuffle(cards);
        setZoneCards(G, zoneId, shuffled);
        api._pendingShuffles++;
      },

      draw: (zoneId: ZoneId, count = 1): DrawResult<TCard> => {
        const cards = getZoneCards(G, zoneId);
        if (!cards || cards.length === 0) {
          return { cards: [], success: false, shortfall: count };
        }

        const available = Math.min(count, cards.length);
        const drawn = cards.splice(0, available);

        return {
          cards: drawn,
          success: available === count,
          shortfall: count - available,
        };
      },

      deal: (
        fromZoneId: ZoneId,
        toZone: string,
        count: number,
        playerIds: string[]
      ): DealResult<TCard> => {
        const sourceCards = getZoneCards(G, fromZoneId);
        if (!sourceCards) {
          return {
            dealt: {},
            success: false,
            shortfall: count * playerIds.length,
          };
        }

        const dealt: Record<string, TCard[]> = {};
        let totalDealt = 0;
        const totalNeeded = count * playerIds.length;

        // Deal one card at a time to each player (round-robin)
        for (let round = 0; round < count; round++) {
          for (const playerId of playerIds) {
            if (sourceCards.length === 0) break;

            const card = sourceCards.shift()!;

            if (!dealt[playerId]) {
              dealt[playerId] = [];
            }
            dealt[playerId].push(card);

            // Add to player's zone
            const destZoneId = buildZoneId(toZone, playerId);
            const destCards = getZoneCards(G, destZoneId) || [];
            destCards.push(card);
            setZoneCards(G, destZoneId, destCards);

            totalDealt++;
          }
        }

        return {
          dealt,
          success: totalDealt === totalNeeded,
          shortfall: totalNeeded - totalDealt,
        };
      },

      peek: (zoneId: ZoneId, count = 1): TCard[] => {
        const cards = getZoneCards(G, zoneId);
        if (!cards) return [];

        return cards.slice(0, Math.min(count, cards.length));
      },

      search: (
        zoneId: ZoneId,
        predicate: (card: TCard) => boolean
      ): SearchResult<TCard> => {
        const cards = getZoneCards(G, zoneId);
        if (!cards) return { cards: [], indices: [] };

        const matchingCards: TCard[] = [];
        const matchingIndices: number[] = [];

        cards.forEach((card, index) => {
          if (predicate(card)) {
            matchingCards.push(card);
            matchingIndices.push(index);
          }
        });

        return { cards: matchingCards, indices: matchingIndices };
      },

      moveCard: (
        cardId: string,
        fromZoneId: ZoneId,
        toZoneId: ZoneId,
        toIndex?: number
      ): MoveResult => {
        const sourceCards = getZoneCards(G, fromZoneId);
        if (!sourceCards) {
          return { success: false, error: `Source zone not found: ${fromZoneId}` };
        }

        const cardIndex = sourceCards.findIndex((c) => c.id === cardId);
        if (cardIndex === -1) {
          return { success: false, error: `Card not found: ${cardId}` };
        }

        // Remove from source
        const [card] = sourceCards.splice(cardIndex, 1);

        // Add to destination
        let destCards = getZoneCards(G, toZoneId);
        if (!destCards) {
          destCards = [];
          setZoneCards(G, toZoneId, destCards);
        }

        if (toIndex !== undefined && toIndex >= 0 && toIndex <= destCards.length) {
          destCards.splice(toIndex, 0, card);
        } else {
          destCards.push(card);
        }

        return { success: true };
      },

      moveTop: (
        fromZoneId: ZoneId,
        toZoneId: ZoneId,
        count = 1
      ): MoveResult => {
        const sourceCards = getZoneCards(G, fromZoneId);
        if (!sourceCards || sourceCards.length === 0) {
          return { success: false, error: `Source zone empty or not found: ${fromZoneId}` };
        }

        const toMove = Math.min(count, sourceCards.length);
        const cards = sourceCards.splice(0, toMove);

        let destCards = getZoneCards(G, toZoneId);
        if (!destCards) {
          destCards = [];
          setZoneCards(G, toZoneId, destCards);
        }

        destCards.push(...cards);

        return { success: toMove === count };
      },

      count: (zoneId: ZoneId): number => {
        const cards = getZoneCards(G, zoneId);
        return cards?.length ?? 0;
      },
    };

    return api;
  },

  flush: ({
    data,
    api,
  }: {
    G: DeckPluginGameState;
    ctx: Ctx;
    data: DeckPluginData;
    api: DeckPluginApi & { _pendingShuffles?: number };
  }): DeckPluginData => {
    const pendingShuffles = api._pendingShuffles ?? 0;
    return {
      ...data,
      shuffleCount: data.shuffleCount + pendingShuffles,
    };
  },
};

export default DeckPlugin;
