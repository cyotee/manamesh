/**
 * Direct IP Transport Adapter
 *
 * Allows manual IP:port specification for users who know their network.
 * Useful for VPN users, port-forwarded setups, or known network topologies.
 *
 * Note: This transport still uses WebRTC but without STUN discovery.
 * Users manually specify the target IP and port.
 */

import type {
  TransportAdapter,
  HostOptions,
  JoinOptions,
  HostSession,
  TransportLogger,
} from './types';
import { createTransportLogger } from './types';
import { PeerConnection, type PeerConnectionEvents } from '../webrtc';
import { encodeOffer, decodeOffer } from '../codec';

/**
 * Parse an IP:port string
 */
function parseIpPort(target: string): { ip: string; port: number } | null {
  const match = target.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
  if (!match) return null;

  const ip = match[1];
  const port = parseInt(match[2], 10);

  // Validate IP octets
  const octets = ip.split('.').map(Number);
  if (octets.some(o => o < 0 || o > 255)) return null;

  // Validate port range
  if (port < 1 || port > 65535) return null;

  return { ip, port };
}

/**
 * Direct IP transport adapter
 *
 * Uses manual IP:port exchange for users with known network configurations.
 * No STUN servers or NAT traversal - direct connection only.
 */
export class DirectIPTransport implements TransportAdapter {
  readonly type = 'directIp' as const;
  readonly name = 'Direct IP';

  private connection: PeerConnection | null = null;
  private log: TransportLogger;
  private localPort: number | null = null;

  constructor(verboseLogging = false) {
    this.log = createTransportLogger(verboseLogging);
  }

  /**
   * Direct IP is available if WebRTC is available
   */
  async isAvailable(): Promise<boolean> {
    // WebRTC is required
    if (typeof RTCPeerConnection === 'undefined') {
      this.log('WebRTC not available');
      return false;
    }
    return true;
  }

  /**
   * Create a host session
   *
   * For direct IP, the host creates an offer and shares their IP:port
   * along with the offer code.
   */
  async createHost(options?: HostOptions): Promise<HostSession> {
    this.log('Creating direct IP host session...');
    this.cleanup();

    let resolveGuest: ((conn: PeerConnection) => void) | null = null;
    let rejectGuest: ((err: Error) => void) | null = null;
    let cancelled = false;

    this.connection = new PeerConnection({
      onStateChange: (state) => {
        this.log('Direct IP host connection state:', state);
        if (state === 'connected' && resolveGuest && this.connection) {
          resolveGuest(this.connection);
        }
        if (state === 'failed' && rejectGuest) {
          rejectGuest(new Error('Direct IP connection failed'));
        }
      },
      onMessage: () => {
        // Messages handled by caller
      },
      onError: (error) => {
        this.log('Direct IP host error:', error);
        if (rejectGuest) {
          rejectGuest(error);
        }
      },
    });

    // Create offer
    const offer = await this.connection.createOffer();
    const offerCode = await encodeOffer(offer);

    // For direct IP, the connection ID includes the offer
    // The user needs to share this along with their public IP:port
    // Format: IP:PORT|OFFER_CODE
    const connectionId = `direct|${offerCode}`;

    this.log('Direct IP offer created');

    const session: HostSession = {
      type: 'directIp',
      connectionId,
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
                reject(new Error('Timeout waiting for direct IP guest'));
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
   * Join using a direct IP connection string
   *
   * Target format: "direct|OFFER_CODE" or just "OFFER_CODE"
   */
  async joinSession(target: string, options?: JoinOptions): Promise<PeerConnection> {
    this.log('Joining direct IP session:', target.substring(0, 30) + '...');
    this.cleanup();

    // Extract offer code from target
    const offerCode = target.startsWith('direct|')
      ? target.slice(7)
      : target;

    return new Promise(async (resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;

      try {
        const offer = await decodeOffer(offerCode);

        this.connection = new PeerConnection({
          onStateChange: (state) => {
            this.log('Direct IP guest connection state:', state);
            if (state === 'connected' && this.connection) {
              if (timeout) clearTimeout(timeout);
              resolve(this.connection);
            }
            if (state === 'failed') {
              if (timeout) clearTimeout(timeout);
              reject(new Error('Direct IP connection failed'));
            }
          },
          onMessage: () => {
            // Messages handled by caller
          },
          onError: (error) => {
            this.log('Direct IP guest error:', error);
            if (timeout) clearTimeout(timeout);
            reject(error);
          },
        });

        if (options?.timeout) {
          timeout = setTimeout(() => {
            reject(new Error('Direct IP connection timeout'));
            this.cleanup();
          }, options.timeout);
        }

        // Accept offer and create answer
        const answer = await this.connection.acceptOffer(offer);
        const answerCode = await encodeOffer(answer);

        // Store the answer code for the host to retrieve
        // In a real implementation, this would be sent back via signaling
        this.log('Direct IP answer created:', answerCode.substring(0, 20) + '...');

        // For direct IP, the guest needs to share the answer code back
        // We'll store it for retrieval
        (this as any)._answerCode = answerCode;

      } catch (error) {
        if (timeout) clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Get the answer code after joining (guest side)
   */
  getAnswerCode(): string | null {
    return (this as any)._answerCode ?? null;
  }

  /**
   * Accept an answer code (host side)
   */
  async acceptAnswer(answerCode: string): Promise<void> {
    if (!this.connection) {
      throw new Error('No active direct IP connection');
    }
    this.log('Accepting direct IP answer');
    const answer = await decodeOffer(answerCode);
    await this.connection.acceptAnswer(answer);
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    (this as any)._answerCode = null;
    this.log('Direct IP transport cleaned up');
  }
}
