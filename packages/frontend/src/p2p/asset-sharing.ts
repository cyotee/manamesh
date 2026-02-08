/**
 * P2P Asset Pack Sharing Protocol
 *
 * Manages the consent-based exchange of asset pack data between peers
 * during lobby/matchmaking. Supports card-only (default) and full-pack
 * transfer modes with per-player blocking and rate limiting.
 *
 * Protocol flow:
 * 1. Both players share deck lists after P2P connection
 * 2. Receiver checks for missing card IDs
 * 3. Receiver sends asset-pack-request
 * 4. Sender sees consent prompt → allow/deny/block
 * 5. If allowed, sender sends asset-pack-offer with size info
 * 6. Receiver sees accept prompt → accept/decline/block
 * 7. If accepted, sender streams chunks
 * 8. Receiver reassembles and caches in IndexedDB
 */

import type { Chunk } from './chunking';

// ---------------------------------------------------------------------------
// P2P Message Types for Asset Sharing
// ---------------------------------------------------------------------------

export type AssetSharingMessageType =
  | 'deck-list-share'
  | 'deck-list-ack'
  | 'asset-pack-request'
  | 'asset-pack-offer'
  | 'asset-pack-chunk'
  | 'asset-pack-complete'
  | 'asset-pack-denied'
  | 'asset-pack-cancel';

/** Deck list shared during lobby. */
export interface DeckListShareMessage {
  type: 'deck-list-share';
  deckList: {
    name: string;
    game: string;
    pack: string;
    leader: string;
    cards: Record<string, number>;
  };
  packMeta: {
    id: string;
    name: string;
    game: string;
    cardCount: number;
  };
}

/** Acknowledgement of received deck list with validation + missing card info. */
export interface DeckListAckMessage {
  type: 'deck-list-ack';
  valid: boolean;
  errors?: string[];
  missingCardIds?: string[];
  missingPackIds?: string[];
}

/** Request for asset pack data. */
export interface AssetPackRequestMessage {
  type: 'asset-pack-request';
  packId: string;
  mode: 'cards-only' | 'full-pack';
  /** Card IDs to include (for cards-only mode). */
  cardIds?: string[];
}

/** Offer to send asset pack data (sent after sender approves). */
export interface AssetPackOfferMessage {
  type: 'asset-pack-offer';
  packId: string;
  mode: 'cards-only' | 'full-pack';
  /** Total transfer size in bytes. */
  totalSize: number;
  /** Total number of chunks. */
  totalChunks: number;
  /** Number of cards included. */
  cardCount: number;
}

/** A chunk of asset pack data. */
export interface AssetPackChunkMessage {
  type: 'asset-pack-chunk';
  packId: string;
  chunkIndex: number;
  totalChunks: number;
  /** Base64-encoded data. */
  data: string;
}

/** Transfer complete signal. */
export interface AssetPackCompleteMessage {
  type: 'asset-pack-complete';
  packId: string;
  success: boolean;
}

/** Request denied or peer is blocked. */
export interface AssetPackDeniedMessage {
  type: 'asset-pack-denied';
  packId: string;
  reason: 'denied' | 'blocked';
}

/** Cancel an in-progress transfer. */
export interface AssetPackCancelMessage {
  type: 'asset-pack-cancel';
  packId: string;
}

export type AssetSharingMessage =
  | DeckListShareMessage
  | DeckListAckMessage
  | AssetPackRequestMessage
  | AssetPackOfferMessage
  | AssetPackChunkMessage
  | AssetPackCompleteMessage
  | AssetPackDeniedMessage
  | AssetPackCancelMessage;

// ---------------------------------------------------------------------------
// Block List (per-player, session-scoped)
// ---------------------------------------------------------------------------

export class PeerBlockList {
  private blocked = new Set<string>();
  private requestCounts = new Map<string, number>();
  private maxRequestsBeforeAutoBlock: number;

  constructor(maxRequestsBeforeAutoBlock = 3) {
    this.maxRequestsBeforeAutoBlock = maxRequestsBeforeAutoBlock;
  }

  /** Block a specific peer. */
  block(peerId: string): void {
    this.blocked.add(peerId);
  }

  /** Unblock a specific peer. */
  unblock(peerId: string): void {
    this.blocked.delete(peerId);
    this.requestCounts.delete(peerId);
  }

  /** Check if a peer is blocked. */
  isBlocked(peerId: string): boolean {
    return this.blocked.has(peerId);
  }

  /** Get list of all blocked peers. */
  getBlocked(): string[] {
    return [...this.blocked];
  }

  /**
   * Record a request from a peer. Returns true if the peer should be
   * auto-blocked (exceeded max requests).
   */
  recordRequest(peerId: string): boolean {
    const count = (this.requestCounts.get(peerId) ?? 0) + 1;
    this.requestCounts.set(peerId, count);

    if (count >= this.maxRequestsBeforeAutoBlock) {
      this.block(peerId);
      return true;
    }
    return false;
  }

  /** Reset request count for a peer (e.g., after successful transfer). */
  resetRequestCount(peerId: string): void {
    this.requestCounts.delete(peerId);
  }

  /** Clear all blocks and request counts. */
  clear(): void {
    this.blocked.clear();
    this.requestCounts.clear();
  }
}

// ---------------------------------------------------------------------------
// Transfer State Tracking
// ---------------------------------------------------------------------------

export type TransferDirection = 'sending' | 'receiving';

export type TransferStatus =
  | 'pending-consent'   // Waiting for local user to approve/accept
  | 'pending-remote'    // Waiting for remote peer to approve
  | 'transferring'      // Chunks being sent/received
  | 'complete'          // Transfer finished successfully
  | 'denied'            // Local user or remote peer denied
  | 'cancelled'         // Transfer was cancelled
  | 'error';            // Transfer failed

export interface TransferState {
  packId: string;
  peerId: string;
  direction: TransferDirection;
  mode: 'cards-only' | 'full-pack';
  status: TransferStatus;
  /** Card IDs involved (for cards-only mode). */
  cardIds?: string[];
  /** Total transfer size in bytes (known after offer). */
  totalSize?: number;
  /** Total chunks (known after offer). */
  totalChunks?: number;
  /** Chunks received/sent so far. */
  chunksCompleted: number;
  /** Timestamp when transfer started. */
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Asset Sharing Session
// ---------------------------------------------------------------------------

/**
 * Manages the asset sharing state for a single P2P session.
 * Tracks active transfers, blocked peers, and provides methods
 * to create protocol messages.
 */
export class AssetSharingSession {
  readonly blockList: PeerBlockList;
  private transfers = new Map<string, TransferState>();

  constructor(maxRequestsBeforeAutoBlock = 3) {
    this.blockList = new PeerBlockList(maxRequestsBeforeAutoBlock);
  }

  // --- Transfer management ---

  /** Get all active transfers. */
  getTransfers(): TransferState[] {
    return [...this.transfers.values()];
  }

  /** Get a specific transfer by pack ID. */
  getTransfer(packId: string): TransferState | undefined {
    return this.transfers.get(packId);
  }

  /** Start tracking a new outgoing request (we are requesting from peer). */
  startRequest(
    packId: string,
    peerId: string,
    mode: 'cards-only' | 'full-pack',
    cardIds?: string[],
  ): TransferState {
    const state: TransferState = {
      packId,
      peerId,
      direction: 'receiving',
      mode,
      status: 'pending-remote',
      cardIds,
      chunksCompleted: 0,
      startedAt: Date.now(),
    };
    this.transfers.set(packId, state);
    return state;
  }

  /** Start tracking an incoming request (peer is requesting from us). */
  startIncomingRequest(
    packId: string,
    peerId: string,
    mode: 'cards-only' | 'full-pack',
    cardIds?: string[],
  ): TransferState {
    const state: TransferState = {
      packId,
      peerId,
      direction: 'sending',
      mode,
      status: 'pending-consent',
      cardIds,
      chunksCompleted: 0,
      startedAt: Date.now(),
    };
    this.transfers.set(packId, state);
    return state;
  }

  /** Update transfer status. */
  updateTransfer(
    packId: string,
    updates: Partial<Pick<TransferState, 'status' | 'totalSize' | 'totalChunks' | 'chunksCompleted'>>,
  ): TransferState | undefined {
    const transfer = this.transfers.get(packId);
    if (!transfer) return undefined;

    Object.assign(transfer, updates);
    return transfer;
  }

  /** Remove a completed/failed transfer. */
  removeTransfer(packId: string): void {
    this.transfers.delete(packId);
  }

  // --- Message factories ---

  /** Create a deck-list-share message. */
  static createDeckListShare(
    deckList: DeckListShareMessage['deckList'],
    packMeta: DeckListShareMessage['packMeta'],
  ): DeckListShareMessage {
    return { type: 'deck-list-share', deckList, packMeta };
  }

  /** Create a deck-list-ack message. */
  static createDeckListAck(
    valid: boolean,
    errors?: string[],
    missingCardIds?: string[],
    missingPackIds?: string[],
  ): DeckListAckMessage {
    return { type: 'deck-list-ack', valid, errors, missingCardIds, missingPackIds };
  }

  /** Create an asset-pack-request message. */
  static createRequest(
    packId: string,
    mode: 'cards-only' | 'full-pack',
    cardIds?: string[],
  ): AssetPackRequestMessage {
    return { type: 'asset-pack-request', packId, mode, cardIds };
  }

  /** Create an asset-pack-offer message. */
  static createOffer(
    packId: string,
    mode: 'cards-only' | 'full-pack',
    totalSize: number,
    totalChunks: number,
    cardCount: number,
  ): AssetPackOfferMessage {
    return { type: 'asset-pack-offer', packId, mode, totalSize, totalChunks, cardCount };
  }

  /** Create an asset-pack-chunk message from a Chunk. */
  static createChunkMessage(packId: string, chunk: Chunk): AssetPackChunkMessage {
    return {
      type: 'asset-pack-chunk',
      packId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      data: chunk.data,
    };
  }

  /** Create an asset-pack-complete message. */
  static createComplete(packId: string, success: boolean): AssetPackCompleteMessage {
    return { type: 'asset-pack-complete', packId, success };
  }

  /** Create an asset-pack-denied message. */
  static createDenied(packId: string, reason: 'denied' | 'blocked'): AssetPackDeniedMessage {
    return { type: 'asset-pack-denied', packId, reason };
  }

  /** Create an asset-pack-cancel message. */
  static createCancel(packId: string): AssetPackCancelMessage {
    return { type: 'asset-pack-cancel', packId };
  }

  // --- Cleanup ---

  /** Reset all state (new session). */
  reset(): void {
    this.transfers.clear();
    this.blockList.clear();
  }
}

// ---------------------------------------------------------------------------
// Utility: Check for missing cards
// ---------------------------------------------------------------------------

/**
 * Given a deck list and a set of known card IDs, return the IDs that are missing.
 */
export function findMissingCards(
  deckCardIds: string[],
  knownCardIds: Set<string>,
): string[] {
  return deckCardIds.filter((id) => !knownCardIds.has(id));
}

/**
 * Check if an asset sharing message type is one we handle.
 */
export function isAssetSharingMessage(type: string): type is AssetSharingMessageType {
  return [
    'deck-list-share',
    'deck-list-ack',
    'asset-pack-request',
    'asset-pack-offer',
    'asset-pack-chunk',
    'asset-pack-complete',
    'asset-pack-denied',
    'asset-pack-cancel',
  ].includes(type);
}
