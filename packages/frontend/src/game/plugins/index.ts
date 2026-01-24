/**
 * boardgame.io Plugins
 *
 * This module exports all custom plugins for use with boardgame.io.
 */

// Deck operations plugin
export {
  DeckPlugin,
  // Types
  type ZoneId,
  type ZoneRef,
  type DeckPluginGameState,
  type DrawResult,
  type DealResult,
  type SearchResult,
  type MoveResult,
  type DeckPluginApi,
  type DeckPluginData,
  type CtxWithDeck,
  // Helpers
  parseZoneId,
  buildZoneId,
  getZoneCards,
  setZoneCards,
  fisherYatesShuffle,
} from './deck';
