/**
 * War Game Module
 *
 * Classic War card game implementation for ManaMesh.
 * Two players flip cards - higher card wins both.
 * On a tie, "war" is triggered: 3 face-down, 1 face-up.
 * Game ends when one player has all 52 cards.
 */

// Main module export
export { WarModule, WarGame } from './game';
export { default } from './game';

// Types
export type {
  WarCard,
  WarState,
  WarPlayerState,
  RoundResult,
  WarGameModule,
} from './types';

// Constants and utilities
export {
  WAR_ZONES,
  RANK_VALUES,
  getCardValue,
  compareCards,
} from './types';

// Game functions
export {
  createStandardDeck,
  shuffleDeck,
  createInitialState,
  getPlayerCardCount,
  checkGameOver,
  bothPlayersFlipped,
  flipCard,
  placeWarCards,
  resolveRound,
  validateMove,
} from './game';

// Crypto-enabled War (mental poker)
export {
  CryptoWarGame,
  CryptoWarModule,
  createCryptoWarState,
  getShuffleProofs,
  verifyPlayerShuffle,
} from './crypto';

export type {
  CryptoWarState,
  CryptoWarPlayerState,
  CryptoWarConfig,
} from './crypto';
