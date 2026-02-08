/**
 * Lobby Protocol — Lightweight message layer for pre-game communication
 *
 * Operates on top of JoinCodeConnection's raw `send(string)` / `onMessage(string)`
 * to handle deck list sharing, asset pack transfers, and ready-state coordination
 * during the lobby phase, before the boardgame.io P2PTransport is created.
 */

import type { JoinCodeConnection } from './discovery/join-code';
import {
  type AssetSharingMessage,
  isAssetSharingMessage,
} from './asset-sharing';

// ---------------------------------------------------------------------------
// Lobby control messages
// ---------------------------------------------------------------------------

export interface LobbyReadyMessage {
  type: 'lobby-ready';
  ready: boolean;
}

export type LobbyControlMessage = LobbyReadyMessage;

export type LobbyPayload = AssetSharingMessage | LobbyControlMessage;

function isLobbyControlMessage(type: string): type is LobbyControlMessage['type'] {
  return type === 'lobby-ready';
}

// ---------------------------------------------------------------------------
// Lobby message envelope
// ---------------------------------------------------------------------------

export interface LobbyMessage {
  /** Discriminator prefix so lobby messages don't collide with other protocols */
  _lobby: true;
  /** The inner message payload */
  payload: LobbyPayload;
}

// ---------------------------------------------------------------------------
// Lobby protocol adapter
// ---------------------------------------------------------------------------

export class LobbyProtocol {
  private connection: JoinCodeConnection;
  private assetListeners = new Set<(msg: AssetSharingMessage) => void>();
  private controlListeners = new Set<(msg: LobbyControlMessage) => void>();

  constructor(connection: JoinCodeConnection) {
    this.connection = connection;
  }

  /**
   * Process a raw message from the connection. Call this from the
   * connection's onMessage callback.
   *
   * Returns true if the message was a lobby protocol message (consumed),
   * false if it should be passed to other handlers.
   */
  handleRawMessage(data: string): boolean {
    try {
      const parsed = JSON.parse(data);
      if (parsed && parsed._lobby === true && parsed.payload) {
        const payload = parsed.payload;
        if (isAssetSharingMessage(payload.type)) {
          this.assetListeners.forEach((cb) => cb(payload as AssetSharingMessage));
          return true;
        }
        if (isLobbyControlMessage(payload.type)) {
          this.controlListeners.forEach((cb) => cb(payload as LobbyControlMessage));
          return true;
        }
      }
    } catch {
      // Not JSON or not a lobby message — pass through
    }
    return false;
  }

  /** Send an asset sharing message to the peer. */
  send(msg: AssetSharingMessage): void {
    const envelope: LobbyMessage = { _lobby: true, payload: msg };
    this.connection.send(JSON.stringify(envelope));
  }

  /** Send a lobby control message to the peer. */
  sendControl(msg: LobbyControlMessage): void {
    const envelope: LobbyMessage = { _lobby: true, payload: msg };
    this.connection.send(JSON.stringify(envelope));
  }

  /** Subscribe to incoming asset sharing messages. Returns unsubscribe fn. */
  onMessage(callback: (msg: AssetSharingMessage) => void): () => void {
    this.assetListeners.add(callback);
    return () => this.assetListeners.delete(callback);
  }

  /** Subscribe to lobby control messages. Returns unsubscribe fn. */
  onControl(callback: (msg: LobbyControlMessage) => void): () => void {
    this.controlListeners.add(callback);
    return () => this.controlListeners.delete(callback);
  }

  /** Remove all listeners. */
  detach(): void {
    this.assetListeners.clear();
    this.controlListeners.clear();
  }
}
