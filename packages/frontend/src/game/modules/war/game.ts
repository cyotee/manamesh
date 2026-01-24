/**
 * War Game Module
 *
 * Implementation of the classic War card game for boardgame.io.
 * Two players flip cards, higher card wins both. On a tie, war is triggered.
 */

import type { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { StandardCard, CardSchema, GameConfig, MoveValidation } from '../types';
import {
  WarCard,
  WarState,
  WarPlayerState,
  WAR_ZONES,
  compareCards,
  getCardValue,
  RANK_VALUES,
} from './types';

// =============================================================================
// Constants
// =============================================================================

const SUITS: WarCard['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: WarCard['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Number of cards to place face-down during war */
const WAR_FACE_DOWN_COUNT = 3;

// =============================================================================
// Card Creation
// =============================================================================

/**
 * Create a standard 52-card deck.
 */
export function createStandardDeck(): WarCard[] {
  const deck: WarCard[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}-${rank}`,
        name: `${rank} of ${suit}`,
        suit,
        rank,
      });
    }
  }

  return deck;
}

/**
 * Fisher-Yates shuffle.
 */
export function shuffleDeck<T>(deck: T[]): T[] {
  const result = deck.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Create initial game state.
 */
export function createInitialState(config: GameConfig): WarState {
  const deck = shuffleDeck(createStandardDeck());
  const halfDeck = Math.floor(deck.length / 2);

  const players: Record<string, WarPlayerState> = {};
  const zones: Record<string, Record<string, WarCard[]>> = {
    deck: {},
    played: {},
    won: {},
  };

  // Deal cards to each player
  config.playerIDs.forEach((playerId, index) => {
    const start = index * halfDeck;
    const playerDeck = deck.slice(start, start + halfDeck);

    players[playerId] = {
      deck: playerDeck,
      played: [],
      won: [],
    };

    // Mirror to zones for deck plugin compatibility
    zones.deck[playerId] = playerDeck;
    zones.played[playerId] = [];
    zones.won[playerId] = [];
  });

  return {
    players,
    warInProgress: false,
    winner: null,
    phase: 'flip',
    zones,
  };
}

/**
 * Sync zones from players state.
 */
function syncZones(state: WarState): void {
  for (const playerId of Object.keys(state.players)) {
    state.zones.deck[playerId] = state.players[playerId].deck;
    state.zones.played[playerId] = state.players[playerId].played;
    state.zones.won[playerId] = state.players[playerId].won;
  }
}

/**
 * Get total card count for a player.
 */
export function getPlayerCardCount(player: WarPlayerState): number {
  return player.deck.length + player.played.length + player.won.length;
}

/**
 * Check if game is over (one player has all cards or other player has none).
 */
export function checkGameOver(state: WarState): string | null {
  const playerIds = Object.keys(state.players);

  for (const playerId of playerIds) {
    const count = getPlayerCardCount(state.players[playerId]);
    if (count === 52) {
      return playerId;
    }
    if (count === 0) {
      // Other player wins
      return playerIds.find((id) => id !== playerId) || null;
    }
  }

  return null;
}

/**
 * Check if both players have flipped cards.
 */
export function bothPlayersFlipped(state: WarState): boolean {
  return Object.values(state.players).every((p) => p.played.length > 0);
}

/**
 * Reshuffle won pile into deck if deck is empty.
 */
function reshuffleWonPile(player: WarPlayerState): void {
  if (player.deck.length === 0 && player.won.length > 0) {
    player.deck = shuffleDeck(player.won);
    player.won = [];
  }
}

// =============================================================================
// Moves
// =============================================================================

/**
 * Flip the top card from deck to played zone.
 */
export function flipCard(
  G: WarState,
  ctx: Ctx,
  _playerId?: string
): WarState | typeof INVALID_MOVE {
  const playerId = _playerId ?? ctx.currentPlayer;
  const player = G.players[playerId];

  if (!player) {
    return INVALID_MOVE;
  }

  // Can't flip if already have a played card (unless in war)
  if (player.played.length > 0 && !G.warInProgress) {
    return INVALID_MOVE;
  }

  // Reshuffle won pile if needed
  reshuffleWonPile(player);

  // Can't flip if no cards left
  if (player.deck.length === 0) {
    return INVALID_MOVE;
  }

  // Flip top card
  const card = player.deck.shift()!;
  player.played.push(card);

  // Sync zones
  syncZones(G);

  // Check if we should move to resolve phase
  if (bothPlayersFlipped(G)) {
    G.phase = 'resolve';
  }

  return G;
}

/**
 * Place face-down cards for war.
 */
export function placeWarCards(
  G: WarState,
  ctx: Ctx,
  _playerId?: string
): WarState | typeof INVALID_MOVE {
  const playerId = _playerId ?? ctx.currentPlayer;
  const player = G.players[playerId];

  if (!player || !G.warInProgress) {
    return INVALID_MOVE;
  }

  // Reshuffle if needed
  reshuffleWonPile(player);

  // Place up to 3 face-down cards (or as many as available)
  const faceDownCount = Math.min(WAR_FACE_DOWN_COUNT, player.deck.length);

  for (let i = 0; i < faceDownCount; i++) {
    const card = player.deck.shift()!;
    player.played.push(card);
  }

  // Sync zones
  syncZones(G);

  return G;
}

/**
 * Resolve the current round by comparing played cards.
 */
export function resolveRound(G: WarState, ctx: Ctx): WarState | typeof INVALID_MOVE {
  // Both players must have played
  if (!bothPlayersFlipped(G)) {
    return INVALID_MOVE;
  }

  const playerIds = Object.keys(G.players);
  const [p1Id, p2Id] = playerIds;
  const p1 = G.players[p1Id];
  const p2 = G.players[p2Id];

  // Get the last (top) card from each player's played pile
  const p1Card = p1.played[p1.played.length - 1];
  const p2Card = p2.played[p2.played.length - 1];

  if (!p1Card || !p2Card) {
    return INVALID_MOVE;
  }

  const comparison = compareCards(p1Card, p2Card);

  // Collect all played cards
  const pot: WarCard[] = [...p1.played, ...p2.played];

  if (comparison === 0) {
    // War! Cards stay in played zone
    G.warInProgress = true;
    G.phase = 'flip';

    // Check if either player can continue the war
    reshuffleWonPile(p1);
    reshuffleWonPile(p2);

    if (p1.deck.length === 0 && p1.won.length === 0) {
      // Player 1 can't continue - player 2 wins
      G.winner = p2Id;
      G.phase = 'gameOver';
    } else if (p2.deck.length === 0 && p2.won.length === 0) {
      // Player 2 can't continue - player 1 wins
      G.winner = p1Id;
      G.phase = 'gameOver';
    }
  } else {
    // We have a winner
    const winnerId = comparison > 0 ? p1Id : p2Id;
    const winner = G.players[winnerId];

    // Winner takes all cards from the pot
    winner.won.push(...shuffleDeck(pot));

    // Clear played zones
    p1.played = [];
    p2.played = [];

    // Reset war state
    G.warInProgress = false;
    G.phase = 'flip';

    // Check for game over
    const gameWinner = checkGameOver(G);
    if (gameWinner) {
      G.winner = gameWinner;
      G.phase = 'gameOver';
    }
  }

  // Sync zones
  syncZones(G);

  return G;
}

// =============================================================================
// Card Schema
// =============================================================================

const warCardSchema: CardSchema<WarCard> = {
  validate: (card): card is WarCard => {
    return (
      typeof card === 'object' &&
      card !== null &&
      'id' in card &&
      'name' in card &&
      'suit' in card &&
      'rank' in card &&
      SUITS.includes((card as WarCard).suit) &&
      RANKS.includes((card as WarCard).rank)
    );
  },

  create: (data) => ({
    id: data.id,
    name: data.name,
    suit: (data as Partial<WarCard>).suit ?? 'hearts',
    rank: (data as Partial<WarCard>).rank ?? 'A',
  }),

  getAssetKey: (card) => `${card.suit}-${card.rank}`,
};

// =============================================================================
// Move Validation
// =============================================================================

export function validateMove(
  state: WarState,
  move: string,
  playerId: string
): MoveValidation {
  switch (move) {
    case 'flipCard': {
      const player = state.players[playerId];
      if (!player) {
        return { valid: false, error: 'Invalid player' };
      }
      if (state.phase !== 'flip') {
        return { valid: false, error: 'Not in flip phase' };
      }
      if (player.played.length > 0 && !state.warInProgress) {
        return { valid: false, error: 'Already flipped' };
      }
      if (player.deck.length === 0 && player.won.length === 0) {
        return { valid: false, error: 'No cards left' };
      }
      return { valid: true };
    }

    case 'resolveRound': {
      if (state.phase !== 'resolve') {
        return { valid: false, error: 'Not in resolve phase' };
      }
      if (!bothPlayersFlipped(state)) {
        return { valid: false, error: 'Both players must flip first' };
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: `Unknown move: ${move}` };
  }
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

/**
 * War game for boardgame.io.
 */
export const WarGame: Game<WarState> = {
  name: 'war',

  setup: (ctx): WarState => {
    return createInitialState({
      numPlayers: ctx.numPlayers ?? 2,
      playerIDs: ctx.playOrder ?? ['0', '1'],
    });
  },

  turn: {
    // In War, both players act simultaneously
    activePlayers: { all: 'play' },
  },

  phases: {
    play: {
      start: true,
      moves: {
        flipCard: {
          move: ({ G, ctx }, playerId?: string) => flipCard(G, ctx, playerId),
          client: false,
        },
        placeWarCards: {
          move: ({ G, ctx }, playerId?: string) => placeWarCards(G, ctx, playerId),
          client: false,
        },
        resolveRound: {
          move: ({ G, ctx }) => resolveRound(G, ctx),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.winner) {
      return { winner: G.winner };
    }
    return undefined;
  },
};

// =============================================================================
// Module Export
// =============================================================================

export const WarModule = {
  id: 'war',
  name: 'War',
  version: '1.0.0',
  description: 'Classic War card game - flip cards, higher wins',

  cardSchema: warCardSchema,
  zones: WAR_ZONES,

  assetRequirements: {
    required: ['card_face'] as const,
    optional: ['card_back'] as const,
    idFormat: 'standard_52' as const,
  },

  initialState: createInitialState,
  validateMove,
  getBoardgameIOGame: () => WarGame,

  zoneLayout: {
    zones: {
      deck: { x: 20, y: 50, width: 15, height: 20, cardArrangement: 'stack' as const },
      played: { x: 50, y: 50, width: 15, height: 20, cardArrangement: 'stack' as const },
      won: { x: 80, y: 50, width: 15, height: 20, cardArrangement: 'stack' as const },
    },
    defaultCardSize: { width: 63, height: 88 },
  },
};

export default WarModule;
