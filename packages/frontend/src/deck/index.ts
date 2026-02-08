/**
 * Deck Builder Module — Public API
 *
 * Re-exports all deck builder functionality for clean imports:
 *   import { validateDeck, saveDeck, exportToYaml } from '../deck';
 */

// Types
export type {
  DeckList,
  DeckListExport,
  DeckValidationResult,
  DeckValidationError,
  DeckValidationErrorType,
  DeckValidationWarning,
  DeckValidationWarningType,
  DeckStats,
  CardFilters,
  CardSortField,
  DeckAction,
  EnrichedCard,
} from './types';

export { DEFAULT_FILTERS, enrichCard } from './types';

// Validation
export { validateDeck, canAddCard } from './validation';

// Statistics
export { calculateDeckStats } from './stats';

// Serialization
export {
  exportToYaml,
  exportToToml,
  importFromYaml,
  importFromToml,
  importFromText,
  exportToDeckList,
  downloadFile,
  readFileAsText,
} from './serialization';

// Bracket styling
export type { BracketStyleConfig, TextSegment } from './bracket-styles';
export {
  DEFAULT_BRACKET_STYLES,
  DEFAULT_BRACKET_FALLBACK_COLOR,
  getBracketStyles,
  setBracketStyles,
  getBracketFallbackColor,
  setBracketFallbackColor,
  resetBracketStyles,
  parseEffectText,
} from './bracket-styles';

// Storage
export {
  saveDeck,
  getDeck,
  deleteDeck,
  getAllDecks,
  getDeckIds,
  duplicateDeck,
  clearAllDecks,
  createEmptyDeck,
} from './storage';
