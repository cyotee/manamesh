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
  DecryptRequest,
  DecryptNotification,
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
import {
  generateKeyPair,
  decrypt,
  encryptDeck as encryptDeckCrypto,
  reencryptDeck,
  quickShuffle,
  getCardPoint,
  type EncryptedCard,
} from '../../../crypto/mental-poker';

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
 *
 * @param config - Game configuration
 * @param config.options.initialBalances - Optional balances from blockchain (playerId -> chips)
 * @param config.options.handId - Optional hand ID for settlement tracking
 * @param config.options.dealerIndex - Optional dealer position (for multi-hand sessions)
 */
export function createCryptoInitialState(config: GameConfig): CryptoPokerState {
  const pokerConfig: PokerConfig = {
    ...DEFAULT_POKER_CONFIG,
    ...config.options,
  };

  // Get initial balances from blockchain or use default
  const initialBalances = (config.options?.initialBalances as Record<string, number>) || {};
  const handId = (config.options?.handId as string) || `hand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dealerIndex = (config.options?.dealerIndex as number) || 0;

  const cardIds = getAllCardIds();

  const players: Record<string, CryptoPokerPlayerState> = {};
  const startingChips: Record<string, number> = {};
  const contributions: Record<string, number> = {};
  const zones: Record<string, Record<string, PokerCard[]>> = {
    deck: { shared: [] },
    hand: {},
    community: { shared: [] },
    discard: { shared: [] },
    mucked: { shared: [] },
  };

  // Initialize player states with balances from blockchain
  for (const playerId of config.playerIDs) {
    const chips = initialBalances[playerId] ?? pokerConfig.startingChips;
    startingChips[playerId] = chips;
    contributions[playerId] = 0;

    players[playerId] = {
      hand: [],
      chips,
      bet: 0,
      folded: false,
      hasActed: false,
      isAllIn: false,
      publicKey: null,
      hasEncrypted: false,
      hasShuffled: false,
      hasPeeked: false,
      peekedCards: [],
      hasReleasedKey: false,
      hasDistributedShares: false,
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
    zones.hand[playerId] = [];
  }

  const playerOrder = [...config.playerIDs];
  const dealer = playerOrder[dealerIndex % playerOrder.length];

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
    // Settlement tracking
    handId,
    contributions,
    startingChips,
    // Abandonment support
    releasedKeys: {},
    keyEscrowShares: {},
    escrowThreshold: Math.max(2, playerOrder.length - 1), // N-1 threshold
    disconnectedPlayers: [],
    peekNotifications: [],
    // Cooperative decryption
    decryptRequests: [],
    decryptNotifications: [],
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
  console.log('[CryptoPoker] submitPublicKey called for player', playerId, 'phase:', G.phase, 'existing key:', G.players[playerId]?.publicKey);
  if (G.phase !== 'keyExchange') {
    console.log('[CryptoPoker] submitPublicKey INVALID_MOVE: not in keyExchange phase');
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.publicKey) return INVALID_MOVE; // Already submitted

  player.publicKey = publicKey;
  G.crypto.publicKeys[playerId] = publicKey;

  // Check if all players have submitted
  const allSubmitted = G.playerOrder.every((pid) => G.players[pid].publicKey !== null);
  if (allSubmitted) {
    // Build the card point lookup with actual curve points
    // This maps cardId -> curve point (hex string) for reverse lookup after decryption
    for (const cardId of G.cardIds) {
      G.crypto.cardPointLookup[cardId] = getCardPoint(cardId);
    }
    console.log('[CryptoPoker] Built card point lookup with', Object.keys(G.crypto.cardPointLookup).length, 'cards');

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

  // DEMO ONLY: Store private key for decryption (NOT SECURE - for demo purposes only)
  // In real implementation, keys would never be shared; only decryption shares would be exchanged
  if (!G.crypto.privateKeys) {
    G.crypto.privateKeys = {};
  }
  G.crypto.privateKeys[playerId] = privateKey;

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

  // Perform actual encryption
  const existingDeck = G.crypto.encryptedZones['deck'];

  if (!existingDeck || existingDeck.length === 0) {
    // First player: encrypt all card IDs
    const cardIds = G.cardIds;
    console.log('[CryptoPoker] First encryption by player', playerId, '- encrypting', cardIds.length, 'cards');

    // Card point lookup should already be built in submitPublicKey
    // Encrypt the deck
    const encryptedDeck = encryptDeckCrypto(cardIds, privateKey);
    G.crypto.encryptedZones['deck'] = encryptedDeck;
    console.log('[CryptoPoker] Encrypted deck has', encryptedDeck.length, 'cards with', encryptedDeck[0]?.layers, 'layers');
  } else {
    // Subsequent players: re-encrypt the already encrypted deck
    console.log('[CryptoPoker] Re-encryption by player', playerId, '- current layers:', existingDeck[0]?.layers);
    const reencryptedDeck = reencryptDeck(existingDeck, privateKey);
    G.crypto.encryptedZones['deck'] = reencryptedDeck;
    console.log('[CryptoPoker] Re-encrypted deck has', reencryptedDeck.length, 'cards with', reencryptedDeck[0]?.layers, 'layers');
  }

  // Update crypto phase
  G.crypto.phase = 'encrypt';
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
  privateKey: string,
  events?: { endPhase?: () => void }
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== 'shuffle') return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasShuffled) return INVALID_MOVE;

  // Get the encrypted deck
  const encryptedDeck = G.crypto.encryptedZones['deck'];
  if (!encryptedDeck || encryptedDeck.length === 0) {
    console.error('[CryptoPoker] No encrypted deck to shuffle!');
    return INVALID_MOVE;
  }

  // Shuffle the deck
  console.log('[CryptoPoker] Shuffling deck for player', playerId, '- deck has', encryptedDeck.length, 'cards');
  const shuffledDeck = quickShuffle(encryptedDeck);
  G.crypto.encryptedZones['deck'] = shuffledDeck;
  console.log('[CryptoPoker] Deck shuffled by player', playerId);

  // Update crypto phase
  G.crypto.phase = 'shuffle';
  player.hasShuffled = true;

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    // Update crypto phase to ready
    G.crypto.phase = 'ready';

    // Transition to preflop - deal hole cards
    dealHoleCards(G);
    G.phase = 'preflop';

    // Post blinds and set first to act
    postBlinds(G);
    const utgPlayer = getUTGPlayer(G);
    G.bettingRound = initBettingRound(G, utgPlayer);
    G.bettingRound.currentBet = G.bigBlindAmount;

    // Only end the setup phase if we're actually in setup (first hand)
    // For new hands, we're already in play phase, so don't call endPhase
    const isInSetupPhase = ctx.phase === 'setup';
    console.log('[CryptoPoker] Shuffle complete. ctx.phase:', ctx.phase, 'isInSetupPhase:', isInSetupPhase);
    if (isInSetupPhase && events?.endPhase) {
      console.log('[CryptoPoker] Ending setup phase, transitioning to play');
      events.endPhase();
      console.log('[CryptoPoker] Called events.endPhase()');
    } else {
      console.warn('[CryptoPoker] events.endPhase not available!');
    }
  }

  return G;
}

/**
 * Deal hole cards to all players (encrypted).
 */
function dealHoleCards(G: CryptoPokerState): void {
  // In crypto mode, this moves encrypted cards to player hand zones
  // The actual card values remain encrypted until peek/reveal

  const deck = G.crypto.encryptedZones['deck'];
  if (!deck || deck.length === 0) {
    console.error('[CryptoPoker] No deck to deal from!');
    return;
  }

  console.log('[CryptoPoker] Dealing hole cards to', G.playerOrder.length, 'players');

  // Deal 2 cards to each player (deal one card at a time in rotation, like real poker)
  for (let round = 0; round < 2; round++) {
    for (const playerId of G.playerOrder) {
      const handZone = `hand:${playerId}`;

      // Initialize hand zone if needed
      if (!G.crypto.encryptedZones[handZone]) {
        G.crypto.encryptedZones[handZone] = [];
      }

      // Take top card from deck and add to player's hand
      const card = deck.shift();
      if (card) {
        G.crypto.encryptedZones[handZone].push(card);
      }
    }
  }

  console.log('[CryptoPoker] Dealt cards. Deck remaining:', deck.length);
}

/**
 * Deal community cards (flop/turn/river) from encrypted deck.
 * For simplicity, we decrypt these immediately (in full mental poker,
 * this would require collaborative reveal from all players).
 */
function dealCommunityCards(G: CryptoPokerState, count: number): void {
  const deck = G.crypto.encryptedZones['deck'];
  if (!deck || deck.length < count) {
    console.error('[CryptoPoker] Not enough cards in deck to deal community cards!');
    return;
  }

  // Initialize community zone if needed
  if (!G.crypto.encryptedZones['community']) {
    G.crypto.encryptedZones['community'] = [];
  }

  console.log('[CryptoPoker] Dealing', count, 'community cards');

  // Move cards from deck to community zone
  for (let i = 0; i < count; i++) {
    const card = deck.shift();
    if (card) {
      G.crypto.encryptedZones['community'].push(card);

      // For demo: try to decrypt and add to visible community cards
      // In real implementation, this would require all players to submit decryption shares
      const cardId = tryDecryptCommunityCard(G, card);
      if (cardId) {
        G.community.push(parseCardId(cardId));
        console.log('[CryptoPoker] Revealed community card:', cardId);
      } else {
        // Add placeholder for now
        // Type assertion needed because "?" isn't a valid rank - this is temporary until proper reveal
        G.community.push({ id: `community-${G.community.length}`, rank: '?' as PokerCard['rank'], suit: 'spades' as const });
        console.log('[CryptoPoker] Added placeholder community card (not yet revealed)');
      }
    }
  }

  console.log('[CryptoPoker] Community cards:', G.community.length, ', Deck remaining:', deck.length);
}

/**
 * Try to decrypt a community card using the stored private keys.
 *
 * DEMO NOTE: This uses stored private keys, which breaks the security model.
 * In real mental poker, each player would submit a decryption share for the
 * community card without revealing their private key.
 */
function tryDecryptCommunityCard(G: CryptoPokerState, encryptedCard: EncryptedCard): string | null {
  // Collect all available private keys
  const allPrivateKeys: string[] = [];
  if (G.crypto.privateKeys) {
    for (const key of Object.values(G.crypto.privateKeys)) {
      if (key) {
        allPrivateKeys.push(key);
      }
    }
  }

  if (allPrivateKeys.length === 0) {
    console.log('[CryptoPoker] No private keys available for community card decryption');
    return null;
  }

  let decrypted = { ...encryptedCard };

  // Apply decryption with each key until fully decrypted
  for (const key of allPrivateKeys) {
    if (decrypted.layers > 0) {
      try {
        decrypted = decrypt(decrypted, key);
      } catch (err) {
        console.error('[CryptoPoker] Community card decryption failed:', err);
      }
    }
  }

  if (decrypted.layers === 0) {
    // Fully decrypted - look up the card ID from the point
    const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, decrypted.ciphertext);
    return cardId;
  }

  return null;
}

// =============================================================================
// Peek and Reveal Moves
// =============================================================================

/**
 * Peek at hole cards (self-decrypt).
 *
 * DEMO NOTE: This implementation uses stored private keys from all players,
 * which breaks the security model of mental poker. In a real implementation,
 * peeking would require each other player to submit a decryption share for
 * this specific card, without revealing their private key.
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

  // Get encrypted cards from hand zone
  const handZone = G.crypto.encryptedZones[`hand:${playerId}`];
  if (!handZone || handZone.length === 0) {
    console.error('[CryptoPoker] No encrypted cards in hand zone for player', playerId);
    return INVALID_MOVE;
  }

  // Collect all available private keys for decryption
  // DEMO ONLY: In real mental poker, we'd request decryption shares, not use raw keys
  const allPrivateKeys: string[] = [];

  // Add the peeking player's key first
  allPrivateKeys.push(privateKey);

  // Add other players' stored keys (DEMO ONLY - insecure!)
  if (G.crypto.privateKeys) {
    for (const [pid, key] of Object.entries(G.crypto.privateKeys)) {
      if (pid !== playerId && key) {
        allPrivateKeys.push(key);
      }
    }
  }

  console.log('[CryptoPoker] Peeking with', allPrivateKeys.length, 'private keys');

  // Decrypt each card using ALL private keys
  const peekedCards: PokerCard[] = [];

  for (const encryptedCard of handZone) {
    let decrypted = { ...encryptedCard };

    // Apply decryption with each key until fully decrypted
    for (const key of allPrivateKeys) {
      if (decrypted.layers > 0) {
        try {
          decrypted = decrypt(decrypted, key);
          console.log('[CryptoPoker] Decrypted one layer, remaining:', decrypted.layers);
        } catch (err) {
          console.error('[CryptoPoker] Decryption failed with key:', err);
        }
      }
    }

    if (decrypted.layers === 0) {
      // Fully decrypted - look up the card ID from the point
      const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, decrypted.ciphertext);
      if (cardId) {
        console.log('[CryptoPoker] Decrypted card:', cardId);
        peekedCards.push(parseCardId(cardId));
      } else {
        console.error('[CryptoPoker] Could not find card for point:', decrypted.ciphertext);
        // Type assertion for placeholder - "?" isn't a valid rank
        peekedCards.push({ id: 'unknown', rank: '?' as PokerCard['rank'], suit: 'spades' as const });
      }
    } else {
      // Still encrypted - missing some keys
      console.log('[CryptoPoker] Card still has', decrypted.layers, 'encryption layers remaining');
      // Type assertion for placeholder - "?" isn't a valid rank
      peekedCards.push({ id: 'unknown', rank: '?' as PokerCard['rank'], suit: 'spades' as const });
    }
  }

  console.log('[CryptoPoker] Player', playerId, 'peeked at cards:', peekedCards.map(c => `${c.rank}${c.suit[0]}`));
  player.peekedCards = peekedCards;
  player.hasPeeked = true;

  // Add notification for other players
  G.peekNotifications.push({
    playerId,
    timestamp: Date.now(),
  });

  return G;
}

/**
 * Look up a card ID from its curve point.
 */
function lookupCardIdFromPoint(
  cardPointLookup: Record<string, string>,
  point: string
): string | null {
  for (const [cardId, cardPoint] of Object.entries(cardPointLookup)) {
    if (cardPoint === point) {
      return cardId;
    }
  }
  return null;
}

/**
 * Parse a card ID (e.g., "Ah", "2c") into a PokerCard.
 */
/**
 * Parse a card ID (e.g., "hearts-A", "spades-K") into a PokerCard.
 * Card ID format is "${suit}-${rank}" as defined in types.ts getCardId().
 */
function parseCardId(cardId: string): PokerCard {
  const validRanks: PokerCard['rank'][] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const validSuits: PokerCard['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];

  const parts = cardId.split('-');
  if (parts.length !== 2) {
    console.error('[CryptoPoker] Invalid card ID format:', cardId);
    // Type assertion for placeholder - "?" isn't a valid rank but we need to show something
    return { id: cardId, rank: '?' as PokerCard['rank'], suit: 'spades' };
  }

  const [suit, rank] = parts;

  // Validate suit
  if (!validSuits.includes(suit as PokerCard['suit'])) {
    console.error('[CryptoPoker] Invalid suit in card ID:', suit);
    return { id: cardId, rank: rank as PokerCard['rank'], suit: 'spades' };
  }

  // Validate rank
  if (!validRanks.includes(rank as PokerCard['rank'])) {
    console.error('[CryptoPoker] Invalid rank in card ID:', rank);
    return { id: cardId, rank: rank as PokerCard['rank'], suit: suit as PokerCard['suit'] };
  }

  return { id: cardId, rank: rank as PokerCard['rank'], suit: suit as PokerCard['suit'] };
}

// =============================================================================
// Cooperative Decryption Moves
// =============================================================================

/**
 * Request cooperative decryption of cards.
 * This initiates the approval process - other players must approve before cards can be decrypted.
 */
function requestDecrypt(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  zoneId: string,
  cardIndices: number[]
): CryptoPokerState | typeof INVALID_MOVE {
  if (!['preflop', 'flop', 'turn', 'river'].includes(G.phase)) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.folded) return INVALID_MOVE;

  // Check if there's already a pending request for this zone
  const existingRequest = G.decryptRequests.find(
    r => r.zoneId === zoneId && r.requestingPlayer === playerId && r.status === 'pending'
  );
  if (existingRequest) return INVALID_MOVE;

  // Create the decrypt request
  const requestId = `decrypt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Initialize approvals - requesting player auto-approves
  const approvals: Record<string, boolean> = {};
  for (const pid of G.playerOrder) {
    approvals[pid] = pid === playerId; // Auto-approve for requesting player
  }

  const request: DecryptRequest = {
    id: requestId,
    requestingPlayer: playerId,
    zoneId,
    cardIndices,
    timestamp: Date.now(),
    status: 'pending',
    approvals,
    decryptionShares: {},
  };

  G.decryptRequests.push(request);

  // Add notification for all players
  const notification: DecryptNotification = {
    type: 'request',
    requestId,
    playerId,
    message: `Player ${playerId} requests to reveal their cards`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log('[CryptoPoker] Decrypt request created:', requestId, 'for zone:', zoneId);

  return G;
}

/**
 * Approve a decrypt request and submit decryption share.
 * Once all players approve, the cards are automatically decrypted.
 */
function approveDecrypt(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  requestId: string,
  privateKey: string
): CryptoPokerState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  // Find the request
  const request = G.decryptRequests.find(r => r.id === requestId);
  if (!request) {
    console.error('[CryptoPoker] Decrypt request not found:', requestId);
    return INVALID_MOVE;
  }

  if (request.status !== 'pending') {
    console.error('[CryptoPoker] Request is not pending:', request.status);
    return INVALID_MOVE;
  }

  // Check if already approved
  if (request.approvals[playerId]) {
    console.log('[CryptoPoker] Player', playerId, 'already approved request', requestId);
    return INVALID_MOVE;
  }

  // Mark as approved
  request.approvals[playerId] = true;

  // Store the decryption share (in this demo, we store the private key)
  // In a real implementation, this would be a partial decryption share
  if (!request.decryptionShares[playerId]) {
    request.decryptionShares[playerId] = [];
  }
  request.decryptionShares[playerId].push(privateKey);

  // Add notification
  const notification: DecryptNotification = {
    type: 'approval',
    requestId,
    playerId,
    message: `Player ${playerId} approved the decrypt request`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log('[CryptoPoker] Player', playerId, 'approved decrypt request', requestId);

  // Check if all players have approved
  const allApproved = G.playerOrder.every(pid => request.approvals[pid]);

  if (allApproved) {
    console.log('[CryptoPoker] All players approved! Completing decryption...');

    // Complete the decryption
    request.status = 'completed';

    // Perform the actual decryption using all submitted keys
    const requestingPlayer = G.players[request.requestingPlayer];
    const handZone = G.crypto.encryptedZones[request.zoneId];

    if (handZone && requestingPlayer && !requestingPlayer.hasPeeked) {
      // Collect all private keys
      const allPrivateKeys: string[] = [];
      for (const [pid, shares] of Object.entries(request.decryptionShares)) {
        allPrivateKeys.push(...shares);
      }
      // Also add stored keys as fallback
      if (G.crypto.privateKeys) {
        for (const key of Object.values(G.crypto.privateKeys)) {
          if (key && !allPrivateKeys.includes(key)) {
            allPrivateKeys.push(key);
          }
        }
      }

      // Decrypt the cards
      const peekedCards: PokerCard[] = [];
      for (const encryptedCard of handZone) {
        let decrypted = { ...encryptedCard };
        for (const key of allPrivateKeys) {
          if (decrypted.layers > 0) {
            try {
              decrypted = decrypt(decrypted, key);
            } catch (err) {
              console.error('[CryptoPoker] Decryption failed:', err);
            }
          }
        }

        if (decrypted.layers === 0) {
          const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, decrypted.ciphertext);
          if (cardId) {
            peekedCards.push(parseCardId(cardId));
          } else {
            peekedCards.push({ id: 'unknown', rank: '?' as PokerCard['rank'], suit: 'spades' as const });
          }
        } else {
          peekedCards.push({ id: 'unknown', rank: '?' as PokerCard['rank'], suit: 'spades' as const });
        }
      }

      requestingPlayer.peekedCards = peekedCards;
      requestingPlayer.hasPeeked = true;

      console.log('[CryptoPoker] Cooperative decryption complete for player', request.requestingPlayer);
    }

    // Add completion notification
    const completeNotification: DecryptNotification = {
      type: 'completed',
      requestId,
      playerId: request.requestingPlayer,
      message: `Cards revealed for Player ${request.requestingPlayer}`,
      timestamp: Date.now(),
    };
    G.decryptNotifications.push(completeNotification);

    // Add peek notification for compatibility
    G.peekNotifications.push({
      playerId: request.requestingPlayer,
      timestamp: Date.now(),
    });
  }

  return G;
}

/**
 * Dismiss a decrypt notification.
 */
function dismissNotification(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  notificationIndex: number
): CryptoPokerState | typeof INVALID_MOVE {
  if (notificationIndex < 0 || notificationIndex >= G.decryptNotifications.length) {
    return INVALID_MOVE;
  }

  G.decryptNotifications.splice(notificationIndex, 1);
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
      // Deal 3 community cards from encrypted deck
      dealCommunityCards(G, 3);
      G.phase = 'flop';
      break;

    case 'turn':
      // Deal 1 community card (the turn)
      dealCommunityCards(G, 1);
      G.phase = 'turn';
      break;

    case 'river':
      // Deal 1 community card (the river)
      dealCommunityCards(G, 1);
      G.phase = 'river';
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

  // Evaluate each active player's hand
  // In crypto mode, we use peekedCards (decrypted hole cards) + community cards
  const playerHands: { playerId: string; hand: ReturnType<typeof findBestHand> }[] = [];

  for (const playerId of activePlayers) {
    const player = G.players[playerId];
    const holeCards = player.peekedCards;

    // If player hasn't peeked, we can't evaluate their hand
    // In a real implementation, we'd force reveal at showdown
    if (!holeCards || holeCards.length === 0) {
      console.warn('[CryptoPoker] Player', playerId, 'has no peeked cards at showdown');
      continue;
    }

    // Find best 5-card hand from hole cards + community cards
    const bestHand = findBestHand(holeCards, G.community);
    playerHands.push({ playerId, hand: bestHand });

    console.log('[CryptoPoker] Player', playerId, 'best hand:', bestHand.description);
  }

  if (playerHands.length === 0) {
    console.error('[CryptoPoker] No valid hands at showdown!');
    G.phase = 'gameOver';
    return;
  }

  // Determine winner(s) by comparing hands
  let winners: string[] = [];

  // Sort hands to find winner(s) - highest hand wins
  playerHands.sort((a, b) => {
    // Compare by rank first
    if (a.hand.rank !== b.hand.rank) {
      return b.hand.rank - a.hand.rank; // Higher rank wins
    }
    // Same rank - compare values (kickers)
    for (let i = 0; i < a.hand.values.length; i++) {
      if (a.hand.values[i] !== b.hand.values[i]) {
        return b.hand.values[i] - a.hand.values[i]; // Higher value wins
      }
    }
    return 0; // Tie
  });

  // Find all players with the same best hand (for split pots)
  const bestHand = playerHands[0].hand;
  winners = playerHands
    .filter(ph => {
      if (ph.hand.rank !== bestHand.rank) return false;
      for (let i = 0; i < ph.hand.values.length; i++) {
        if (ph.hand.values[i] !== bestHand.values[i]) return false;
      }
      return true;
    })
    .map(ph => ph.playerId);

  console.log('[CryptoPoker] Winner(s):', winners, 'with', bestHand.description);

  // Award pot (split if tie)
  const potShare = Math.floor(G.pot / winners.length);
  for (const winnerId of winners) {
    G.players[winnerId].chips += potShare;
  }

  G.winners = winners;
  G.pot = 0;
  G.phase = 'gameOver';
}

// Note: newHand function removed - each hand is now a new game instance
// To start a new hand:
// 1. Get hand result from ctx.gameover.handResult
// 2. Settle pot via blockchain service
// 3. Get new balances from blockchain
// 4. Create a new game instance with those balances

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
        // All moves have client: false to prevent optimistic updates in P2P mode.
        // This ensures GUEST doesn't increment stateID locally before HOST confirms.
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
          move: ({ G, ctx, events }, playerId: string, privateKey: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, privateKey, events),
          client: false,
        },
      },
      next: 'play',
      endIf: ({ G }) => G.phase === 'preflop',
    },
    play: {
      moves: {
        // Setup moves (for new hands - need full crypto setup again)
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
          move: ({ G, ctx, events }, playerId: string, privateKey: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, privateKey, events),
          client: false,
        },
        // Peek (auto-decrypt - uses stored keys, less secure but simpler)
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
        // Cooperative decryption (requires approval from all players)
        requestDecrypt: {
          move: ({ G, ctx }, playerId: string, zoneId: string, cardIndices: number[]) =>
            requestDecrypt(G, ctx, playerId, zoneId, cardIndices),
          client: false,
        },
        approveDecrypt: {
          move: ({ G, ctx }, playerId: string, requestId: string, privateKey: string) =>
            approveDecrypt(G, ctx, playerId, requestId, privateKey),
          client: false,
        },
        dismissNotification: {
          move: ({ G, ctx }, playerId: string, notificationIndex: number) =>
            dismissNotification(G, ctx, playerId, notificationIndex),
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
        // Note: newHand move removed - each hand is a new game instance
        // Use the blockchain service to settle and create a new game
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === 'voided') {
      return { draw: true, reason: 'voided', handResult: buildHandResult(G) };
    }

    // Game ends when hand is complete (showdown resolved or gameOver)
    if (G.phase === 'gameOver') {
      return {
        winners: G.winners,
        handResult: buildHandResult(G),
      };
    }

    return undefined;
  },
};

/**
 * Build hand result for blockchain settlement.
 */
function buildHandResult(G: CryptoPokerState): {
  handId: string;
  winners: string[];
  payouts: Record<string, number>;
  contributions: Record<string, number>;
  totalPot: number;
  timestamp: number;
} {
  // Calculate contributions as difference from starting chips
  const contributions: Record<string, number> = {};
  for (const [playerId, player] of Object.entries(G.players)) {
    contributions[playerId] = G.startingChips[playerId] - player.chips;
  }

  // Calculate payouts - each player gets back their contribution plus any winnings
  const payouts: Record<string, number> = {};
  const totalPot = Object.values(contributions).reduce((a, b) => a + b, 0);

  // Initialize payouts to 0
  for (const playerId of Object.keys(G.players)) {
    payouts[playerId] = 0;
  }

  // Winners split the pot
  if (G.winners.length > 0) {
    const winShare = Math.floor(totalPot / G.winners.length);
    const remainder = totalPot % G.winners.length;
    for (let i = 0; i < G.winners.length; i++) {
      payouts[G.winners[i]] = winShare + (i < remainder ? 1 : 0);
    }
  }

  return {
    handId: G.handId,
    winners: G.winners,
    payouts,
    contributions,
    totalPot,
    timestamp: Date.now(),
  };
}

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

    case 'requestDecrypt':
      if (!['preflop', 'flop', 'turn', 'river'].includes(state.phase)) {
        return { valid: false, error: 'Cannot request decryption now' };
      }
      if (state.players[playerId]?.hasPeeked) {
        return { valid: false, error: 'Already revealed cards' };
      }
      if (state.players[playerId]?.folded) {
        return { valid: false, error: 'Cannot request after folding' };
      }
      return { valid: true };

    case 'approveDecrypt':
      // Anyone can approve a pending decrypt request
      return { valid: true };

    case 'dismissNotification':
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
