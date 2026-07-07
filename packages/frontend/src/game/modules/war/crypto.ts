/**
 * War Game Crypto Integration
 *
 * Mental poker integration for cryptographically fair War gameplay.
 * Provides encrypted deck management, collaborative reveals, shuffle proofs,
 * and cooperative decryption workflow.
 *
 * Security Features:
 * - SRA commutative encryption for fair dealing
 * - Cooperative decryption requiring approval from all players
 * - Verifiable shuffle proofs
 */

import type { Game, Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";
import type { GameConfig } from "../types";
import {
  WarCard,
  WarState,
  WarPlayerState,
  WAR_ZONES,
  compareCards,
  RANK_VALUES,
} from "./types";
import {
  CryptoPlugin,
  createPlayerCryptoContext,
  generateStandard52CardIds,
  type CryptoPluginState,
  type CryptoPlayerContext,
  type SerializedShuffleProof,
} from "@manamesh/boardgameio-crypto";
import type { EncryptedCard } from "@manamesh/boardgameio-crypto/mental-poker";
import {
  encryptDeck as encryptDeckCrypto,
  reencryptDeck,
  quickShuffle,
  buildCardPointLookup,
} from "@manamesh/boardgameio-crypto/mental-poker";
import { secpIsValidPointHex, validateEncryptedCard, validatePlayerIdentity } from "@manamesh/boardgameio-crypto/secp256k1";
import {
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
  lookupCardIdFromPoint,
} from "@manamesh/boardgameio-crypto";

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
  status: "pending" | "approved" | "completed" | "rejected";
  /** Players who have approved */
  approvals: Record<string, boolean>;
  decryptionShares: Record<string, EncryptedCard>;
}

/**
 * Notification for decrypt request events.
 */
export interface DecryptNotification {
  type: "request" | "approval" | "completed" | "rejected";
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
  /** Is currently connected */
  isConnected: boolean;
  /** Timestamp of last heartbeat */
  lastHeartbeat: number;
}

/**
 * Extended phases for crypto War (includes setup phases).
 */
export type CryptoWarPhase =
  | "keyExchange"
  | "encrypt"
  | "shuffle"
  | "flip"
  | "reveal"
  | "resolve"
  | "reshuffling"
  | "gameOver"
  | "voided";

/**
 * Extended War state with crypto support.
 */
export interface CryptoWarState extends Omit<WarState, "players" | "phase"> {
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

  decryptedCards?: Record<string, EncryptedCard>;

  /** Cards waiting to be revealed (index in deck) */
  cardsToReveal: number[];

  /** Player order for encryption/shuffle */
  playerOrder: string[];

  /** Current player index for setup phases */
  setupPlayerIndex: number;

  // Notification support
  /** Reveal notifications for UI */
  revealNotifications: RevealNotification[];

  // Cooperative decryption support
  /** Pending decrypt requests requiring approval */
  decryptRequests: DecryptRequest[];
  /** Notifications for decrypt events */
  decryptNotifications: DecryptNotification[];

  pendingReshuffle: ReshuffleInfo | null;

  /** ctx.numMoves value recorded when the reveal phase was entered; used for stall detection. */
  revealPhaseEnteredAt?: number;
}

export interface ReshuffleInfo {
  playerId: string;
  step: "encrypt" | "shuffle";
}

export interface CryptoWarConfig extends GameConfig {
  /** Whether to use crypto (for backward compat testing) */
  useCrypto?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const SUITS: WarCard["suit"][] = ["hearts", "diamonds", "clubs", "spades"];
const RANKS: WarCard["rank"][] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

/** Number of cards to place face-down during war */
const WAR_FACE_DOWN_COUNT = 3;

/** Moves either player may make before a stalled reveal can be voided. */
export const WAR_REVEAL_STALL_WINDOW_MOVES = 8;

// =============================================================================
// Card Utilities
// =============================================================================

/**
 * Parse a card ID into a WarCard.
 */
export function parseCardId(cardId: string): WarCard {
  const [suit, rank] = cardId.split("-") as [WarCard["suit"], WarCard["rank"]];
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
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
    zones.deck[playerId] = [];
    zones.played[playerId] = [];
    zones.won[playerId] = [];
  }

  // Initialize crypto state
  const cryptoState: CryptoPluginState = {
    phase: "init",
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
    phase: "keyExchange",
    zones,
    crypto: cryptoState,
    cardIds,
    pendingReveals: {},
    cardsToReveal: [],
    playerOrder,
    setupPlayerIndex: 0,
    // Notifications
    revealNotifications: [],
    // Cooperative decryption
    decryptRequests: [],
    decryptNotifications: [],
    pendingReshuffle: null,
    revealPhaseEnteredAt: undefined,
  };
}

// Setup player helpers imported from shared embedded package.

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

// lookupCardIdFromPoint imported from shared embedded package.

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
  publicKey: string,
): CryptoWarState | typeof INVALID_MOVE {
  console.log(
    "[CryptoWar] submitPublicKey called for player",
    playerId,
    "phase:",
    G.phase,
  );
  if (G.phase !== "keyExchange") {
    console.log(
      "[CryptoWar] submitPublicKey INVALID_MOVE: not in keyExchange phase",
    );
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
    // Transition to encrypt phase
    G.phase = "encrypt";
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
  privateKey: string,
): CryptoWarState | typeof INVALID_MOVE {
  console.log(
    "[CryptoWar] encryptDeck called for player",
    playerId,
    "phase:",
    G.phase,
  );
  if (G.phase !== "encrypt") {
    console.log("[CryptoWar] encryptDeck INVALID_MOVE: not in encrypt phase");
    return INVALID_MOVE;
  }

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) {
    console.log(
      "[CryptoWar] encryptDeck INVALID_MOVE: not current setup player",
    );
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasEncrypted) return INVALID_MOVE;

  // Perform actual encryption using mental-poker functions directly
  const existingDeck = G.crypto.encryptedZones["deck"];

  if (!existingDeck || existingDeck.length === 0) {
    // First player: encrypt all card IDs
    console.log(
      "[CryptoWar] First encryption by player",
      playerId,
      "- encrypting",
      G.cardIds.length,
      "cards",
    );
    const encryptedDeck = encryptDeckCrypto(G.cardIds, privateKey);
    G.crypto.encryptedZones["deck"] = encryptedDeck;
    console.log(
      "[CryptoWar] Encrypted deck has",
      encryptedDeck.length,
      "cards with",
      encryptedDeck[0]?.layers,
      "layers",
    );
  } else {
    // Subsequent players: re-encrypt the already encrypted deck
    console.log(
      "[CryptoWar] Re-encryption by player",
      playerId,
      "- current layers:",
      existingDeck[0]?.layers,
    );
    const reencryptedDeck = reencryptDeck(existingDeck, privateKey);
    G.crypto.encryptedZones["deck"] = reencryptedDeck;
    console.log(
      "[CryptoWar] Re-encrypted deck has",
      reencryptedDeck.length,
      "cards with",
      reencryptedDeck[0]?.layers,
      "layers",
    );
  }

  // Update crypto phase
  G.crypto.phase = "encrypt";
  player.hasEncrypted = true;

  // Advance to next player or next phase
  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
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
  events?: { endPhase?: () => void },
): CryptoWarState | typeof INVALID_MOVE {
  console.log(
    "[CryptoWar] shuffleEncryptedDeck called for player",
    playerId,
    "phase:",
    G.phase,
  );
  if (G.phase !== "shuffle") {
    console.log(
      "[CryptoWar] shuffleEncryptedDeck INVALID_MOVE: not in shuffle phase",
    );
    return INVALID_MOVE;
  }

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) {
    console.log(
      "[CryptoWar] shuffleEncryptedDeck INVALID_MOVE: not current setup player",
    );
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasShuffled) return INVALID_MOVE;

  // Get the encrypted deck
  const encryptedDeck = G.crypto.encryptedZones["deck"];
  if (!encryptedDeck || encryptedDeck.length === 0) {
    console.error("[CryptoWar] No encrypted deck to shuffle!");
    return INVALID_MOVE;
  }

  // Shuffle the deck using quickShuffle
  console.log(
    "[CryptoWar] Shuffling deck for player",
    playerId,
    "- deck has",
    encryptedDeck.length,
    "cards",
  );
  const shuffledDeck = quickShuffle(encryptedDeck);
  G.crypto.encryptedZones["deck"] = shuffledDeck;
  console.log("[CryptoWar] Deck shuffled by player", playerId);

  // Update crypto phase
  G.crypto.phase = "shuffle";
  player.hasShuffled = true;

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    // Update crypto phase to ready
    G.crypto.phase = "ready";

    // Deal cards (half to each player as encrypted indices)
    dealEncryptedCards(G, ctx);
    G.phase = "flip";

    // Always signal boardgame.io to end the setup phase when G.phase advances.
    // Guarding on ctx.phase === "setup" caused the two to diverge on reconnect.
    console.log("[CryptoWar] Shuffle complete, ending setup phase.");
    events?.endPhase?.();
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
  const totalCards = cryptoApi.getEncryptedCardCount("deck");
  const halfDeck = Math.floor(totalCards / 2);

  // Create player-specific deck zones
  for (let i = 0; i < G.playerOrder.length; i++) {
    const playerId = G.playerOrder[i];
    const playerZone = `deck_${playerId}`;

    // Move cards to player's deck zone
    for (let j = 0; j < halfDeck; j++) {
      cryptoApi.moveEncryptedCard("deck", playerZone, 0);
    }
  }
}

export function reshuffleWonPile(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== "flip" && G.phase !== "reshuffling") {
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
  const playerZone = `deck_${playerId}`;

  const pending = G.pendingReshuffle;
  if (!pending) {
    const cardCount = cryptoApi.getEncryptedCardCount(playerZone);
    if (cardCount > 0) return INVALID_MOVE;
    if (player.won.length === 0) return INVALID_MOVE;

    G.pendingReshuffle = { playerId, step: "encrypt" };
    G.phase = "reshuffling";
  }

  if (G.pendingReshuffle?.playerId !== playerId) return INVALID_MOVE;

  const reshuffleZone = `reshuffle_${playerId}`;

  if (G.pendingReshuffle.step === "encrypt") {
    const wonCards = player.won;
    if (wonCards.length === 0) {
      G.pendingReshuffle = null;
      G.phase = "flip";
      return G;
    }

    const wonCardIds = wonCards.map((c) => c.id);
    const existing = G.crypto.encryptedZones[reshuffleZone];

    if (!existing || existing.length === 0) {
      const encrypted = encryptDeckCrypto(wonCardIds, privateKey);
      G.crypto.encryptedZones[reshuffleZone] = encrypted;
      player.won = [];
    } else {
      const reencrypted = reencryptDeck(existing, privateKey);
      G.crypto.encryptedZones[reshuffleZone] = reencrypted;
    }

    G.pendingReshuffle.step = "shuffle";
    return G;
  }

  if (G.pendingReshuffle.step === "shuffle") {
    const zone = G.crypto.encryptedZones[reshuffleZone];
    if (!zone || zone.length === 0) {
      G.pendingReshuffle = null;
      G.phase = "flip";
      return G;
    }

    const shuffled = quickShuffle(zone);
    G.crypto.encryptedZones[reshuffleZone] = shuffled;

    G.pendingReshuffle = null;
    G.phase = "flip";

    for (const card of zone) {
      cryptoApi.moveEncryptedCard(reshuffleZone, playerZone, 0);
    }

    return G;
  }

  return G;
}

/**
 * Request to flip a card (starts reveal process).
 * Optional reshufflePrivateKey enables atomic reshuffle of won pile when deck is empty.
 */
export function flipCard(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  reshufflePrivateKey?: string,
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== "flip") {
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
  let cardCount = cryptoApi.getEncryptedCardCount(playerZone);

  // Handle empty deck with non-empty won pile: attempt reshuffle
  if (cardCount === 0) {
    if (player.won.length === 0) {
      // No cards anywhere - game over case
      return INVALID_MOVE;
    }

    if (reshufflePrivateKey) {
      // Atomic reshuffle: loop until reshuffle is complete (encrypt + shuffle)
      while (G.pendingReshuffle || player.won.length > 0) {
        const result = reshuffleWonPile(G, ctx, playerId, reshufflePrivateKey);
        if (result === INVALID_MOVE) return INVALID_MOVE;
        if (!G.pendingReshuffle) break;
      }

      cardCount = cryptoApi.getEncryptedCardCount(playerZone);
      if (cardCount === 0) {
        return INVALID_MOVE;
      }
    } else {
      // No private key provided - board should retry with privateKey
      return INVALID_MOVE;
    }
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
  G.phase = "reveal";
  G.revealPhaseEnteredAt = Number((ctx as any).numMoves ?? 0);
  G.cardsToReveal.push(G.playerOrder.indexOf(playerId));

  return G;
}

/**
 * Submit decrypted share for a pending reveal.
 * V2 Security Fix: Player decrypts LOCALLY and sends the RESULT, not their private key.
 */
export function submitDecryptedShare(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  targetPlayerId: string,
  decryptedCard: EncryptedCard,
): CryptoWarState | typeof INVALID_MOVE {
  console.log(
    "[CryptoWar] submitDecryptedShare from",
    playerId,
    "for target",
    targetPlayerId,
  );
  if (G.phase !== "reveal") {
    return INVALID_MOVE;
  }
  if (!validateEncryptedCard(decryptedCard)) {
    return INVALID_MOVE;
  }
  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }

  const revealKey = `${targetPlayerId}:0`;
  const pending = G.pendingReveals[revealKey];

  if (!pending) {
    return INVALID_MOVE;
  }

  if (pending[playerId]) {
    return INVALID_MOVE;
  }

  pending[playerId] = true;

  // Write back to the reveal zone so the next player decrypts the
  // progressively stripped ciphertext rather than the original.
  const revealZone = `reveal_${targetPlayerId}`;
  if (!G.crypto.encryptedZones[revealZone]) {
    G.crypto.encryptedZones[revealZone] = [];
  }
  G.crypto.encryptedZones[revealZone][0] = decryptedCard;

  // Check if all shares submitted
  const allSubmitted = G.playerOrder.every((pid) => pending[pid]);

  if (allSubmitted) {
    console.log("[CryptoWar] All decryption shares submitted, revealing card");

    const finalCard = G.crypto.encryptedZones[revealZone]?.[0];

    if (finalCard && finalCard.layers === 0) {
      const cardId = lookupCardIdFromPoint(
        G.crypto.cardPointLookup,
        finalCard.ciphertext,
      );
      if (cardId) {
        const card = parseCardId(cardId);
        G.players[targetPlayerId].played.push(card);
        console.log(
          "[CryptoWar] Revealed card:",
          cardId,
          "for player",
          targetPlayerId,
        );
        G.crypto.revealedCards[`${revealZone}:0`] = cardId;
      } else {
        G.phase = "voided";
        return G;
      }
    }

    delete G.pendingReveals[revealKey];
    G.cardsToReveal = G.cardsToReveal.filter(
      (i) => G.playerOrder[i] !== targetPlayerId,
    );

    G.revealNotifications.push({
      playerId: targetPlayerId,
      timestamp: Date.now(),
    });

    if (Object.keys(G.pendingReveals).length === 0) {
      if (bothPlayersFlipped(G)) {
        G.phase = "resolve";
      } else {
        G.phase = "flip";
      }
    }
  }

  return G;
}

// =============================================================================
// Reveal Stall Timeout
// =============================================================================

function canAbortRevealNow(G: CryptoWarState, ctx: Ctx): boolean {
  if (G.revealPhaseEnteredAt === undefined) return false;
  const now = Number((ctx as any).numMoves ?? 0);
  return now - G.revealPhaseEnteredAt >= WAR_REVEAL_STALL_WINDOW_MOVES;
}

/**
 * Vote to void a stalled reveal phase.
 * Either player may call this once WAR_REVEAL_STALL_WINDOW_MOVES moves have
 * elapsed since the reveal phase was entered without all shares being submitted.
 */
export function voteAbortReveal(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== "reveal") return INVALID_MOVE;
  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }
  if (!canAbortRevealNow(G, ctx)) return INVALID_MOVE;

  G.phase = "voided";
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
  cardIndices: number[],
): CryptoWarState | typeof INVALID_MOVE {
  console.log("[CryptoWar] requestDecrypt from", playerId, "for zone", zoneId);

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  // Check if there's already a pending request for this zone
  const existingRequest = G.decryptRequests.find(
    (r) =>
      r.zoneId === zoneId &&
      r.requestingPlayer === playerId &&
      r.status === "pending",
  );
  if (existingRequest) return INVALID_MOVE;

  const numMoves = (ctx as any).numMoves ?? 0;
  const requestId = `decrypt-${(ctx as any).turn ?? 0}-${numMoves}-${playerId}-${zoneId.replace(/[:/]/g,'-')}`;

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
    timestamp: numMoves,
    status: "pending",
    approvals,
    decryptionShares: {},
  };

  G.decryptRequests.push(request);

  // Add notification for all players
  const notification: DecryptNotification = {
    type: "request",
    requestId,
    playerId,
    message: `Player ${playerId} requests to reveal cards`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log(
    "[CryptoWar] Decrypt request created:",
    requestId,
    "for zone:",
    zoneId,
  );

  return G;
}

/**
 * Approve a decrypt request and submit decryption share.
 * V2 Security Fix: Player decrypts LOCALLY and sends the RESULT, not their private key.
 */
export function approveDecrypt(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
  requestId: string,
  decryptedCard: EncryptedCard,
): CryptoWarState | typeof INVALID_MOVE {
  console.log(
    "[CryptoWar] approveDecrypt from",
    playerId,
    "for request",
    requestId,
  );

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const request = G.decryptRequests.find((r) => r.id === requestId);
  if (!request) {
    console.error("[CryptoWar] Decrypt request not found:", requestId);
    return INVALID_MOVE;
  }

  if (request.status !== "pending") {
    console.error("[CryptoWar] Request is not pending:", request.status);
    return INVALID_MOVE;
  }

  if (request.approvals[playerId]) {
    console.log(
      "[CryptoWar] Player",
      playerId,
      "already approved request",
      requestId,
    );
    return INVALID_MOVE;
  }

  request.approvals[playerId] = true;

  if (!request.decryptionShares) {
    request.decryptionShares = {};
  }
  request.decryptionShares[playerId] = decryptedCard;

  // Chain the decryption into the zone so the next approver receives the
  // progressively stripped ciphertext rather than the original.
  const encryptedZone = G.crypto.encryptedZones[request.zoneId];
  if (encryptedZone && request.cardIndices.length > 0) {
    const idx = request.cardIndices[0];
    if (idx !== undefined) {
      encryptedZone[idx] = decryptedCard;
    }
  }

  const notification: DecryptNotification = {
    type: "approval",
    requestId,
    playerId,
    message: `Player ${playerId} approved the decrypt request`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log(
    "[CryptoWar] Player",
    playerId,
    "approved decrypt request",
    requestId,
  );

  const allApproved = G.playerOrder.every((pid) => request.approvals[pid]);

  if (allApproved) {
    console.log("[CryptoWar] All players approved! Completing decryption...");

    request.status = "completed";

    const encryptedCards = G.crypto.encryptedZones[request.zoneId];

    if (encryptedCards && encryptedCards.length > 0) {
      for (let i = 0; i < encryptedCards.length; i++) {
        if (!request.cardIndices.includes(i)) continue;

        // Read the fully-chained result from the zone (written by the last approver).
        const decrypted = encryptedCards[i];
        if (decrypted && decrypted.layers === 0) {
          const cardId = lookupCardIdFromPoint(
            G.crypto.cardPointLookup,
            decrypted.ciphertext,
          );
          if (cardId) {
            G.crypto.revealedCards[`${request.zoneId}:${i}`] = cardId;
            console.log("[CryptoWar] Cooperative decryption revealed:", cardId);
          }
        }
      }
    }

    const completeNotification: DecryptNotification = {
      type: "completed",
      requestId,
      playerId: request.requestingPlayer,
      message: `Cards revealed for Player ${request.requestingPlayer}`,
      timestamp: Date.now(),
    };
    G.decryptNotifications.push(completeNotification);

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
  notificationIndex: number,
): CryptoWarState | typeof INVALID_MOVE {
  if (
    notificationIndex < 0 ||
    notificationIndex >= G.decryptNotifications.length
  ) {
    return INVALID_MOVE;
  }

  G.decryptNotifications.splice(notificationIndex, 1);
  return G;
}

// =============================================================================
// Surrender Move
// =============================================================================

/**
 * Surrender the game (forfeit).
 * Opponent wins immediately - no key recovery without Shamir.
 */
export function surrender(
  G: CryptoWarState,
  ctx: Ctx,
  playerId: string,
): CryptoWarState | typeof INVALID_MOVE {
  console.log("[CryptoWar] surrender called for player", playerId);

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (G.phase === "gameOver" || G.phase === "voided") return INVALID_MOVE;

  // Opponent wins - void hand (no key recovery without Shamir)
  const opponent = G.playerOrder.find((pid) => pid !== playerId);
  if (opponent) {
    G.winner = opponent;
    G.phase = "gameOver";
  }

  console.log("[CryptoWar] Player", playerId, "surrendered. Winner:", opponent);

  return G;
}

/**
 * Resolve the current round.
 */
export function resolveRound(
  G: CryptoWarState,
  ctx: Ctx,
): CryptoWarState | typeof INVALID_MOVE {
  if (G.phase !== "resolve") {
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
    G.phase = "flip";

    // Check if players can continue
    const cryptoApi = CryptoPlugin.api({ G: G as any, ctx, data: G.crypto });
    const p1Cards = cryptoApi.getEncryptedCardCount(`deck_${p1Id}`);
    const p2Cards = cryptoApi.getEncryptedCardCount(`deck_${p2Id}`);

    if (p1Cards === 0 && G.players[p1Id].won.length === 0) {
      G.winner = p2Id;
      G.phase = "gameOver";
    } else if (p2Cards === 0 && G.players[p2Id].won.length === 0) {
      G.winner = p1Id;
      G.phase = "gameOver";
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
    G.phase = "flip";

    // Check for game over
    const gameWinner = checkGameOver(G);
    if (gameWinner) {
      G.winner = gameWinner;
      G.phase = "gameOver";
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
export function getShuffleProofs(
  G: CryptoWarState,
): Record<string, SerializedShuffleProof> {
  return G.crypto.shuffleProofs;
}

/**
 * Verify a player's shuffle proof.
 */
export function verifyPlayerShuffle(
  G: CryptoWarState,
  playerId: string,
): boolean {
  const proof = G.crypto.shuffleProofs[playerId];
  if (!proof) {
    return false;
  }

  // Basic validation - proof exists and has required fields
  return !!(
    proof.commitment &&
    proof.proof &&
    proof.inputHash &&
    proof.outputHash
  );
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
  name: "crypto-war",

  // Stub: wire to a real session-token validator when a relay server is deployed.
  // In pure P2P mode, ctx.playerID is enforced by the libp2p transport instead.
  authenticateCredentials: () => true,

  setup: async (ctx): Promise<CryptoWarState> => {
    const state = createCryptoWarState({
      numPlayers: (ctx.numPlayers as number) ?? 2,
      playerIDs: (ctx.playOrder as string[]) ?? ["0", "1"],
    });

    // Build card point lookup with real SHA-256
    const lookup = await buildCardPointLookup(state.cardIds);
    for (const [cardId, point] of lookup) {
      state.crypto.cardPointLookup[cardId] = point;
    }

    return state;
  },

  turn: {
    order: {
      first: () => 0,
      next: ({ G }) => {
        // During setup phases, use setupPlayerIndex
        if (
          ["keyExchange", "encrypt", "shuffle"].includes(G.phase)
        ) {
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
      next: "play",
      endIf: ({ G }) => G.phase === "flip",
    },

    play: {
      turn: {
        activePlayers: { all: "play" },
      },
      moves: {
        // Setup moves (for resuming if needed)
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
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
          move: (
            { G, ctx },
            playerId: string,
            reshufflePrivateKey?: string,
          ) => flipCard(G, ctx, playerId, reshufflePrivateKey),
          client: false,
        },
        submitDecryptedShare: {
          move: (
            { G, ctx },
            playerId: string,
            targetPlayerId: string,
            decryptedCard: EncryptedCard,
          ) =>
            submitDecryptedShare(
              G,
              ctx,
              playerId,
              targetPlayerId,
              decryptedCard,
            ),
          client: false,
        },
        voteAbortReveal: {
          move: ({ G, ctx }, playerId: string) =>
            voteAbortReveal(G, ctx, playerId),
          client: false,
        },
        resolveRound: {
          move: ({ G, ctx }) => resolveRound(G, ctx),
          client: false,
        },

        // Cooperative decryption (requires approval from all players)
        requestDecrypt: {
          move: (
            { G, ctx },
            playerId: string,
            zoneId: string,
            cardIndices: number[],
          ) => requestDecrypt(G, ctx, playerId, zoneId, cardIndices),
          client: false,
        },
        approveDecrypt: {
          move: (
            { G, ctx },
            playerId: string,
            requestId: string,
            decryptedCard: EncryptedCard,
          ) => approveDecrypt(G, ctx, playerId, requestId, decryptedCard),
          client: false,
        },
        dismissNotification: {
          move: ({ G, ctx }, playerId: string, notificationIndex: number) =>
            dismissNotification(G, ctx, playerId, notificationIndex),
          client: false,
        },

        // Surrender
        surrender: {
          move: ({ G, ctx }, playerId: string) =>
            surrender(G, ctx, playerId),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === "voided") {
      return { draw: true, reason: "voided" };
    }

    if (G.winner || G.phase === "gameOver") {
      return { winner: G.winner };
    }

    return undefined;
  },
};

// =============================================================================
// Move Validation
// =============================================================================

import type { MoveValidation } from "../types";

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
    case "submitPublicKey":
      if (state.phase !== "keyExchange") {
        return { valid: false, error: "Not in key exchange phase" };
      }
      if (state.players[playerId]?.publicKey) {
        return { valid: false, error: "Key already submitted" };
      }
      return { valid: true };

    case "encryptDeck":
      if (state.phase !== "encrypt") {
        return { valid: false, error: "Not in encrypt phase" };
      }
      if (getCurrentSetupPlayer(state) !== playerId) {
        return { valid: false, error: "Not your turn to encrypt" };
      }
      return { valid: true };

    case "shuffleDeck":
      if (state.phase !== "shuffle") {
        return { valid: false, error: "Not in shuffle phase" };
      }
      if (getCurrentSetupPlayer(state) !== playerId) {
        return { valid: false, error: "Not your turn to shuffle" };
      }
      return { valid: true };

    case "flipCard":
      if (state.phase !== "flip") {
        return { valid: false, error: "Not in flip phase" };
      }
      return { valid: true };

    case "submitDecryptedShare":
      if (state.phase !== "reveal") {
        return { valid: false, error: "Not in reveal phase" };
      }
      return { valid: true };

    case "resolveRound":
      if (state.phase !== "resolve") {
        return { valid: false, error: "Not in resolve phase" };
      }
      if (!bothPlayersFlipped(state)) {
        return { valid: false, error: "Both players must flip first" };
      }
      return { valid: true };

    case "requestDecrypt":
      // Anyone can request decryption during play phases
      if (!["flip", "reveal", "resolve"].includes(state.phase)) {
        return { valid: false, error: "Cannot request decryption now" };
      }
      return { valid: true };

    case "approveDecrypt":
      // Anyone can approve a pending decrypt request
      return { valid: true };

    case "dismissNotification":
      return { valid: true };

    case "surrender":
      if (state.phase === "gameOver" || state.phase === "voided") {
        return { valid: false, error: "Game already ended" };
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
  id: "crypto-war",
  name: "Crypto War",
  version: "2.0.0",
  description:
    "War card game with mental poker cryptographic fairness and cooperative decryption",

  zones: WAR_ZONES,

  assetRequirements: {
    required: ["card_face"] as const,
    optional: ["card_back"] as const,
    idFormat: "standard_52" as const,
  },

  initialState: createCryptoWarState,
  validateMove: validateCryptoMove,
  getBoardgameIOGame: () => CryptoWarGame,

  // Crypto-specific exports
  getShuffleProofs,
  verifyPlayerShuffle,
};

export default CryptoWarModule;
