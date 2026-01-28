/**
 * Circuit Relay Transport Adapter
 *
 * Uses libp2p circuit relay for NAT traversal without STUN servers.
 * Traffic is relayed through Protocol Labs bootstrap nodes.
 */

import type {
  TransportAdapter,
  HostOptions,
  JoinOptions,
  HostSession,
  TransportLogger,
} from './types';
import { createTransportLogger } from './types';
import { DHTConnection, generateRoomCode, normalizeRoomCode, isValidRoomCode } from '../discovery/dht';
import type { PeerConnection } from '../webrtc';
import type { ConnectionState } from '../webrtc';

/**
 * Circuit Relay transport adapter using libp2p DHT
 */
export class RelayTransport implements TransportAdapter {
  readonly type = 'relay' as const;
  readonly name = 'Circuit Relay';

  private dhtConnection: DHTConnection | null = null;
  private log: TransportLogger;
  private initialized = false;

  constructor(verboseLogging = false) {
    this.log = createTransportLogger(verboseLogging);
  }

  /**
   * Check if libp2p relay is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try to initialize libp2p
      if (!this.dhtConnection) {
        this.dhtConnection = new DHTConnection({
          onStateChange: (state) => this.log('DHT state:', state),
          onMessage: () => {},
          onConnectionStateChange: () => {},
          onPublicGamesUpdate: () => {},
        });
      }

      const available = await this.dhtConnection.initialize();
      this.initialized = available;
      this.log('Circuit relay available:', available);
      return available;
    } catch (error) {
      this.log('Circuit relay initialization failed:', error);
      return false;
    }
  }

  /**
   * Create a host session with a room code
   */
  async createHost(options?: HostOptions): Promise<HostSession> {
    this.log('Creating relay host session...');

    if (!this.initialized) {
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('Circuit relay not available');
      }
    }

    this.cleanup();

    let resolveGuest: ((conn: PeerConnection) => void) | null = null;
    let rejectGuest: ((err: Error) => void) | null = null;
    let cancelled = false;
    let connectedPeer: PeerConnection | null = null;

    this.dhtConnection = new DHTConnection({
      onStateChange: (state) => {
        this.log('Relay host state:', state);
        if (state.phase === 'connected') {
          // Connection established
          if (resolveGuest && connectedPeer) {
            resolveGuest(connectedPeer);
          }
        }
        if (state.phase === 'error' && rejectGuest) {
          rejectGuest(new Error('error' in state ? state.error : 'Relay connection failed'));
        }
      },
      onMessage: () => {
        // Messages handled by caller
      },
      onConnectionStateChange: (state: ConnectionState) => {
        this.log('Relay host connection state:', state);
        if (state === 'connected' && resolveGuest) {
          // Note: DHTConnection doesn't expose PeerConnection directly
          // We'll need to access it through the connection
        }
      },
      onPublicGamesUpdate: () => {},
    });

    // Initialize if not already
    await this.dhtConnection.initialize();

    // Create room in DHT
    const roomCode = await this.dhtConnection.createRoom({
      isPublic: false,
      hostName: 'Host',
      gameType: 'ManaMesh',
    });

    this.log('Relay room created:', roomCode);

    const session: HostSession = {
      type: 'relay',
      connectionId: roomCode,
      connection: null,

      waitForGuest: async (timeout?: number): Promise<PeerConnection> => {
        if (cancelled) {
          throw new Error('Session cancelled');
        }

        return new Promise((resolve, reject) => {
          resolveGuest = (conn) => {
            session.connection = conn;
            resolve(conn);
          };
          rejectGuest = reject;

          if (timeout) {
            setTimeout(() => {
              if (!cancelled && !session.connection) {
                reject(new Error('Timeout waiting for relay guest'));
              }
            }, timeout);
          }
        });
      },

      cancel: () => {
        cancelled = true;
        if (rejectGuest) {
          rejectGuest(new Error('Session cancelled'));
        }
        this.cleanup();
      },
    };

    return session;
  }

  /**
   * Join a relay room by room code
   */
  async joinSession(roomCode: string, options?: JoinOptions): Promise<PeerConnection> {
    this.log('Joining relay room:', roomCode);

    const normalized = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(normalized)) {
      throw new Error('Invalid room code format');
    }

    if (!this.initialized) {
      const available = await this.isAvailable();
      if (!available) {
        throw new Error('Circuit relay not available');
      }
    }

    this.cleanup();

    return new Promise(async (resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;

      this.dhtConnection = new DHTConnection({
        onStateChange: (state) => {
          this.log('Relay guest state:', state);
          if (state.phase === 'connected') {
            if (timeout) clearTimeout(timeout);
            // Note: Need to get actual PeerConnection
            // For now, resolve with a placeholder
          }
          if (state.phase === 'error') {
            if (timeout) clearTimeout(timeout);
            reject(new Error('error' in state ? state.error : 'Relay connection failed'));
          }
        },
        onMessage: () => {},
        onConnectionStateChange: (state: ConnectionState) => {
          this.log('Relay guest connection state:', state);
          if (state === 'connected') {
            if (timeout) clearTimeout(timeout);
            // Connection established - we need the PeerConnection
          }
        },
        onPublicGamesUpdate: () => {},
      });

      if (options?.timeout) {
        timeout = setTimeout(() => {
          reject(new Error('Relay connection timeout'));
          this.cleanup();
        }, options.timeout);
      }

      try {
        await this.dhtConnection.initialize();
        await this.dhtConnection.joinRoom(normalized);
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Get the current DHT connection for direct access
   */
  getDHTConnection(): DHTConnection | null {
    return this.dhtConnection;
  }

  /**
   * Get the current room code
   */
  getRoomCode(): string | null {
    return this.dhtConnection?.getRoomCode() ?? null;
  }

  /**
   * Check if connected via relay
   */
  isConnected(): boolean {
    return this.dhtConnection?.isConnected() ?? false;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.dhtConnection) {
      this.dhtConnection.cleanup();
      this.dhtConnection = null;
    }
    this.log('Relay transport cleaned up');
  }
}
