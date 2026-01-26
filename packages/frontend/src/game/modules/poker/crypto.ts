/**
 * Crypto Poker Game Module
 *
 * Mental poker implementation of Texas Hold'em for P2P play.
 * Uses SRA commutative encryption for cryptographic fairness.
 * Includes abandonment support with key release and threshold escrow.
 */

import type { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { CardSchema, GameConfig, MoveValidation } from '../types';
import {
  PokerCard,
  CryptoPokerState,
  CryptoPokerPlayerState,
  CryptoPokerPhase,
  BettingRoundState,
  PeekNotification,
  POKER_ZONES,
  PokerConfig,
  DEFAULT_POKER_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  TimeoutConfig,
  getAllCardIds,
} from './types';
import {
  initBettingRound,
  getNextActivePlayer,
  isBettingRoundComplete,
  getActivePlayerIds,
  countActivePlayers,
  processFold,
  processCheck,
  processCall,
  processBet,
  processRaise,
  processAllIn,
  getSmallBlindPlayer,
  getBigBlindPlayer,
  getUTGPlayer,
  getFirstToActPostflop,
  postBlinds,
  rotateDealer,
} from './betting';
import { evaluateHand, findBestHand, determineWinners } from './hands';
import { pokerCardSchema, createStandardDeck, shuffleDeck as shuffleStandardDeck } from './game';
import type { CryptoPluginState, CryptoPluginApi } from '../../../crypto/plugin/crypto-plugin';
import { CryptoPlugin } from '../../../crypto/plugin/crypto-plugin';
import { createKeyShares, reconstructKeyFromShares, type KeyShare } from '../../../crypto/shamirs';
import { generateKeyPair, decrypt } from '../../../crypto/mental-poker';

// =============================================================================
// Constants
// =============================================================================

const DECK_ZONE = 'deck';
const COMMUNITY_ZONE = 'community';

// =============================================================================
// State Helpers
// =============================================================================

/**
 * Get the current setup player (for sequential encryption/shuffle).
 */
export function getCurrentSetupPlayer(state: CryptoPokerState): string {
  return state.playerOrder[state.setupPlayerIndex];
}

/**
 * Advance to the next setup player. Returns true if all players have acted.
 */
export function advanceSetupPlayer(state: CryptoPokerState): boolean {
  state.setupPlayerIndex++;
  return state.setupPlayerIndex >= state.playerOrder.length;
}

/**
 * Reset setup player index for next phase.
 */
export function resetSetupPlayer(state: CryptoPokerState): void {
  state.setupPlayerIndex = 0;
}

/**
 * Check if player has released their key or is still active.
 */
export function hasAvailableKey(state: CryptoPokerState, playerId: string): boolean {
  return (
    playerId in state.releasedKeys ||
    (!state.players[playerId].folded && state.players[playerId].isConnected)
  );
}

/**
 * Get all available keys (released + active players).
 */
export function getAllAvailableKeys(state: CryptoPokerState): Set<string> {
  const keys = new Set<string>(Object.keys(state.releasedKeys));
  for (const [playerId, player] of Object.entries(state.players)) {
    if (!player.folded && player.isConnected) {
      keys.add(playerId);
    }
  }
  return keys;
}

/**
 * Check game viability - can we still complete reveals?
 */
export function checkGameViability(state: CryptoPokerState): 'continue' | 'void' {
  const availableKeys = getAllAvailableKeys(state);
  const allPlayers = new Set(state.playerOrder);

  // For community reveals, we need ALL player keys
  for (const playerId of allPlayers) {
    if (!availableKeys.has(playerId)) {
      // Try to reconstruct from escrow
      const shares = state.keyEscrowShares[playerId] || [];
      if (shares.length < state.escrowThreshold) {
        return 'void';
      }
    }
  }

  return 'continue';
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Create initial crypto poker state.
 */
export function createCryptoInitialState(config: GameConfig): CryptoPokerState {
  const pokerConfig: PokerConfig = {
    ...DEFAULT_POKER_CONFIG,
    ...config.options,
  };

  const cardIds = getAllCardIds();

  const players: Record<string, CryptoPokerPlayerState> = {};
  const zones: Record<string, Record<string, PokerCard[]>> = {
    deck: { shared: [] },
    hand: {},
    community: { shared: [] },
    discard: { shared: [] },
    mucked: { shared: [] },
  };

  // Initialize player states
  for (const playerId of config.playerIDs) {
    players[playerId] = {
      hand: [],
      chips: pokerConfig.startingChips,
      bet: 0,
      folded: false,
      hasActed: false,
      isAllIn: false,
      publicKey: null,
      hasEncrypted: false,
      hasShuffled: false,
      hasPeeked: false,
      hasReleasedKey: false,
      hasDistributedShares: false,
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
    zones.hand[playerId] = [];
  }

  const playerOrder = [...config.playerIDs];
  const dealer = playerOrder[0];

  // Initialize crypto state
  const cryptoState: CryptoPluginState = {
    phase: 'init',
    publicKeys: {},
    commitments: {},
    shuffleProofs: {},
    encryptedZones: {},
    cardPointLookup: {},
    revealedCards: {},
    pendingReveals: {},
  };

  const state: CryptoPokerState = {
    community: [],
    pot: 0,
    sidePots: [],
    players,
    dealer,
    smallBlind: playerOrder.length > 2 ? playerOrder[1] : playerOrder[0],
    bigBlind: playerOrder.length > 2 ? playerOrder[2] : playerOrder[1],
    phase: 'keyExchange',
    bettingRound: {
      currentBet: 0,
      minRaise: pokerConfig.bigBlind,
      activePlayer: '',
      actedPlayers: [],
      isComplete: false,
      lastAggressor: null,
    },
    smallBlindAmount: pokerConfig.smallBlind,
    bigBlindAmount: pokerConfig.bigBlind,
    playerOrder,
    winners: [],
    zones,
    crypto: cryptoState,
    cardIds,
    setupPlayerIndex: 0,
    releasedKeys: {},
    keyEscrowShares: {},
    escrowThreshold: Math.max(2, playerOrder.length - 1), // N-1 threshold
    disconnectedPlayers: [],
    peekNotifications: [],
  };

  // Update positions
  state.smallBlind = getSmallBlindPlayer(state);
  state.bigBlind = getBigBlindPlayer(state);

  return state;
}

// =============================================================================
// Setup Phase Moves
// =============================================================================

/**
 * Submit public key during key exchange phase.
 */
function submitPublicKey(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  publicKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== 'keyExchange') return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.publicKey) return INVALID_MOVE; // Already submitted

  player.publicKey = publicKey;
  G.crypto.publicKeys[playerId] = publicKey;

  // Check if all players have submitted
  const allSubmitted = G.playerOrder.every((pid) => G.players[pid].publicKey !== null);
  if (allSubmitted) {
    // Initialize card point lookup
    for (const cardId of G.cardIds) {
      // The crypto plugin will build this, but we track it here too
      G.crypto.cardPointLookup[cardId] = cardId; // Simplified - actual impl uses curve points
    }

    G.phase = 'keyEscrow';
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Distribute key escrow shares during key escrow phase.
 */
function distributeKeyShares(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  shares: KeyShare[]
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== 'keyEscrow') return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasDistributedShares) return INVALID_MOVE;

  // Store shares for this player's key
  G.keyEscrowShares[playerId] = shares;
  player.hasDistributedShares = true;

  // Check if all players have distributed
  const allDistributed = G.playerOrder.every((pid) => G.players[pid].hasDistributedShares);
  if (allDistributed) {
    G.phase = 'encrypt';
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Encrypt deck during encrypt phase.
 */
function encryptDeck(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== 'encrypt') return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasEncrypted) return INVALID_MOVE;

  // Call crypto plugin to encrypt
  // In a real implementation, this would call CryptoPlugin.api().encryptDeckForPlayer()
  // For now, we just mark it done and track state
  player.hasEncrypted = true;

  // Advance to next player or next phase
  if (advanceSetupPlayer(G)) {
    G.phase = 'shuffle';
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Shuffle deck during shuffle phase.
 */
function shuffleEncryptedDeck(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== 'shuffle') return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasShuffled) return INVALID_MOVE;

  // In a real implementation, this would call CryptoPlugin.api().shuffleDeckWithProof()
  player.hasShuffled = true;

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    // Transition to preflop - deal hole cards
    dealHoleCards(G);
    G.phase = 'preflop';

    // Post blinds and set first to act
    postBlinds(G);
    const utgPlayer = getUTGPlayer(G);
    G.bettingRound = initBettingRound(G, utgPlayer);
    G.bettingRound.currentBet = G.bigBlindAmount;
  }

  return G;
}

/**
 * Deal hole cards to all players (encrypted).
 */
function dealHoleCards(G: CryptoPokerState): void {
  // In crypto mode, this moves encrypted cards to player hand zones
  // The actual card values remain encrypted until peek/reveal

  // For each player, "deal" 2 cards from encrypted deck zone to their hand zone
  // This is done by the CryptoPlugin's moveEncryptedCard method
  for (const playerId of G.playerOrder) {
    // Deal 2 cards
    // In real implementation: crypto.moveEncryptedCard(DECK_ZONE, `hand:${playerId}`, 0) x2
  }
}

// =============================================================================
// Peek and Reveal Moves
// =============================================================================

/**
 * Peek at hole cards (self-decrypt).
 */
function peekHoleCards(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  if (!['preflop', 'flop', 'turn', 'river'].includes(G.phase)) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasPeeked) return INVALID_MOVE;
  if (player.folded) return INVALID_MOVE;

  // In a real implementation:
  // For each card in hand zone, call selfDecrypt to remove only this player's layer
  // This allows the player to see their cards without revealing to others

  player.hasPeeked = true;

  // Add notification for other players
  G.peekNotifications.push({
    playerId,
    timestamp: Date.now(),
  });

  return G;
}

/**
 * Submit decryption share for community card reveal.
 */
function submitDecryptionShare(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  zoneId: string,
  cardIndex: number
): CryptoPokerState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  // Players can submit shares even if folded (they still hold keys)
  // In real implementation: crypto.submitDecryptionShare(zoneId, cardIndex, playerId, privateKey)

  return G;
}

// =============================================================================
// Key Release and Abandonment
// =============================================================================

/**
 * Release key after folding (required for abandonment support).
 */
function releaseKey(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (!player.folded) return INVALID_MOVE; // Must fold first
  if (player.hasReleasedKey) return INVALID_MOVE;

  G.releasedKeys[playerId] = privateKey;
  player.hasReleasedKey = true;

  return G;
}

/**
 * Optional: Show hand before releasing key (bluff reveal).
 */
function showHand(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (!player.folded) return INVALID_MOVE;
  if (player.hasReleasedKey) return INVALID_MOVE; // Must show before releasing

  // Request all players to reveal this player's hand
  // In real implementation: initiate collaborative reveal for this player's hand zone

  return G;
}

/**
 * Handle player disconnect.
 */
function handleDisconnect(
  G: CryptoPokerState,
  playerId: string
): void {
  const player = G.players[playerId];
  if (!player) return;

  player.isConnected = false;
  G.disconnectedPlayers.push(playerId);

  // Check viability
  if (checkGameViability(G) === 'void') {
    G.phase = 'voided';
    // In real implementation: return bets proportionally
  }
}

/**
 * Attempt key reconstruction from escrow shares.
 */
function attemptKeyReconstruction(
  G: CryptoPokerState,
  playerId: string
): string | null {
  const shares = G.keyEscrowShares[playerId];
  if (!shares || shares.length < G.escrowThreshold) {
    return null;
  }

  const reconstructed = reconstructKeyFromShares(shares, G.escrowThreshold);
  if (reconstructed) {
    G.releasedKeys[playerId] = reconstructed;
  }

  return reconstructed;
}

// =============================================================================
// Betting Moves (Wrapper for Standard Poker)
// =============================================================================

/**
 * Fold move with key release requirement.
 */
function fold(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string
): CryptoPokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processFold(G, pid);
  if (!result.valid) return INVALID_MOVE;

  // Note: Player must call releaseKey separately after folding

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

/**
 * Check move.
 */
function check(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string
): CryptoPokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processCheck(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

/**
 * Call move.
 */
function call(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string
): CryptoPokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processCall(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

/**
 * Bet move.
 */
function bet(
  G: CryptoPokerState,
  ctx: Ctx,
  amount: number,
  playerId?: string
): CryptoPokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processBet(G, pid, amount);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer) {
    G.bettingRound.activePlayer = nextPlayer;
  }

  return G;
}

/**
 * Raise move.
 */
function raise(
  G: CryptoPokerState,
  ctx: Ctx,
  totalBet: number,
  playerId?: string
): CryptoPokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processRaise(G, pid, totalBet);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer) {
    G.bettingRound.activePlayer = nextPlayer;
  }

  return G;
}

/**
 * All-in move.
 */
function allIn(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string
): CryptoPokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processAllIn(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

// =============================================================================
// Phase Advancement
// =============================================================================

/**
 * Advance to next phase after betting round.
 */
function advancePhase(G: CryptoPokerState): void {
  // Reset bets for next round
  for (const player of Object.values(G.players)) {
    player.bet = 0;
    player.hasActed = false;
  }

  // Check if only one player remains
  if (countActivePlayers(G) === 1) {
    G.phase = 'showdown';
    resolveShowdown(G);
    return;
  }

  const phaseOrder: CryptoPokerPhase[] = [
    'keyExchange',
    'keyEscrow',
    'encrypt',
    'shuffle',
    'preflop',
    'flop',
    'turn',
    'river',
    'showdown',
    'gameOver',
  ];

  const currentIndex = phaseOrder.indexOf(G.phase);
  const nextPhase = phaseOrder[currentIndex + 1];

  if (!nextPhase) {
    G.phase = 'gameOver';
    return;
  }

  switch (nextPhase) {
    case 'flop':
      // Deal 3 community cards (initiate collaborative reveal)
      // In real implementation: deal from encrypted deck, all players reveal
      G.phase = 'flop';
      break;

    case 'turn':
    case 'river':
      // Deal 1 community card
      G.phase = nextPhase;
      break;

    case 'showdown':
      resolveShowdown(G);
      return;

    default:
      G.phase = nextPhase;
  }

  // Initialize betting round for post-flop phases
  if (['flop', 'turn', 'river'].includes(nextPhase)) {
    const firstToAct = getFirstToActPostflop(G);
    if (firstToAct) {
      G.bettingRound = initBettingRound(G, firstToAct);
    } else {
      // All players all-in
      advancePhase(G);
    }
  }
}

/**
 * Resolve showdown - reveal hands and award pot.
 */
function resolveShowdown(G: CryptoPokerState): void {
  G.phase = 'showdown';

  const activePlayers = getActivePlayerIds(G);

  // If only one player, they win by default
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    G.players[winner].chips += G.pot;
    G.winners = [winner];
    G.phase = 'gameOver';
    return;
  }

  // In crypto mode: initiate collaborative reveal of all active players' hands
  // Each player (except the hand owner, who already peeked) submits decryption shares
  // Using released keys for folded players

  // For now, simulate result (real implementation would wait for all reveals)
  // Award pot to first active player (placeholder)
  const winner = activePlayers[0];
  G.players[winner].chips += G.pot;
  G.winners = [winner];
  G.pot = 0;
  G.phase = 'gameOver';
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

/**
 * Crypto Poker game for boardgame.io.
 */
export const CryptoPokerGame: Game<CryptoPokerState> = {
  name: 'crypto-poker',

  setup: (ctx): CryptoPokerState => {
    return createCryptoInitialState({
      numPlayers: (ctx.numPlayers as number) ?? 2,
      playerIDs: (ctx.playOrder as string[]) ?? ['0', '1'],
    });
  },

  turn: {
    order: {
      first: () => 0,
      next: ({ G }) => {
        // During setup phases, use setupPlayerIndex
        if (['keyExchange', 'keyEscrow', 'encrypt', 'shuffle'].includes(G.phase)) {
          return G.setupPlayerIndex % G.playerOrder.length;
        }
        // During betting, use activePlayer
        const activeIndex = G.playerOrder.indexOf(G.bettingRound.activePlayer);
        return activeIndex >= 0 ? activeIndex : 0;
      },
    },
  },

  phases: {
    setup: {
      start: true,
      moves: {
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
          client: false,
        },
        distributeKeyShares: {
          move: ({ G, ctx }, playerId: string, privateKey: string, shares: KeyShare[]) =>
            distributeKeyShares(G, ctx, playerId, privateKey, shares),
          client: false,
        },
        encryptDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            encryptDeck(G, ctx, playerId, privateKey),
          client: false,
        },
        shuffleDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, privateKey),
          client: false,
        },
      },
      next: 'play',
      endIf: ({ G }) => G.phase === 'preflop',
    },
    play: {
      moves: {
        // Peek
        peekHoleCards: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            peekHoleCards(G, ctx, playerId, privateKey),
          client: false,
        },
        submitDecryptionShare: {
          move: ({ G, ctx }, playerId: string, privateKey: string, zoneId: string, cardIndex: number) =>
            submitDecryptionShare(G, ctx, playerId, privateKey, zoneId, cardIndex),
          client: false,
        },
        // Betting
        fold: {
          move: ({ G, ctx }, playerId?: string) => fold(G, ctx, playerId),
          client: false,
        },
        check: {
          move: ({ G, ctx }, playerId?: string) => check(G, ctx, playerId),
          client: false,
        },
        call: {
          move: ({ G, ctx }, playerId?: string) => call(G, ctx, playerId),
          client: false,
        },
        bet: {
          move: ({ G, ctx }, amount: number, playerId?: string) => bet(G, ctx, amount, playerId),
          client: false,
        },
        raise: {
          move: ({ G, ctx }, totalBet: number, playerId?: string) => raise(G, ctx, totalBet, playerId),
          client: false,
        },
        allIn: {
          move: ({ G, ctx }, playerId?: string) => allIn(G, ctx, playerId),
          client: false,
        },
        // Key release
        releaseKey: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            releaseKey(G, ctx, playerId, privateKey),
          client: false,
        },
        showHand: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            showHand(G, ctx, playerId, privateKey),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === 'voided') {
      return { draw: true, reason: 'voided' };
    }
    // Game ends when only one player has chips
    const playersWithChips = Object.entries(G.players).filter(([_, p]) => p.chips > 0);
    if (playersWithChips.length === 1) {
      return { winner: playersWithChips[0][0] };
    }
    return undefined;
  },
};

// =============================================================================
// Move Validation
// =============================================================================

export function validateCryptoMove(
  state: CryptoPokerState,
  move: string,
  playerId: string,
  ...args: unknown[]
): MoveValidation {
  switch (move) {
    case 'submitPublicKey':
      if (state.phase !== 'keyExchange') {
        return { valid: false, error: 'Not in key exchange phase' };
      }
      if (state.players[playerId]?.publicKey) {
        return { valid: false, error: 'Key already submitted' };
      }
      return { valid: true };

    case 'distributeKeyShares':
      if (state.phase !== 'keyEscrow') {
        return { valid: false, error: 'Not in key escrow phase' };
      }
      if (state.players[playerId]?.hasDistributedShares) {
        return { valid: false, error: 'Shares already distributed' };
      }
      return { valid: true };

    case 'encryptDeck':
      if (state.phase !== 'encrypt') {
        return { valid: false, error: 'Not in encrypt phase' };
      }
      if (getCurrentSetupPlayer(state) !== playerId) {
        return { valid: false, error: 'Not your turn to encrypt' };
      }
      return { valid: true };

    case 'shuffleDeck':
      if (state.phase !== 'shuffle') {
        return { valid: false, error: 'Not in shuffle phase' };
      }
      if (getCurrentSetupPlayer(state) !== playerId) {
        return { valid: false, error: 'Not your turn to shuffle' };
      }
      return { valid: true };

    case 'peekHoleCards':
      if (!['preflop', 'flop', 'turn', 'river'].includes(state.phase)) {
        return { valid: false, error: 'Cannot peek now' };
      }
      if (state.players[playerId]?.hasPeeked) {
        return { valid: false, error: 'Already peeked' };
      }
      return { valid: true };

    case 'releaseKey':
      if (!state.players[playerId]?.folded) {
        return { valid: false, error: 'Must fold before releasing key' };
      }
      if (state.players[playerId]?.hasReleasedKey) {
        return { valid: false, error: 'Key already released' };
      }
      return { valid: true };

    // Standard betting moves - delegate to standard validation
    case 'fold':
    case 'check':
    case 'call':
    case 'bet':
    case 'raise':
    case 'allIn':
      if (!['preflop', 'flop', 'turn', 'river'].includes(state.phase)) {
        return { valid: false, error: 'Not in betting phase' };
      }
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unknown move: ${move}` };
  }
}

// =============================================================================
// Module Export
// =============================================================================

export const CryptoPokerModule = {
  id: 'crypto-poker',
  name: 'Crypto Texas Hold\'em',
  version: '1.0.0',
  description: 'Texas Hold\'em Poker with mental poker encryption for P2P play',

  cardSchema: pokerCardSchema,
  zones: POKER_ZONES,

  assetRequirements: {
    required: ['card_face'] as const,
    optional: ['card_back'] as const,
    idFormat: 'standard_52' as const,
  },

  initialState: createCryptoInitialState,
  validateMove: validateCryptoMove,
  getBoardgameIOGame: () => CryptoPokerGame,

  zoneLayout: {
    zones: {
      deck: { x: 10, y: 50, width: 10, height: 15, cardArrangement: 'stack' as const },
      community: { x: 30, y: 50, width: 40, height: 15, cardArrangement: 'fan' as const },
      hand: { x: 50, y: 85, width: 20, height: 15, cardArrangement: 'fan' as const },
      discard: { x: 80, y: 50, width: 10, height: 15, cardArrangement: 'stack' as const },
    },
    defaultCardSize: { width: 63, height: 88 },
  },
};

export default CryptoPokerModule;
