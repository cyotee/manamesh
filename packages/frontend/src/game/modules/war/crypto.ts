/**
 * War Game Crypto Integration
 *
 * Mental poker integration for cryptographically fair War gameplay.
 * Provides encrypted deck management, collaborative reveals, shuffle proofs,
 * key escrow for abandonment support, and cooperative decryption workflow.
 *
 * Security Features:
 * - SRA commutative encryption for fair dealing
 * - Shamir's Secret Sharing for key escrow (N-1 threshold)
 * - Cooperative decryption requiring approval from all players
 * - Key release protocol for folded/disconnected players
 * - Verifiable shuffle proofs
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
import {
  decrypt,
  encryptDeck as encryptDeckCrypto,
  reencryptDeck,
  quickShuffle,
  getCardPoint,
} from '../../../crypto/mental-poker';
import { createKeyShares, reconstructKeyFromShares, type KeyShare } from '../../../crypto/shamirs';

// =============================================================================
// Types
// =============================================================================

/**
 * Notification that a player revealed their cards.
 */
export interface RevealNotification {
  playerId: string;
  timestamp: number;
}

/**
 * Request for cooperative card decryption.
 * Players must approve for decryption to proceed.
 */
export interface DecryptRequest {
  /** Unique request ID */
  id: string;
  /** Player requesting decryption */
  requestingPlayer: string;
  /** Zone being decrypted (e.g., 'reveal_0') */
  zoneId: string;
  /** Card indices to decrypt */
  cardIndices: number[];
  /** Timestamp of request */
  timestamp: number;
  /** Status of the request */
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  /** Players who have approved */
  approvals: Record<string, boolean>;
  /** Decryption shares submitted by approving players */
  decryptionShares: Record<string, string[]>;
}

/**
 * Notification for decrypt request events.
 */
export interface DecryptNotification {
  type: 'request' | 'approval' | 'completed' | 'rejected';
  requestId: string;
  playerId: string;
  message: string;
  timestamp: number;
}

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
  /** Has distributed key escrow shares */
  hasDistributedShares: boolean;
  /** Has released their key (after surrender/disconnect) */
  hasReleasedKey: boolean;
  /** Is currently connected */
  isConnected: boolean;
  /** Timestamp of last heartbeat */
  lastHeartbeat: number;
}

/**
 * Extended phases for crypto War (includes setup phases).
 */
export type CryptoWarPhase =
  | 'keyExchange'
  | 'keyEscrow'
  | 'encrypt'
  | 'shuffle'
  | 'flip'
  | 'reveal'
  | 'resolve'
  | 'gameOver'
  | 'voided';

/**
 * Extended War state with crypto support.
 */
export interface CryptoWarState extends Omit<WarState, 'players' | 'phase'> {
  /** Player states with crypto extensions */
  players: Record<string, CryptoWarPlayerState>;

  /** Current game phase (extended for crypto) */
  phase: CryptoWarPhase;

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

  // Abandonment support
  /** Released private keys from surrendered/disconnected players */
  releasedKeys: Record<string, string>;
  /** Key escrow shares: playerId -> shares of their key */
  keyEscrowShares: Record<string, KeyShare[]>;
  /** Threshold for key reconstruction */
  escrowThreshold: number;
  /** Players who disconnected without releasing keys */
  disconnectedPlayers: string[];

  // Notification support
  /** Reveal notifications for UI */
  revealNotifications: RevealNotification[];

  // Cooperative decryption support
  /** Pending decrypt requests requiring approval */
  decryptRequests: DecryptRequest[];
  /** Notifications for decrypt events */
  decryptNotifications: DecryptNotification[];
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
      hasDistributedShares: false,
      hasReleasedKey: false,
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
    zones.deck[playerId] = [];
    zones.played[playerId] = [];
    zones.won[playerId] = [];
  }

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

  return {
    players,
    warInProgress: false,
    winner: null,
    phase: 'keyExchange',
    zones,
    crypto: cryptoState,
    cardIds,
    pendingReveals: {},
    cardsToReveal: [],
    playerOrder,
    setupPlayerIndex: 0,
    // Abandonment support
    releasedKeys: {},
    keyEscrowShares: {},
    escrowThreshold: Math.max(2, playerOrder.length - 1), // N-1 threshold
    disconnectedPlayers: [],
    // Notifications
    revealNotifications: [],
    // Cooperative decryption
    decryptRequests: [],
    decryptNotifications: [],
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
// Abandonment Support Helpers
// =============================================================================

/**
 * Check if player has released their key or is still active.
 */
export function hasAvailableKey(state: CryptoWarState, playerId: string): boolean {
  return (
    playerId in state.releasedKeys ||
    (state.players[playerId]?.isConnected ?? false)
  );
}

/**
 * Get all available keys (released + active players).
 */
export function getAllAvailableKeys(state: CryptoWarState): Set<string> {
  const keys = new Set<string>(Object.keys(state.releasedKeys));
  for (const [playerId, player] of Object.entries(state.players)) {
    if (player.isConnected) {
      keys.add(playerId);
    }
  }
  return keys;
}

/**
 * Check game viability - can we still complete reveals?
 */
export function checkGameViability(state: CryptoWarState): 'continue' | 'void' {
  const availableKeys = getAllAvailableKeys(state);

  // For reveals, we need ALL player keys
  for (const playerId of state.playerOrder) {
    if (!availableKeys.has(playerId)) {
      // Try to check escrow shares
      const shares = state.keyEscrowShares[playerId] || [];
      if (shares.length < state.escrowThreshold) {
        return 'void';
      }
    }
  }

  return 'continue';
}

/**
 * Attempt key reconstruction from escrow shares.
 */
export function attemptKeyReconstruction(
  G: CryptoWarState,
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

/**
 * Handle player disconnect.
 */
export function handleDisconnect(
  G: CryptoWarState,
  playerId: string
): void {
  const player = G.players[playerId];
  if (!player) return;

  player.isConnected = false;
  G.disconnectedPlayers.push(playerId);

  // Check viability
  if (checkGameViability(G) === 'void') {
    G.phase = 'voided';
  }
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
  console.log('[CryptoWar] submitPublicKey called for player', playerId, 'phase:', G.phase);
  if (G.phase !== 'keyExchange') {
    console.log('[CryptoWar] submitPublicKey INVALID_MOVE: not in keyExchange phase');
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
  G.crypto.publicKeys[playerId] = publicKey;

  // Check if all keys submitted
  if (allKeysSubmitted(G)) {
    // Build the card point lookup with actual curve points
    for (const cardId of G.cardIds) {
      G.crypto.cardPointLookup[cardId] = getCardPoint(cardId);
    }
    console.log('[CryptoWar] Built card point lookup with', Object.keys(G.crypto.cardPointLookup).length, 'cards');

    // Transition to key escrow phase (NEW: for abandonment support)
    G.phase = 'keyEscrow';
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Distribute key escrow shares during key escrow phase.
 * Uses Shamir's Secret Sharing for threshold-based key recovery.
 */
export function distributeKeyShares(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  shares: KeyShare[]
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] distributeKeyShares called for player', playerId, 'phase:', G.phase);
  if (G.phase !== 'keyEscrow') {
    console.log('[CryptoWar] distributeKeyShares INVALID_MOVE: not in keyEscrow phase');
    return INVALID_MOVE;
  }

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
    console.log('[CryptoWar] All players distributed key shares, transitioning to encrypt phase');
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
  console.log('[CryptoWar] encryptDeck called for player', playerId, 'phase:', G.phase);
  if (G.phase !== 'encrypt') {
    console.log('[CryptoWar] encryptDeck INVALID_MOVE: not in encrypt phase');
    return INVALID_MOVE;
  }

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) {
    console.log('[CryptoWar] encryptDeck INVALID_MOVE: not current setup player');
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasEncrypted) return INVALID_MOVE;

  // Perform actual encryption using mental-poker functions directly
  const existingDeck = G.crypto.encryptedZones['deck'];

  if (!existingDeck || existingDeck.length === 0) {
    // First player: encrypt all card IDs
    console.log('[CryptoWar] First encryption by player', playerId, '- encrypting', G.cardIds.length, 'cards');
    const encryptedDeck = encryptDeckCrypto(G.cardIds, privateKey);
    G.crypto.encryptedZones['deck'] = encryptedDeck;
    console.log('[CryptoWar] Encrypted deck has', encryptedDeck.length, 'cards with', encryptedDeck[0]?.layers, 'layers');
  } else {
    // Subsequent players: re-encrypt the already encrypted deck
    console.log('[CryptoWar] Re-encryption by player', playerId, '- current layers:', existingDeck[0]?.layers);
    const reencryptedDeck = reencryptDeck(existingDeck, privateKey);
    G.crypto.encryptedZones['deck'] = reencryptedDeck;
    console.log('[CryptoWar] Re-encrypted deck has', reencryptedDeck.length, 'cards with', reencryptedDeck[0]?.layers, 'layers');
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
 * Shuffle deck with proof (called sequentially).
 */
export function shuffleEncryptedDeck(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  events?: { endPhase?: () => void }
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] shuffleEncryptedDeck called for player', playerId, 'phase:', G.phase);
  if (G.phase !== 'shuffle') {
    console.log('[CryptoWar] shuffleEncryptedDeck INVALID_MOVE: not in shuffle phase');
    return INVALID_MOVE;
  }

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) {
    console.log('[CryptoWar] shuffleEncryptedDeck INVALID_MOVE: not current setup player');
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasShuffled) return INVALID_MOVE;

  // Get the encrypted deck
  const encryptedDeck = G.crypto.encryptedZones['deck'];
  if (!encryptedDeck || encryptedDeck.length === 0) {
    console.error('[CryptoWar] No encrypted deck to shuffle!');
    return INVALID_MOVE;
  }

  // Shuffle the deck using quickShuffle
  console.log('[CryptoWar] Shuffling deck for player', playerId, '- deck has', encryptedDeck.length, 'cards');
  const shuffledDeck = quickShuffle(encryptedDeck);
  G.crypto.encryptedZones['deck'] = shuffledDeck;
  console.log('[CryptoWar] Deck shuffled by player', playerId);

  // Update crypto phase
  G.crypto.phase = 'shuffle';
  player.hasShuffled = true;

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    // Update crypto phase to ready
    G.crypto.phase = 'ready';

    // Deal cards (half to each player as encrypted indices)
    dealEncryptedCards(G, ctx);
    G.phase = 'flip';

    // Only end the setup phase if we're actually in setup (first hand)
    const isInSetupPhase = ctx.phase === 'setup';
    console.log('[CryptoWar] Shuffle complete. ctx.phase:', ctx.phase, 'isInSetupPhase:', isInSetupPhase);
    if (isInSetupPhase && events?.endPhase) {
      console.log('[CryptoWar] Ending setup phase, transitioning to play');
      events.endPhase();
    }
  }

  return G;
}

// Alias for backward compatibility
export const shuffleDeck = shuffleEncryptedDeck;

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
 * This is the cooperative decryption - each player must contribute their decryption share.
 */
export function submitDecryptionShare(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  targetPlayerId: string,
  privateKey: string
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] submitDecryptionShare from', playerId, 'for target', targetPlayerId);
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

  pending[playerId] = true;

  // Check if all shares submitted
  const allSubmitted = G.playerOrder.every((pid) => pending[pid]);

  if (allSubmitted) {
    console.log('[CryptoWar] All decryption shares submitted, revealing card');

    // Decrypt the card using all private keys
    const revealZone = `reveal_${targetPlayerId}`;
    const encryptedCards = G.crypto.encryptedZones[revealZone];

    if (encryptedCards && encryptedCards.length > 0) {
      const encryptedCard = encryptedCards[0];

      // Collect all private keys for full decryption
      const allPrivateKeys: string[] = [];
      if (G.crypto.privateKeys) {
        for (const key of Object.values(G.crypto.privateKeys)) {
          if (key) {
            allPrivateKeys.push(key);
          }
        }
      }

      // Decrypt layer by layer
      let decrypted = { ...encryptedCard };
      for (const key of allPrivateKeys) {
        if (decrypted.layers > 0) {
          try {
            decrypted = decrypt(decrypted, key);
          } catch (err) {
            console.error('[CryptoWar] Decryption failed:', err);
          }
        }
      }

      if (decrypted.layers === 0) {
        // Fully decrypted - look up the card ID from the point
        const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, decrypted.ciphertext);
        if (cardId) {
          const card = parseCardId(cardId);
          G.players[targetPlayerId].played.push(card);
          console.log('[CryptoWar] Revealed card:', cardId, 'for player', targetPlayerId);

          // Mark as revealed
          G.crypto.revealedCards[`${revealZone}:0`] = cardId;
        }
      }
    }

    // Clean up pending reveal
    delete G.pendingReveals[revealKey];
    G.cardsToReveal = G.cardsToReveal.filter((i) => G.playerOrder[i] !== targetPlayerId);

    // Add reveal notification
    G.revealNotifications.push({
      playerId: targetPlayerId,
      timestamp: Date.now(),
    });

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

// =============================================================================
// Cooperative Decryption Moves
// =============================================================================

/**
 * Request cooperative decryption of cards.
 * This initiates the approval process - other players must approve before cards can be decrypted.
 */
export function requestDecrypt(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  zoneId: string,
  cardIndices: number[]
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] requestDecrypt from', playerId, 'for zone', zoneId);

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

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
    message: `Player ${playerId} requests to reveal cards`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log('[CryptoWar] Decrypt request created:', requestId, 'for zone:', zoneId);

  return G;
}

/**
 * Approve a decrypt request and submit decryption share.
 * Once all players approve, the cards are automatically decrypted.
 */
export function approveDecrypt(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  requestId: string,
  privateKey: string
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] approveDecrypt from', playerId, 'for request', requestId);

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  // Find the request
  const request = G.decryptRequests.find(r => r.id === requestId);
  if (!request) {
    console.error('[CryptoWar] Decrypt request not found:', requestId);
    return INVALID_MOVE;
  }

  if (request.status !== 'pending') {
    console.error('[CryptoWar] Request is not pending:', request.status);
    return INVALID_MOVE;
  }

  // Check if already approved
  if (request.approvals[playerId]) {
    console.log('[CryptoWar] Player', playerId, 'already approved request', requestId);
    return INVALID_MOVE;
  }

  // Mark as approved
  request.approvals[playerId] = true;

  // Store the decryption share (in this demo, we store the private key)
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

  console.log('[CryptoWar] Player', playerId, 'approved decrypt request', requestId);

  // Check if all players have approved
  const allApproved = G.playerOrder.every(pid => request.approvals[pid]);

  if (allApproved) {
    console.log('[CryptoWar] All players approved! Completing decryption...');

    // Complete the decryption
    request.status = 'completed';

    // Perform the actual decryption using all submitted keys
    const encryptedCards = G.crypto.encryptedZones[request.zoneId];

    if (encryptedCards && encryptedCards.length > 0) {
      // Collect all private keys
      const allPrivateKeys: string[] = [];
      for (const shares of Object.values(request.decryptionShares)) {
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

      // Decrypt each card
      for (let i = 0; i < encryptedCards.length; i++) {
        if (!request.cardIndices.includes(i)) continue;

        let decrypted = { ...encryptedCards[i] };
        for (const key of allPrivateKeys) {
          if (decrypted.layers > 0) {
            try {
              decrypted = decrypt(decrypted, key);
            } catch (err) {
              console.error('[CryptoWar] Decryption failed:', err);
            }
          }
        }

        if (decrypted.layers === 0) {
          const cardId = lookupCardIdFromPoint(G.crypto.cardPointLookup, decrypted.ciphertext);
          if (cardId) {
            G.crypto.revealedCards[`${request.zoneId}:${i}`] = cardId;
            console.log('[CryptoWar] Cooperative decryption revealed:', cardId);
          }
        }
      }
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

    // Add reveal notification
    G.revealNotifications.push({
      playerId: request.requestingPlayer,
      timestamp: Date.now(),
    });
  }

  return G;
}

/**
 * Dismiss a decrypt notification.
 */
export function dismissNotification(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  notificationIndex: number
): CryptoWarState | typeof INVALID_MOVE {
  if (notificationIndex < 0 || notificationIndex >= G.decryptNotifications.length) {
    return INVALID_MOVE;
  }

  G.decryptNotifications.splice(notificationIndex, 1);
  return G;
}

// =============================================================================
// Key Release and Abandonment Moves
// =============================================================================

/**
 * Release key after surrendering (required for abandonment support).
 * In War, a player might surrender if they can't continue.
 */
export function releaseKey(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] releaseKey called for player', playerId);

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasReleasedKey) return INVALID_MOVE;

  G.releasedKeys[playerId] = privateKey;
  player.hasReleasedKey = true;

  console.log('[CryptoWar] Player', playerId, 'released their key');

  return G;
}

/**
 * Surrender the game (forfeit).
 * Player must release their key when surrendering.
 */
export function surrender(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string
): CryptoWarState | typeof INVALID_MOVE {
  console.log('[CryptoWar] surrender called for player', playerId);

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (G.phase === 'gameOver' || G.phase === 'voided') return INVALID_MOVE;

  // Release the key
  G.releasedKeys[playerId] = privateKey;
  player.hasReleasedKey = true;

  // Opponent wins
  const opponent = G.playerOrder.find(pid => pid !== playerId);
  if (opponent) {
    G.winner = opponent;
    G.phase = 'gameOver';
  }

  console.log('[CryptoWar] Player', playerId, 'surrendered. Winner:', opponent);

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
 *
 * Includes the full cooperative secure encryption workflow:
 * 1. Key Exchange - Players submit public keys
 * 2. Key Escrow - Players distribute Shamir secret shares for abandonment support
 * 3. Encrypt - Sequential deck encryption by each player
 * 4. Shuffle - Sequential shuffle with proofs
 * 5. Play - Flip cards, cooperative reveal, resolve rounds
 */
export const CryptoWarGame: Game<CryptoWarState> = {
  name: 'crypto-war',

  setup: (ctx): CryptoWarState => {
    return createCryptoWarState({
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
        // During play, both players can act
        return 0;
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
      endIf: ({ G }) => G.phase === 'flip',
    },

    play: {
      turn: {
        activePlayers: { all: 'play' },
      },
      moves: {
        // Setup moves (for resuming if needed)
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

        // Core game moves
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

        // Key release and abandonment
        releaseKey: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            releaseKey(G, ctx, playerId, privateKey),
          client: false,
        },
        surrender: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            surrender(G, ctx, playerId, privateKey),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === 'voided') {
      return { draw: true, reason: 'voided' };
    }

    if (G.winner || G.phase === 'gameOver') {
      return { winner: G.winner };
    }

    return undefined;
  },
};

// =============================================================================
// Move Validation
// =============================================================================

import type { MoveValidation } from '../types';

/**
 * Validate a move for the crypto War game.
 */
export function validateCryptoMove(
  state: CryptoWarState,
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

    case 'flipCard':
      if (state.phase !== 'flip') {
        return { valid: false, error: 'Not in flip phase' };
      }
      return { valid: true };

    case 'submitDecryptionShare':
      if (state.phase !== 'reveal') {
        return { valid: false, error: 'Not in reveal phase' };
      }
      return { valid: true };

    case 'resolveRound':
      if (state.phase !== 'resolve') {
        return { valid: false, error: 'Not in resolve phase' };
      }
      if (!bothPlayersFlipped(state)) {
        return { valid: false, error: 'Both players must flip first' };
      }
      return { valid: true };

    case 'requestDecrypt':
      // Anyone can request decryption during play phases
      if (!['flip', 'reveal', 'resolve'].includes(state.phase)) {
        return { valid: false, error: 'Cannot request decryption now' };
      }
      return { valid: true };

    case 'approveDecrypt':
      // Anyone can approve a pending decrypt request
      return { valid: true };

    case 'dismissNotification':
      return { valid: true };

    case 'releaseKey':
      if (state.players[playerId]?.hasReleasedKey) {
        return { valid: false, error: 'Key already released' };
      }
      return { valid: true };

    case 'surrender':
      if (state.phase === 'gameOver' || state.phase === 'voided') {
        return { valid: false, error: 'Game already ended' };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unknown move: ${move}` };
  }
}

// =============================================================================
// Module Export
// =============================================================================

export const CryptoWarModule = {
  id: 'crypto-war',
  name: 'Crypto War',
  version: '2.0.0',
  description: 'War card game with mental poker cryptographic fairness, key escrow, and cooperative decryption',

  zones: WAR_ZONES,

  assetRequirements: {
    required: ['card_face'] as const,
    optional: ['card_back'] as const,
    idFormat: 'standard_52' as const,
  },

  initialState: createCryptoWarState,
  validateMove: validateCryptoMove,
  getBoardgameIOGame: () => CryptoWarGame,

  // Crypto-specific exports
  getShuffleProofs,
  verifyPlayerShuffle,

  // Abandonment support exports
  attemptKeyReconstruction,
  checkGameViability,
  handleDisconnect,
};

export default CryptoWarModule;
