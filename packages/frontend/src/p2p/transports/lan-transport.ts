/**
 * LAN Transport Adapter
 *
 * Uses mDNS/local discovery for same-network connections.
 * No NAT traversal or STUN servers needed.
 */

import type {
  TransportAdapter,
  HostOptions,
  JoinOptions,
  HostSession,
  TransportLogger,
} from './types';
import { createTransportLogger } from './types';
import { MDNSDiscovery, type LANGame } from '../discovery/mdns';
import { PeerConnection, type PeerConnectionEvents } from '../webrtc';
import { encodeOffer, decodeOffer } from '../codec';

// ICE servers for LAN - no STUN needed for same-network connections
const LAN_ICE_SERVERS: RTCIceServer[] = [];

/**
 * Create a peer connection without STUN servers (LAN only)
 */
function createLANPeerConnection(events: PeerConnectionEvents): PeerConnection {
  // Create with empty ICE servers for LAN-only connections
  // The PeerConnection class uses its own ICE config, so we'll
  // need to modify it to accept custom ICE servers
  return new PeerConnection(events);
}

/**
 * LAN transport adapter using mDNS-like discovery
 */
export class LANTransport implements TransportAdapter {
  readonly type = 'lan' as const;
  readonly name = 'LAN / Local Network';

  private discovery: MDNSDiscovery | null = null;
  private connection: PeerConnection | null = null;
  private log: TransportLogger;

  constructor(verboseLogging = false) {
    this.log = createTransportLogger(verboseLogging);
  }

  /**
   * Check if LAN discovery is available
   */
  async isAvailable(): Promise<boolean> {
    // Check for mDNS support
    const supported = MDNSDiscovery.isSupported();
    const mode = MDNSDiscovery.getMode();
    this.log(`LAN discovery mode: ${mode}, supported: ${supported}`);
    return supported;
  }

  /**
   * Create a host session that broadcasts on LAN
   */
  async createHost(options?: HostOptions): Promise<HostSession> {
    this.log('Creating LAN host session...');
    this.cleanup();

    let resolveGuest: ((conn: PeerConnection) => void) | null = null;
    let rejectGuest: ((err: Error) => void) | null = null;
    let cancelled = false;
    let hostedGame: LANGame | null = null;

    // Create mDNS discovery
    this.discovery = new MDNSDiscovery({
      onGameFound: (game) => {
        this.log('Found game on LAN:', game);
      },
      onGameLost: (gameId) => {
        this.log('Lost game on LAN:', gameId);
      },
      onError: (error) => {
        this.log('LAN discovery error:', error);
        if (rejectGuest) {
          rejectGuest(error);
        }
      },
    });

    // Create WebRTC offer for the LAN game
    this.connection = createLANPeerConnection({
      onStateChange: (state) => {
        this.log('LAN host connection state:', state);
        if (state === 'connected' && resolveGuest && this.connection) {
          resolveGuest(this.connection);
        }
        if (state === 'failed' && rejectGuest) {
          rejectGuest(new Error('LAN connection failed'));
        }
      },
      onMessage: () => {
        // Messages handled by caller
      },
      onError: (error) => {
        this.log('LAN host error:', error);
        if (rejectGuest) {
          rejectGuest(error);
        }
      },
    });

    // Create offer
    const offer = await this.connection.createOffer();
    const offerCode = await encodeOffer(offer);

    // Host the game on LAN with the offer embedded
    hostedGame = await this.discovery.hostGame(
      'ManaMesh Game',
      'Host',
      2 // maxPlayers
    );

    // Store offer in the game data (via localStorage for now)
    const gameWithOffer = { ...hostedGame, offer: offerCode };
    localStorage.setItem(`manamesh_lan_offer_${hostedGame.id}`, offerCode);

    this.log('LAN game hosted:', hostedGame.id);

    const session: HostSession = {
      type: 'lan',
      connectionId: hostedGame.id,
      connection: null,

      waitForGuest: async (timeout?: number): Promise<PeerConnection> => {
        if (cancelled) {
          throw new Error('Session cancelled');
        }

        return new Promise((resolve, reject) => {
          resolveGuest = resolve;
          rejectGuest = reject;

          if (timeout) {
            setTimeout(() => {
              if (!cancelled && !session.connection) {
                reject(new Error('Timeout waiting for LAN guest'));
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
   * Join a LAN game by its game ID
   */
  async joinSession(gameId: string, options?: JoinOptions): Promise<PeerConnection> {
    this.log('Joining LAN game:', gameId);
    this.cleanup();

    return new Promise(async (resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;

      try {
        // Get the offer from localStorage (mDNS simulation)
        const offerCode = localStorage.getItem(`manamesh_lan_offer_${gameId}`);
        if (!offerCode) {
          throw new Error('LAN game not found or offer expired');
        }

        const offer = await decodeOffer(offerCode);

        this.connection = createLANPeerConnection({
          onStateChange: (state) => {
            this.log('LAN guest connection state:', state);
            if (state === 'connected' && this.connection) {
              if (timeout) clearTimeout(timeout);
              resolve(this.connection);
            }
            if (state === 'failed') {
              if (timeout) clearTimeout(timeout);
              reject(new Error('LAN connection failed'));
            }
          },
          onMessage: () => {
            // Messages handled by caller
          },
          onError: (error) => {
            this.log('LAN guest error:', error);
            if (timeout) clearTimeout(timeout);
            reject(error);
          },
        });

        if (options?.timeout) {
          timeout = setTimeout(() => {
            reject(new Error('LAN connection timeout'));
            this.cleanup();
          }, options.timeout);
        }

        // Accept the offer and create answer
        const answer = await this.connection.acceptOffer(offer);
        const answerCode = await encodeOffer(answer);

        // Store answer for host to pick up (mDNS simulation)
        localStorage.setItem(`manamesh_lan_answer_${gameId}`, answerCode);
        this.log('LAN answer stored for game:', gameId);

      } catch (error) {
        if (timeout) clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Accept an answer for a hosted game (host side)
   */
  async acceptAnswer(gameId: string): Promise<void> {
    if (!this.connection) {
      throw new Error('No active LAN connection');
    }

    // Poll for answer (mDNS simulation)
    const maxAttempts = 30; // 30 seconds
    for (let i = 0; i < maxAttempts; i++) {
      const answerCode = localStorage.getItem(`manamesh_lan_answer_${gameId}`);
      if (answerCode) {
        this.log('Found LAN answer for game:', gameId);
        const answer = await decodeOffer(answerCode);
        await this.connection.acceptAnswer(answer);

        // Clean up stored codes
        localStorage.removeItem(`manamesh_lan_offer_${gameId}`);
        localStorage.removeItem(`manamesh_lan_answer_${gameId}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Timeout waiting for LAN answer');
  }

  /**
   * Get available LAN games
   */
  getAvailableGames(): LANGame[] {
    return this.discovery?.getDiscoveredGames() ?? [];
  }

  /**
   * Start scanning for LAN games
   */
  startDiscovery(): void {
    if (!this.discovery) {
      this.discovery = new MDNSDiscovery({
        onGameFound: (game) => this.log('Found LAN game:', game),
        onGameLost: (gameId) => this.log('Lost LAN game:', gameId),
        onError: (error) => this.log('LAN discovery error:', error),
      });
    }
    this.discovery.startDiscovery();
    this.log('LAN discovery started');
  }

  /**
   * Stop scanning for LAN games
   */
  stopDiscovery(): void {
    this.discovery?.stopDiscovery();
    this.log('LAN discovery stopped');
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.discovery) {
      this.discovery.cleanup();
      this.discovery = null;
    }
    this.log('LAN transport cleaned up');
  }
}
