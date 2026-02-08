/**
 * useAssetSharing — React hook for P2P asset pack sharing
 *
 * Manages the AssetSharingSession lifecycle, wires P2P transport
 * callbacks to React state, and provides imperative methods for
 * the consent dialog flow.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AssetSharingSession,
  findMissingCards,
  type TransferState,
  type DeckListShareMessage,
  type AssetPackRequestMessage,
  type AssetPackOfferMessage,
  type AssetPackChunkMessage,
  type AssetPackCompleteMessage,
  type AssetPackDeniedMessage,
  type AssetPackCancelMessage,
  type AssetSharingMessage,
} from '../p2p/asset-sharing';
import { createChunkCollector } from '../p2p/chunking';
import {
  sendCardsTransfer,
  sendFullPackTransfer,
  unpackCardsOnlyBlob,
  unpackFullPackBlob,
} from '../p2p/transfer-pipeline';
import { getLoadedPack } from '../assets/loader';

/**
 * Minimal interface for sending/receiving asset sharing messages.
 * Both LobbyProtocol and P2PTransport satisfy this interface.
 */
export interface AssetSharingChannel {
  send(msg: AssetSharingMessage): void;
  onMessage(callback: (msg: AssetSharingMessage) => void): () => void;
}

// ---------------------------------------------------------------------------
// Pending consent state (what the UI needs to show dialogs)
// ---------------------------------------------------------------------------

export interface PendingSenderConsent {
  type: 'sender';
  peerId: string;
  packId: string;
  packName: string;
  mode: 'cards-only' | 'full-pack';
  cardIds?: string[];
}

export interface PendingReceiverConsent {
  type: 'receiver';
  peerId: string;
  packId: string;
  packName: string;
  mode: 'cards-only' | 'full-pack';
  totalSize: number;
  cardCount: number;
}

export type PendingConsent = PendingSenderConsent | PendingReceiverConsent;

// ---------------------------------------------------------------------------
// Missing packs info
// ---------------------------------------------------------------------------

export interface MissingPackInfo {
  packId: string;
  packName: string;
  missingCardIds: string[];
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface AssetSharingState {
  /** Active P2P transfers. */
  transfers: TransferState[];
  /** Consent dialog currently pending. */
  pendingConsent: PendingConsent | null;
  /** Missing pack info from opponent's deck. */
  missingPacks: MissingPackInfo[];
  /** Blocked peer IDs. */
  blockedPeers: string[];
  /** Peer's deck list (received during lobby). */
  peerDeckList: DeckListShareMessage['deckList'] | null;

  // --- Actions ---
  /** Share our deck list with peer. */
  shareDeckList: (
    deckList: DeckListShareMessage['deckList'],
    packMeta: DeckListShareMessage['packMeta'],
  ) => void;
  /** Request missing cards from peer. */
  requestFromPeer: (packId: string, cardIds?: string[]) => void;
  /** Allow a pending sender consent. */
  allowSenderRequest: () => void;
  /** Deny a pending sender consent. */
  denySenderRequest: () => void;
  /** Block the peer from a pending consent. */
  blockPeer: () => void;
  /** Accept a pending receiver consent (incoming data). */
  acceptReceiverOffer: () => void;
  /** Decline a pending receiver consent. */
  declineReceiverOffer: () => void;
  /** Cancel an active transfer. */
  cancelTransfer: (packId: string) => void;
  /** Unblock a peer. */
  unblockPeer: (peerId: string) => void;
  /** Dismiss missing packs notice. */
  dismissMissing: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useAssetSharing(
  channel: AssetSharingChannel | null,
  knownCardIds: Set<string>,
): AssetSharingState {
  const sessionRef = useRef(new AssetSharingSession());
  const [transfers, setTransfers] = useState<TransferState[]>([]);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  const [missingPacks, setMissingPacks] = useState<MissingPackInfo[]>([]);
  const [blockedPeers, setBlockedPeers] = useState<string[]>([]);
  const [peerDeckList, setPeerDeckList] = useState<DeckListShareMessage['deckList'] | null>(null);

  // Chunk collectors for incoming transfers (packId → collector)
  const collectorsRef = useRef(new Map<string, ReturnType<typeof createChunkCollector>>());

  const refreshTransfers = useCallback(() => {
    setTransfers([...sessionRef.current.getTransfers()]);
    setBlockedPeers(sessionRef.current.blockList.getBlocked());
  }, []);

  // --- Message handlers (defined before the useEffect that references them) ---

  const handleDeckListShare = useCallback((msg: DeckListShareMessage) => {
    setPeerDeckList(msg.deckList);

    // Check for missing cards
    const allDeckCardIds = Object.keys(msg.deckList.cards);
    const missing = findMissingCards(allDeckCardIds, knownCardIds);

    if (missing.length > 0) {
      setMissingPacks([{
        packId: msg.packMeta.id,
        packName: msg.packMeta.name,
        missingCardIds: missing,
      }]);
    }
  }, [knownCardIds]);

  const handleIncomingRequest = useCallback((msg: AssetPackRequestMessage) => {
    const session = sessionRef.current;

    // Auto-deny if blocked
    if (session.blockList.isBlocked('peer')) {
      channel?.send(
        AssetSharingSession.createDenied(msg.packId, 'blocked')
      );
      return;
    }

    // Rate-limit check
    const autoBlocked = session.blockList.recordRequest('peer');
    if (autoBlocked) {
      channel?.send(
        AssetSharingSession.createDenied(msg.packId, 'blocked')
      );
      refreshTransfers();
      return;
    }

    // Track the transfer
    session.startIncomingRequest(msg.packId, 'peer', msg.mode, msg.cardIds);

    // Show consent dialog
    setPendingConsent({
      type: 'sender',
      peerId: 'peer',
      packId: msg.packId,
      packName: msg.packId, // Could resolve to actual name if we have the pack
      mode: msg.mode,
      cardIds: msg.cardIds,
    });

    refreshTransfers();
  }, [channel, refreshTransfers]);

  const handleIncomingOffer = useCallback((msg: AssetPackOfferMessage) => {
    const session = sessionRef.current;

    // Update our transfer state
    session.updateTransfer(msg.packId, {
      totalSize: msg.totalSize,
      totalChunks: msg.totalChunks,
    });

    // Show receiver consent
    setPendingConsent({
      type: 'receiver',
      peerId: 'peer',
      packId: msg.packId,
      packName: msg.packId,
      mode: msg.mode,
      totalSize: msg.totalSize,
      cardCount: msg.cardCount,
    });

    refreshTransfers();
  }, [refreshTransfers]);

  const handleIncomingChunk = useCallback(async (msg: AssetPackChunkMessage) => {
    const session = sessionRef.current;

    // Get or create collector
    let collector = collectorsRef.current.get(msg.packId);
    if (!collector) {
      collector = createChunkCollector(msg.totalChunks, (_done, _total) => {
        session.updateTransfer(msg.packId, {
          chunksCompleted: _done,
          status: 'transferring',
        });
        refreshTransfers();
      });
      collectorsRef.current.set(msg.packId, collector);
    }

    const result = collector.addChunk({
      chunkIndex: msg.chunkIndex,
      totalChunks: msg.totalChunks,
      data: msg.data,
    });

    if (result) {
      // Transfer complete — result is a Blob
      collectorsRef.current.delete(msg.packId);

      // Determine transfer mode from the tracked transfer
      const transfer = session.getTransfer(msg.packId);
      const targetPackId = `p2p:${msg.packId}`;

      try {
        if (transfer?.mode === 'full-pack') {
          await unpackFullPackBlob(result, targetPackId);
        } else {
          await unpackCardsOnlyBlob(result, targetPackId);
        }
        session.updateTransfer(msg.packId, { status: 'complete' });
      } catch (err) {
        console.warn('[useAssetSharing] Failed to unpack received data:', err);
        session.updateTransfer(msg.packId, { status: 'error' });
      }
      refreshTransfers();
    }
  }, [refreshTransfers]);

  const handleTransferComplete = useCallback((msg: AssetPackCompleteMessage) => {
    const session = sessionRef.current;
    session.updateTransfer(msg.packId, {
      status: msg.success ? 'complete' : 'error',
    });
    refreshTransfers();
  }, [refreshTransfers]);

  const handleDenied = useCallback((msg: AssetPackDeniedMessage) => {
    const session = sessionRef.current;
    session.updateTransfer(msg.packId, { status: 'denied' });
    refreshTransfers();
  }, [refreshTransfers]);

  const handleCancel = useCallback((msg: AssetPackCancelMessage) => {
    const session = sessionRef.current;
    session.updateTransfer(msg.packId, { status: 'cancelled' });
    collectorsRef.current.delete(msg.packId);
    refreshTransfers();
  }, [refreshTransfers]);

  // Wire up channel callbacks (after handler definitions)
  useEffect(() => {
    if (!channel) return;

    const handleMessage = (msg: AssetSharingMessage) => {
      switch (msg.type) {
        case 'deck-list-share':
          handleDeckListShare(msg);
          break;
        case 'deck-list-ack':
          // We could show validation results from peer
          break;
        case 'asset-pack-request':
          handleIncomingRequest(msg);
          break;
        case 'asset-pack-offer':
          handleIncomingOffer(msg);
          break;
        case 'asset-pack-chunk':
          handleIncomingChunk(msg);
          break;
        case 'asset-pack-complete':
          handleTransferComplete(msg);
          break;
        case 'asset-pack-denied':
          handleDenied(msg);
          break;
        case 'asset-pack-cancel':
          handleCancel(msg);
          break;
      }
    };

    const unsub = channel.onMessage(handleMessage);
    return unsub;
  }, [channel, handleDeckListShare, handleIncomingRequest, handleIncomingOffer, handleIncomingChunk, handleTransferComplete, handleDenied, handleCancel]);

  // --- Actions ---

  const shareDeckList = useCallback((
    deckList: DeckListShareMessage['deckList'],
    packMeta: DeckListShareMessage['packMeta'],
  ) => {
    const msg = AssetSharingSession.createDeckListShare(deckList, packMeta);
    channel?.send(msg);
  }, [channel]);

  const requestFromPeer = useCallback((packId: string, cardIds?: string[]) => {
    const session = sessionRef.current;
    const mode: 'cards-only' | 'full-pack' = cardIds ? 'cards-only' : 'full-pack';

    session.startRequest(packId, 'peer', mode, cardIds);
    channel?.send(
      AssetSharingSession.createRequest(packId, mode, cardIds)
    );
    refreshTransfers();
  }, [channel, refreshTransfers]);

  const allowSenderRequest = useCallback(async () => {
    if (!pendingConsent || pendingConsent.type !== 'sender' || !channel) return;
    const session = sessionRef.current;
    const { packId, mode, cardIds } = pendingConsent;

    session.updateTransfer(packId, { status: 'transferring' });
    setPendingConsent(null);
    refreshTransfers();

    // Get the loaded pack data
    const pack = getLoadedPack(packId);
    if (!pack) {
      session.updateTransfer(packId, { status: 'error' });
      channel.send(AssetSharingSession.createDenied(packId, 'denied'));
      refreshTransfers();
      return;
    }

    try {
      const success = mode === 'cards-only'
        ? await sendCardsTransfer(
            channel, packId, cardIds ?? [], pack.cards,
            (done, total) => {
              session.updateTransfer(packId, { chunksCompleted: done, totalChunks: total });
              refreshTransfers();
            },
          )
        : await sendFullPackTransfer(
            channel, packId, pack.cards,
            (done, total) => {
              session.updateTransfer(packId, { chunksCompleted: done, totalChunks: total });
              refreshTransfers();
            },
          );

      session.updateTransfer(packId, { status: success ? 'complete' : 'error' });
    } catch {
      session.updateTransfer(packId, { status: 'error' });
      channel.send(AssetSharingSession.createComplete(packId, false));
    }
    refreshTransfers();
  }, [pendingConsent, channel, refreshTransfers]);

  const denySenderRequest = useCallback(() => {
    if (!pendingConsent || pendingConsent.type !== 'sender') return;
    const session = sessionRef.current;

    session.updateTransfer(pendingConsent.packId, { status: 'denied' });
    channel?.send(
      AssetSharingSession.createDenied(pendingConsent.packId, 'denied')
    );

    setPendingConsent(null);
    refreshTransfers();
  }, [pendingConsent, channel, refreshTransfers]);

  const blockPeer = useCallback(() => {
    if (!pendingConsent) return;
    const session = sessionRef.current;

    session.blockList.block(pendingConsent.peerId);

    if (pendingConsent.type === 'sender') {
      session.updateTransfer(pendingConsent.packId, { status: 'denied' });
      channel?.send(
        AssetSharingSession.createDenied(pendingConsent.packId, 'blocked')
      );
    } else {
      session.updateTransfer(pendingConsent.packId, { status: 'cancelled' });
      channel?.send(
        AssetSharingSession.createCancel(pendingConsent.packId)
      );
    }

    setPendingConsent(null);
    refreshTransfers();
  }, [pendingConsent, channel, refreshTransfers]);

  const acceptReceiverOffer = useCallback(() => {
    if (!pendingConsent || pendingConsent.type !== 'receiver') return;
    const session = sessionRef.current;

    session.updateTransfer(pendingConsent.packId, { status: 'transferring' });

    // Send ack to peer to begin chunking (using complete message with success=false as "ready")
    // In a full implementation, we'd have a dedicated "accept-offer" message type.
    // For now, the sender starts streaming chunks after sending the offer.

    setPendingConsent(null);
    refreshTransfers();
  }, [pendingConsent, refreshTransfers]);

  const declineReceiverOffer = useCallback(() => {
    if (!pendingConsent || pendingConsent.type !== 'receiver') return;
    const session = sessionRef.current;

    session.updateTransfer(pendingConsent.packId, { status: 'cancelled' });
    channel?.send(
      AssetSharingSession.createCancel(pendingConsent.packId)
    );

    setPendingConsent(null);
    refreshTransfers();
  }, [pendingConsent, channel, refreshTransfers]);

  const cancelTransfer = useCallback((packId: string) => {
    const session = sessionRef.current;
    session.updateTransfer(packId, { status: 'cancelled' });
    collectorsRef.current.delete(packId);

    channel?.send(
      AssetSharingSession.createCancel(packId)
    );

    refreshTransfers();
  }, [channel, refreshTransfers]);

  const unblockPeer = useCallback((peerId: string) => {
    sessionRef.current.blockList.unblock(peerId);
    refreshTransfers();
  }, [refreshTransfers]);

  const dismissMissing = useCallback(() => {
    setMissingPacks([]);
  }, []);

  return {
    transfers,
    pendingConsent,
    missingPacks,
    blockedPeers,
    peerDeckList,
    shareDeckList,
    requestFromPeer,
    allowSenderRequest,
    denySenderRequest,
    blockPeer,
    acceptReceiverOffer,
    declineReceiverOffer,
    cancelTransfer,
    unblockPeer,
    dismissMissing,
  };
}

