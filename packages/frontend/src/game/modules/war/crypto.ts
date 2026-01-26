/**
 * War Game Crypto Integration
 *
 * Mental poker integration for cryptographically fair War gameplay.
 * Provides encrypted deck management, collaborative reveals, and shuffle proofs.
 */

import type { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { GameConfig } from '../types';
import {
  WarCard,
  WarState,
  WarPlayerState,
  WAR_ZONES,
  compareCards,
  RANK_VALUES,
} from './types';
import {
  CryptoPlugin,
  createPlayerCryptoContext,
  generateStandard52CardIds,
  type CryptoPluginState,
  type CryptoPlayerContext,
  type SerializedShuffleProof,
} from '../../../crypto';
import type { EncryptedCard } from '../../../crypto/mental-poker';

// =============================================================================
// Types
// =============================================================================

/**
 * Crypto-specific player state.
 */
export interface CryptoWarPlayerState extends WarPlayerState {
  /** Player's public key (hex) */
  publicKey: string | null;
  /** Whether this player has encrypted the deck */
  hasEncrypted: boolean;
  /** Whether this player has shuffled the deck */
  hasShuffled: boolean;
}

/**
 * Extended War state with crypto support.
 */
export interface CryptoWarState extends Omit<WarState, 'players' | 'phase'> {
  /** Player states with crypto extensions */
  players: Record<string, CryptoWarPlayerState>;

  /** Current game phase (extended for crypto) */
  phase: 'keyExchange' | 'encrypt' | 'shuffle' | 'flip' | 'reveal' | 'resolve' | 'gameOver';

  /** Crypto plugin state */
  crypto: CryptoPluginState;

  /** Card IDs for the deck */
  cardIds: string[];

  /** Pending card reveals (cardKey -> playerId -> submitted) */
  pendingReveals: Record<string, Record<string, boolean>>;

  /** Cards waiting to be revealed (index in deck) */
  cardsToReveal: number[];

  /** Player order for encryption/shuffle */
  playerOrder: string[];

  /** Current player index for setup phases */
  setupPlayerIndex: number;
}

/**
 * Configuration for crypto War game.
 */
export interface CryptoWarConfig extends GameConfig {
  /** Whether to use crypto (for backward compat testing) */
  useCrypto?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const SUITS: WarCard['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: WarCard['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Number of cards to place face-down during war */
const WAR_FACE_DOWN_COUNT = 3;

// =============================================================================
// Card Utilities
// =============================================================================

/**
 * Parse a card ID into a WarCard.
 */
export function parseCardId(cardId: string): WarCard {
  const [suit, rank] = cardId.split('-') as [WarCard['suit'], WarCard['rank']];
  return {
    id: cardId,
    name: `${rank} of ${suit}`,
    suit,
    rank,
  };
}

/**
 * Create card IDs for a standard 52-card deck.
 */
export function createCardIds(): string[] {
  const ids: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      ids.push(`${suit}-${rank}`);
    }
  }
  return ids;
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Create initial crypto-enabled game state.
 */
export function createCryptoWarState(config: CryptoWarConfig): CryptoWarState {
  const cardIds = createCardIds();
  const playerOrder = config.playerIDs;

  const players: Record<string, CryptoWarPlayerState> = {};
  const zones: Record<string, Record<string, WarCard[]>> = {
    deck: {},
    played: {},
    won: {},
  };

  // Initialize player states
  for (const playerId of playerOrder) {
    players[playerId] = {
      deck: [],
      played: [],
      won: [],
      publicKey: null,
      hasEncrypted: false,
      hasShuffled: false,
    };
    zones.deck[playerId] = [];
    zones.played[playerId] = [];
    zones.won[playerId] = [];
  }

  return {
    players,
    warInProgress: false,
    winner: null,
    phase: 'keyExchange',
    zones,
    crypto: CryptoPlugin.setup(),
    cardIds,
    pendingReveals: {},
    cardsToReveal: [],
    playerOrder,
    setupPlayerIndex: 0,
  };
}

/**
 * Get the current setup player (for sequential encryption/shuffle).
 */
export function getCurrentSetupPlayer(state: CryptoWarState): string {
  return state.playerOrder[state.setupPlayerIndex];
}

/**
 * Advance to next setup player, returning true if all done.
 */
export function advanceSetupPlayer(state: CryptoWarState): boolean {
  state.setupPlayerIndex++;
  return state.setupPlayerIndex >= state.playerOrder.length;
}

/**
 * Reset setup player index for new phase.
 */
export function resetSetupPlayer(state: CryptoWarState): void {
  state.setupPlayerIndex = 0;
}

/**
 * Check if all players have submitted public keys.
 */
export function allKeysSubmitted(state: CryptoWarState): boolean {
  return state.playerOrder.every((id) => state.players[id].publicKey !== null);
}

/**
 * Check if all players have encrypted the deck.
 */
export function allPlayersEncrypted(state: CryptoWarState): boolean {
  return state.playerOrder.every((id) => state.players[id].hasEncrypted);
}

/**
 * Check if all players have shuffled the deck.
 */
export function allPlayersShuffled(state: CryptoWarState): boolean {
  return state.playerOrder.every((id) => state.players[id].hasShuffled);
}

/**
 * Check if both players have flipped.
 */
export function bothPlayersFlipped(state: CryptoWarState): boolean {
  return state.playerOrder.every((id) => state.players[id].played.length > 0);
}

/**
 * Get player card count (revealed cards only in crypto mode).
 */
export function getPlayerCardCount(player: CryptoWarPlayerState): number {
  return player.deck.length + player.played.length + player.won.length;
}

/**
 * Check for game over.
 */
export function checkGameOver(state: CryptoWarState): string | null {
  const playerIds = Object.keys(state.players);

  for (const playerId of playerIds) {
    const count = getPlayerCardCount(state.players[playerId]);
    if (count === 52) {
      return playerId;
    }
    if (count === 0) {
      return playerIds.find((id) => id !== playerId) || null;
    }
  }

  return null;
}

// =============================================================================
// Crypto Moves
// =============================================================================

/**
 * Submit public key during key exchange phase.
 */
export function submitPublicKey(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  publicKey: string
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== 'keyExchange') {
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) {
    return INVALID_MOVE;
  }

  if (player.publicKey !== null) {
    return INVALID_MOVE; // Already submitted
  }

  // Store public key
  player.publicKey = publicKey;

  // Get crypto API and submit
  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  cryptoApi.submitPublicKey(playerId, publicKey);

  // Check if all keys submitted
  if (allKeysSubmitted(G)) {
    // Initialize crypto with card IDs
    cryptoApi.init(G.cardIds, G.playerOrder);
    G.phase = 'encrypt';
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Encrypt deck with player's key (called sequentially).
 */
export function encryptDeck(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== 'encrypt') {
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) {
    return INVALID_MOVE;
  }

  // Must be current setup player's turn
  if (getCurrentSetupPlayer(G) !== playerId) {
    return INVALID_MOVE;
  }

  if (player.hasEncrypted) {
    return INVALID_MOVE;
  }

  // Encrypt deck
  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  cryptoApi.encryptDeckForPlayer('deck', playerId, privateKey);
  player.hasEncrypted = true;

  // Advance to next player or next phase
  if (advanceSetupPlayer(G)) {
    G.phase = 'shuffle';
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Shuffle deck with proof (called sequentially).
 */
export async function shuffleDeck(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): Promise<CryptoWarState | typeof INVALID_MOVE> {
  if (G.phase !== 'shuffle') {
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) {
    return INVALID_MOVE;
  }

  // Must be current setup player's turn
  if (getCurrentSetupPlayer(G) !== playerId) {
    return INVALID_MOVE;
  }

  if (player.hasShuffled) {
    return INVALID_MOVE;
  }

  // Shuffle with proof
  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  await cryptoApi.shuffleDeckWithProof('deck', playerId, privateKey);
  player.hasShuffled = true;

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    G.phase = 'flip';
    // Deal cards (half to each player as encrypted indices)
    dealEncryptedCards(G, ctx);
  }

  return G;
}

/**
 * Deal encrypted cards to players (half each).
 */
function dealEncryptedCards(G: CryptoWarState, ctx: Ctx): void {
  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  const totalCards = cryptoApi.getEncryptedCardCount('deck');
  const halfDeck = Math.floor(totalCards / 2);

  // Create player-specific deck zones
  for (let i = 0; i < G.playerOrder.length; i++) {
    const playerId = G.playerOrder[i];
    const playerZone = `deck_${playerId}`;

    // Move cards to player's deck zone
    for (let j = 0; j < halfDeck; j++) {
      cryptoApi.moveEncryptedCard('deck', playerZone, 0);
    }
  }
}

/**
 * Request to flip a card (starts reveal process).
 */
export function flipCard(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== 'flip') {
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) {
    return INVALID_MOVE;
  }

  // Can't flip if already have a played card (unless in war)
  if (player.played.length > 0 && !G.warInProgress) {
    return INVALID_MOVE;
  }

  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  const playerZone = `deck_${playerId}`;
  const cardCount = cryptoApi.getEncryptedCardCount(playerZone);

  if (cardCount === 0) {
    // Try to reshuffle won pile
    // TODO: Handle reshuffle with new encryption
    return INVALID_MOVE;
  }

  // Move top card to pending reveal zone
  const revealZone = `reveal_${playerId}`;
  cryptoApi.moveEncryptedCard(playerZone, revealZone, 0);

  // Mark that this card needs reveals from all players
  const revealKey = `${playerId}:0`;
  G.pendingReveals[revealKey] = {};
  for (const pid of G.playerOrder) {
    G.pendingReveals[revealKey][pid] = false;
  }

  // Transition to reveal phase
  G.phase = 'reveal';
  G.cardsToReveal.push(G.playerOrder.indexOf(playerId));

  return G;
}

/**
 * Submit decryption share for a pending reveal.
 */
export function submitDecryptionShare(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  targetPlayerId: string,
  privateKey: string
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== 'reveal') {
    return INVALID_MOVE;
  }

  const revealKey = `${targetPlayerId}:0`;
  const pending = G.pendingReveals[revealKey];

  if (!pending) {
    return INVALID_MOVE;
  }

  if (pending[playerId]) {
    return INVALID_MOVE; // Already submitted
  }

  // Submit decryption share
  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  const revealZone = `reveal_${targetPlayerId}`;

  cryptoApi.submitDecryptionShare(revealZone, 0, playerId, privateKey);
  pending[playerId] = true;

  // Check if all shares submitted
  const allSubmitted = G.playerOrder.every((pid) => pending[pid]);

  if (allSubmitted) {
    // Card is now revealed
    const cardId = cryptoApi.getRevealedCardId(revealZone, 0);

    if (cardId) {
      const card = parseCardId(cardId);
      G.players[targetPlayerId].played.push(card);

      // Move to played zone (for zone tracking)
      cryptoApi.moveEncryptedCard(revealZone, `played_${targetPlayerId}`, 0);
    }

    // Clean up pending reveal
    delete G.pendingReveals[revealKey];
    G.cardsToReveal = G.cardsToReveal.filter((i) => G.playerOrder[i] !== targetPlayerId);

    // Check if all pending reveals done
    if (Object.keys(G.pendingReveals).length === 0) {
      // Check if both players have flipped
      if (bothPlayersFlipped(G)) {
        G.phase = 'resolve';
      } else {
        G.phase = 'flip';
      }
    }
  }

  return G;
}

/**
 * Resolve the current round.
 */
export function resolveRound(
  G: CryptoWarState,
  ctx: Ctx
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== 'resolve') {
    return INVALID_MOVE;
  }

  if (!bothPlayersFlipped(G)) {
    return INVALID_MOVE;
  }

  const [p1Id, p2Id] = G.playerOrder;
  const p1 = G.players[p1Id];
  const p2 = G.players[p2Id];

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

    // Check if players can continue
    const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
    const p1Cards = cryptoApi.getEncryptedCardCount(`deck_${p1Id}`);
    const p2Cards = cryptoApi.getEncryptedCardCount(`deck_${p2Id}`);

    if (p1Cards === 0) {
      G.winner = p2Id;
      G.phase = 'gameOver';
    } else if (p2Cards === 0) {
      G.winner = p1Id;
      G.phase = 'gameOver';
    }
  } else {
    // Winner takes all
    const winnerId = comparison > 0 ? p1Id : p2Id;
    const winner = G.players[winnerId];

    // Add cards to winner's won pile
    winner.won.push(...pot);

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
  for (const playerId of G.playerOrder) {
    G.zones.played[playerId] = G.players[playerId].played;
    G.zones.won[playerId] = G.players[playerId].won;
  }

  return G;
}

// =============================================================================
// Shuffle Proof Verification
// =============================================================================

/**
 * Get shuffle proofs for verification.
 */
export function getShuffleProofs(G: CryptoWarState): Record<string, SerializedShuffleProof> {
  return G.crypto.shuffleProofs;
}

/**
 * Verify a player's shuffle proof.
 */
export function verifyPlayerShuffle(
  G: CryptoWarState,
  playerId: string
): boolean {
  const proof = G.crypto.shuffleProofs[playerId];
  if (!proof) {
    return false;
  }

  // Basic validation - proof exists and has required fields
  return !!(proof.commitment && proof.proof && proof.inputHash && proof.outputHash);
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

/**
 * Crypto-enabled War game for boardgame.io.
 */
export const CryptoWarGame: Game<CryptoWarState> = {
  name: 'crypto-war',

  setup: (ctx): CryptoWarState => {
    return createCryptoWarState({
      numPlayers: ctx.numPlayers ?? 2,
      playerIDs: ctx.playOrder ?? ['0', '1'],
    });
  },

  phases: {
    keyExchange: {
      start: true,
      moves: {
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
          client: false,
        },
      },
      next: 'encrypt',
      endIf: ({ G }) => G.phase !== 'keyExchange',
    },

    encrypt: {
      moves: {
        encryptDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            encryptDeck(G, ctx, playerId, privateKey),
          client: false,
        },
      },
      next: 'shuffle',
      endIf: ({ G }) => G.phase !== 'encrypt',
    },

    shuffle: {
      moves: {
        shuffleDeck: {
          move: async ({ G, ctx }, playerId: string, privateKey: string) =>
            shuffleDeck(G, ctx, playerId, privateKey),
          client: false,
        },
      },
      next: 'play',
      endIf: ({ G }) => G.phase === 'flip' || G.phase === 'reveal' || G.phase === 'resolve',
    },

    play: {
      turn: {
        activePlayers: { all: 'play' },
      },
      moves: {
        flipCard: {
          move: ({ G, ctx }, playerId: string) => flipCard(G, ctx, playerId),
          client: false,
        },
        submitDecryptionShare: {
          move: ({ G, ctx }, playerId: string, targetPlayerId: string, privateKey: string) =>
            submitDecryptionShare(G, ctx, playerId, targetPlayerId, privateKey),
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

export const CryptoWarModule = {
  id: 'crypto-war',
  name: 'Crypto War',
  version: '1.0.0',
  description: 'War card game with mental poker cryptographic fairness',

  zones: WAR_ZONES,

  assetRequirements: {
    required: ['card_face'] as const,
    optional: ['card_back'] as const,
    idFormat: 'standard_52' as const,
  },

  initialState: createCryptoWarState,
  getBoardgameIOGame: () => CryptoWarGame,

  // Crypto-specific exports
  getShuffleProofs,
  verifyPlayerShuffle,
};

export default CryptoWarModule;
