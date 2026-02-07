/**
 * One Piece TCG Game Module — boardgame.io Game Definition
 *
 * Rules-agnostic state manager with cooperative decryption.
 * This module does NOT enforce game rules — it manages game state
 * and ensures fair deck operations through cryptographic protocols.
 *
 * Phases:
 * - setup: Initial game setup
 * - keyExchange: Players exchange public keys for mental poker
 * - encrypt: Players encrypt the shared deck
 * - shuffle: Players shuffle the encrypted deck
 * - play: Main gameplay (players take turns, rules not enforced)
 * - gameOver: Game has ended
 * - voided: Unrecoverable failure
 */

import type { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type {
  OnePieceCard,
  OnePieceDonCard,
  OnePieceState,
  OnePiecePlayerState,
  OnePieceModuleConfig,
  AnyOnePieceCard,
  PlayAreaSlot,
} from './types';
import { DEFAULT_CONFIG } from './types';
import type { CardSchema, GameConfig, MoveValidation } from '../types';
import { ONEPIECE_ZONES } from './zones';
import { createPlayArea, attachDon, detachDon, placeCardInSlot, removeCardFromSlot } from './playArea';
import { transitionCardVisibility, initializeCardVisibility } from './visibility';
import { createPeekRequest, acknowledgePeekRequest, ownerDecryptPeek, reorderPeekedCards, completePeek } from './peek';
import { createProof, appendProof, verifyProofChain } from './proofChain';

// =============================================================================
// Card Creation Helpers
// =============================================================================

/**
 * Create DON!! cards for a player.
 */
export function createDonCards(count: number, playerId: string): OnePieceDonCard[] {
  const cards: OnePieceDonCard[] = [];
  for (let i = 0; i < count; i++) {
    cards.push({
      id: `don-${playerId}-${i}`,
      name: 'DON!!',
      cardType: 'don',
    });
  }
  return cards;
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
 *
 * Note: In a real game, players would provide their decks during setup.
 * This creates an empty state structure that can be populated.
 */
export function createInitialState(
  config: GameConfig,
  moduleConfig: OnePieceModuleConfig = DEFAULT_CONFIG,
): OnePieceState {
  const players: Record<string, OnePiecePlayerState> = {};
  const zones: Record<string, Record<string, AnyOnePieceCard[]>> = {
    mainDeck: {},
    lifeDeck: {},
    donDeck: {},
    trash: {},
    hand: {},
    playArea: {},
    donArea: {},
  };

  for (const playerId of config.playerIDs) {
    const donCards = createDonCards(moduleConfig.startingDon, playerId);

    players[playerId] = {
      mainDeck: [],
      lifeDeck: [],
      donDeck: donCards,
      trash: [],
      hand: [],
      donArea: [],
      playArea: createPlayArea(moduleConfig),
      activeDon: 0,
      totalDon: moduleConfig.startingDon,
    };

    zones.mainDeck[playerId] = [];
    zones.lifeDeck[playerId] = [];
    zones.donDeck[playerId] = donCards;
    zones.trash[playerId] = [];
    zones.hand[playerId] = [];
    zones.playArea[playerId] = [];
    zones.donArea[playerId] = [];
  }

  return {
    players,
    config: moduleConfig,
    phase: 'setup',
    winner: null,
    turnCount: 0,
    cardVisibility: {},
    activePeeks: [],
    proofChain: [],
    zones,
  };
}

/**
 * Sync zones from player state (for deck plugin compatibility).
 */
function syncZones(state: OnePieceState): void {
  for (const playerId of Object.keys(state.players)) {
    const p = state.players[playerId];
    state.zones.mainDeck[playerId] = p.mainDeck;
    state.zones.lifeDeck[playerId] = p.lifeDeck;
    state.zones.donDeck[playerId] = p.donDeck;
    state.zones.trash[playerId] = p.trash;
    state.zones.hand[playerId] = p.hand;
    state.zones.donArea[playerId] = p.donArea;
    // playArea cards are tracked via slots, not a flat array
  }
}

// =============================================================================
// Moves: Setup
// =============================================================================

/**
 * Load a player's deck into the game.
 * Called during setup phase. Each player submits their deck list.
 */
function loadDeck(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  cards: OnePieceCard[],
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  // Find the leader card
  const leaderIndex = cards.findIndex((c) => c.cardType === 'leader');
  if (leaderIndex === -1) return INVALID_MOVE;

  const leader = cards[leaderIndex];
  const mainDeckCards = cards.filter((_, i) => i !== leaderIndex);

  // Place leader in the leader slot
  const leaderSlot = player.playArea.find((s) => s.slotType === 'leader');
  if (!leaderSlot) return INVALID_MOVE;
  leaderSlot.cardId = leader.id;

  // Set up main deck
  player.mainDeck = shuffleDeck(mainDeckCards);

  // Set up life deck (top N cards from main deck)
  const lifeCards = player.mainDeck.splice(0, leader.life ?? G.config.startingLife);
  player.lifeDeck = lifeCards;

  // Initialize visibility for all cards
  const allCardIds = [
    leader.id,
    ...mainDeckCards.map((c) => c.id),
    ...player.donDeck.map((c) => c.id),
  ];
  initializeCardVisibility(G, allCardIds);

  // Leader is public
  G.cardVisibility[leader.id] = 'public';

  syncZones(G);
  return G;
}

// =============================================================================
// Moves: Gameplay
// =============================================================================

/**
 * Draw a card from main deck to hand.
 */
function drawCard(
  G: OnePieceState,
  ctx: Ctx,
  playerId?: string,
): OnePieceState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  const player = G.players[pid];
  if (!player || player.mainDeck.length === 0) return INVALID_MOVE;

  const card = player.mainDeck.shift()!;
  player.hand.push(card);

  // Transition visibility: encrypted → owner-known
  transitionCardVisibility(G, card.id, 'owner-known', pid, 'draw');

  syncZones(G);
  return G;
}

/**
 * Draw a DON!! card from DON!! deck to DON!! area.
 */
function drawDon(
  G: OnePieceState,
  ctx: Ctx,
  playerId?: string,
  count: number = 1,
): OnePieceState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  const player = G.players[pid];
  if (!player) return INVALID_MOVE;

  const actualCount = Math.min(count, player.donDeck.length);
  if (actualCount === 0) return INVALID_MOVE;

  for (let i = 0; i < actualCount; i++) {
    const don = player.donDeck.shift()!;
    player.donArea.push(don);
    player.activeDon++;
    G.cardVisibility[don.id] = 'public';
  }

  syncZones(G);
  return G;
}

/**
 * Play a card from hand to play area.
 */
function playCard(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
  slotPosition: number,
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const cardIndex = player.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) return INVALID_MOVE;

  const card = player.hand[cardIndex];

  // Check slot compatibility
  const slot = player.playArea.find((s) => s.position === slotPosition);
  if (!slot || slot.cardId !== null) return INVALID_MOVE;

  if (card.cardType === 'leader' && slot.slotType !== 'leader') return INVALID_MOVE;
  if (card.cardType === 'character' && slot.slotType !== 'character') return INVALID_MOVE;
  if (card.cardType === 'stage' && slot.slotType !== 'stage') return INVALID_MOVE;

  // Move card from hand to play area
  player.hand.splice(cardIndex, 1);
  placeCardInSlot(player.playArea, slotPosition, cardId);

  // Transition visibility: owner-known → public
  transitionCardVisibility(G, cardId, 'public', playerId, 'playCard');

  syncZones(G);
  return G;
}

/**
 * Play an event card (goes to trash after resolution).
 */
function playEvent(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const cardIndex = player.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) return INVALID_MOVE;

  const card = player.hand[cardIndex];
  if (card.cardType !== 'event') return INVALID_MOVE;

  // Move to trash
  player.hand.splice(cardIndex, 1);
  player.trash.push(card);

  // Transition to public (visible in trash)
  transitionCardVisibility(G, cardId, 'public', playerId, 'playEvent');

  syncZones(G);
  return G;
}

/**
 * Move a card from play area to trash.
 */
function trashFromPlay(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  slotPosition: number,
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const cardId = removeCardFromSlot(player.playArea, slotPosition);
  if (!cardId) return INVALID_MOVE;

  // Find the card in the zones
  // The card was in play area, we need its full data
  // Since we track cards by their zones, we need to locate it
  const allCards = [
    ...player.mainDeck,
    ...player.lifeDeck,
    ...player.hand,
    ...player.trash,
  ];

  // Card data might be stored separately — for now, create a reference
  const proof = createProof(
    'trashFromPlay',
    { cardId, slotPosition },
    G.proofChain.length > 0 ? G.proofChain[G.proofChain.length - 1].hash : null,
  );
  appendProof(G, proof);

  syncZones(G);
  return G;
}

/**
 * Attach DON!! to a slot in the play area.
 */
function attachDonToSlot(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  slotPosition: number,
  count: number,
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  // Must have enough active DON!! in the DON!! area
  if (player.donArea.length < count) return INVALID_MOVE;

  const success = attachDon(player.playArea, slotPosition, count);
  if (!success) return INVALID_MOVE;

  // Remove DON!! cards from area
  for (let i = 0; i < count; i++) {
    player.donArea.pop();
  }

  syncZones(G);
  return G;
}

/**
 * Detach DON!! from a slot back to DON!! area.
 */
function detachDonFromSlot(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  slotPosition: number,
  count: number,
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const detached = detachDon(player.playArea, slotPosition, count);
  if (detached === 0) return INVALID_MOVE;

  // Return DON!! cards to area
  for (let i = 0; i < detached; i++) {
    const donId = `don-${playerId}-return-${Date.now()}-${i}`;
    player.donArea.push({ id: donId, name: 'DON!!', cardType: 'don' });
  }

  syncZones(G);
  return G;
}

/**
 * Take life damage (reveal top card of life deck).
 */
function takeLifeDamage(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
): OnePieceState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player || player.lifeDeck.length === 0) return INVALID_MOVE;

  const card = player.lifeDeck.shift()!;
  player.hand.push(card);

  // Life card revealed then added to hand
  transitionCardVisibility(G, card.id, 'owner-known', playerId, 'lifeDamage');

  // Check for game over (0 life AND receiving damage)
  if (player.lifeDeck.length === 0) {
    // In One Piece TCG, you lose when you take damage with 0 life
    // This is tracked but the game module doesn't enforce it (rules-agnostic)
  }

  syncZones(G);
  return G;
}

// =============================================================================
// Moves: Peek Protocol
// =============================================================================

function requestPeek(
  G: OnePieceState,
  ctx: Ctx,
  playerId: string,
  deckZone: 'mainDeck' | 'lifeDeck',
  count: number,
): OnePieceState | typeof INVALID_MOVE {
  const result = createPeekRequest(G, playerId, deckZone, count);
  if (!result) return INVALID_MOVE;
  return G;
}

function ackPeek(
  G: OnePieceState,
  ctx: Ctx,
  requestId: string,
  decryptionShare: string,
  signature: string,
): OnePieceState | typeof INVALID_MOVE {
  const result = acknowledgePeekRequest(G, requestId, decryptionShare, signature);
  if (!result) return INVALID_MOVE;
  return G;
}

function decryptPeek(
  G: OnePieceState,
  ctx: Ctx,
  requestId: string,
): OnePieceState | typeof INVALID_MOVE {
  const result = ownerDecryptPeek(G, requestId);
  if (!result) return INVALID_MOVE;
  return G;
}

function reorderPeek(
  G: OnePieceState,
  ctx: Ctx,
  requestId: string,
  newPositions: number[],
  signature: string,
): OnePieceState | typeof INVALID_MOVE {
  const result = reorderPeekedCards(G, requestId, newPositions, signature);
  if (!result) return INVALID_MOVE;
  return G;
}

function finishPeek(
  G: OnePieceState,
  ctx: Ctx,
  requestId: string,
): OnePieceState | typeof INVALID_MOVE {
  const success = completePeek(G, requestId);
  if (!success) return INVALID_MOVE;
  return G;
}

// =============================================================================
// Moves: Game Control
// =============================================================================

function declareWinner(
  G: OnePieceState,
  ctx: Ctx,
  winnerId: string,
): OnePieceState | typeof INVALID_MOVE {
  if (!G.players[winnerId]) return INVALID_MOVE;
  G.winner = winnerId;
  G.phase = 'gameOver';
  return G;
}

function surrender(
  G: OnePieceState,
  ctx: Ctx,
  playerId?: string,
): OnePieceState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (!G.players[pid]) return INVALID_MOVE;

  // The other player wins
  const otherPlayer = Object.keys(G.players).find((id) => id !== pid);
  if (otherPlayer) {
    G.winner = otherPlayer;
  }
  G.phase = 'gameOver';
  return G;
}

// =============================================================================
// Card Schema
// =============================================================================

export const onePieceCardSchema: CardSchema<OnePieceCard> = {
  validate: (card): card is OnePieceCard => {
    return (
      typeof card === 'object' &&
      card !== null &&
      'id' in card &&
      'name' in card &&
      'cardType' in card &&
      'color' in card &&
      'set' in card &&
      'cardNumber' in card &&
      'rarity' in card &&
      ['character', 'leader', 'event', 'stage'].includes(
        (card as OnePieceCard).cardType,
      )
    );
  },

  create: (data) => ({
    id: data.id,
    name: data.name,
    cardType: (data as Partial<OnePieceCard>).cardType ?? 'character',
    cost: (data as Partial<OnePieceCard>).cost,
    power: (data as Partial<OnePieceCard>).power,
    counter: (data as Partial<OnePieceCard>).counter,
    color: (data as Partial<OnePieceCard>).color ?? ['red'],
    attributes: (data as Partial<OnePieceCard>).attributes,
    trigger: (data as Partial<OnePieceCard>).trigger,
    effectText: (data as Partial<OnePieceCard>).effectText,
    set: (data as Partial<OnePieceCard>).set ?? 'OP01',
    cardNumber: (data as Partial<OnePieceCard>).cardNumber ?? '001',
    rarity: (data as Partial<OnePieceCard>).rarity ?? 'C',
    life: (data as Partial<OnePieceCard>).life,
  }),

  getAssetKey: (card) => `${card.set}-${card.cardNumber}`,
};

// =============================================================================
// Move Validation
// =============================================================================

export function validateMove(
  state: OnePieceState,
  move: string,
  playerId: string,
): MoveValidation {
  const player = state.players[playerId];
  if (!player) {
    return { valid: false, error: 'Invalid player' };
  }

  switch (move) {
    case 'drawCard':
      if (player.mainDeck.length === 0) {
        return { valid: false, error: 'Main deck is empty' };
      }
      return { valid: true };

    case 'drawDon':
      if (player.donDeck.length === 0) {
        return { valid: false, error: 'DON!! deck is empty' };
      }
      return { valid: true };

    case 'playCard':
      if (player.hand.length === 0) {
        return { valid: false, error: 'No cards in hand' };
      }
      return { valid: true };

    case 'surrender':
      return { valid: true };

    default:
      return { valid: true };
  }
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

export const OnePieceGame: Game<OnePieceState> = {
  name: 'onepiece',

  setup: (ctx): OnePieceState => {
    return createInitialState({
      numPlayers: ctx.numPlayers ?? 2,
      playerIDs: ctx.playOrder ?? ['0', '1'],
    });
  },

  turn: {
    activePlayers: { all: 'play' },
  },

  phases: {
    play: {
      start: true,
      moves: {
        loadDeck: {
          move: ({ G, ctx }, playerId: string, cards: OnePieceCard[]) =>
            loadDeck(G, ctx, playerId, cards),
          client: false,
        },
        drawCard: {
          move: ({ G, ctx }, playerId?: string) => drawCard(G, ctx, playerId),
          client: false,
        },
        drawDon: {
          move: ({ G, ctx }, playerId?: string, count?: number) =>
            drawDon(G, ctx, playerId, count),
          client: false,
        },
        playCard: {
          move: ({ G, ctx }, playerId: string, cardId: string, slotPosition: number) =>
            playCard(G, ctx, playerId, cardId, slotPosition),
          client: false,
        },
        playEvent: {
          move: ({ G, ctx }, playerId: string, cardId: string) =>
            playEvent(G, ctx, playerId, cardId),
          client: false,
        },
        trashFromPlay: {
          move: ({ G, ctx }, playerId: string, slotPosition: number) =>
            trashFromPlay(G, ctx, playerId, slotPosition),
          client: false,
        },
        attachDon: {
          move: ({ G, ctx }, playerId: string, slotPosition: number, count: number) =>
            attachDonToSlot(G, ctx, playerId, slotPosition, count),
          client: false,
        },
        detachDon: {
          move: ({ G, ctx }, playerId: string, slotPosition: number, count: number) =>
            detachDonFromSlot(G, ctx, playerId, slotPosition, count),
          client: false,
        },
        takeLifeDamage: {
          move: ({ G, ctx }, playerId: string) =>
            takeLifeDamage(G, ctx, playerId),
          client: false,
        },
        requestPeek: {
          move: ({ G, ctx }, playerId: string, deckZone: 'mainDeck' | 'lifeDeck', count: number) =>
            requestPeek(G, ctx, playerId, deckZone, count),
          client: false,
        },
        ackPeek: {
          move: ({ G, ctx }, requestId: string, decryptionShare: string, signature: string) =>
            ackPeek(G, ctx, requestId, decryptionShare, signature),
          client: false,
        },
        decryptPeek: {
          move: ({ G, ctx }, requestId: string) =>
            decryptPeek(G, ctx, requestId),
          client: false,
        },
        reorderPeek: {
          move: ({ G, ctx }, requestId: string, newPositions: number[], signature: string) =>
            reorderPeek(G, ctx, requestId, newPositions, signature),
          client: false,
        },
        finishPeek: {
          move: ({ G, ctx }, requestId: string) =>
            finishPeek(G, ctx, requestId),
          client: false,
        },
        declareWinner: {
          move: ({ G, ctx }, winnerId: string) =>
            declareWinner(G, ctx, winnerId),
          client: false,
        },
        surrender: {
          move: ({ G, ctx }, playerId?: string) =>
            surrender(G, ctx, playerId),
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

export const OnePieceModule = {
  id: 'onepiece',
  name: 'One Piece TCG',
  version: '1.0.0',
  description: 'One Piece Trading Card Game — rules-agnostic state manager with cooperative decryption',

  cardSchema: onePieceCardSchema,
  zones: ONEPIECE_ZONES,

  assetRequirements: {
    required: ['card_face'] as const,
    optional: ['card_back', 'playmat'] as const,
    idFormat: 'set_collector' as const,
  },

  initialState: createInitialState,
  validateMove,
  getBoardgameIOGame: () => OnePieceGame,

  zoneLayout: {
    zones: {
      mainDeck: { x: 85, y: 70, width: 10, height: 15, cardArrangement: 'stack' as const },
      lifeDeck: { x: 85, y: 30, width: 10, height: 15, cardArrangement: 'stack' as const },
      donDeck: { x: 5, y: 70, width: 10, height: 15, cardArrangement: 'stack' as const },
      trash: { x: 85, y: 50, width: 10, height: 15, cardArrangement: 'stack' as const },
      hand: { x: 25, y: 85, width: 50, height: 12, cardArrangement: 'fan' as const },
      playArea: { x: 25, y: 45, width: 60, height: 25, cardArrangement: 'row' as const },
      donArea: { x: 5, y: 50, width: 15, height: 15, cardArrangement: 'row' as const },
    },
    defaultCardSize: { width: 63, height: 88 },
  },
};

export default OnePieceModule;
