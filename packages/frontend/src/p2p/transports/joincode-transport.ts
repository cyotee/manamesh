/**
 * Join Code Transport Adapter
 *
 * Wraps the existing JoinCodeConnection as a transport adapter.
 * This is the fallback transport that uses WebRTC with STUN servers.
 */

import type {
  TransportAdapter,
  HostOptions,
  JoinOptions,
  HostSession,
  TransportLogger,
} from './types';
import { createTransportLogger } from './types';
import { JoinCodeConnection } from '../discovery/join-code';
import type { PeerConnection } from '../webrtc';

/**
 * Join Code transport adapter
 *
 * Uses two-way SDP exchange via copy/paste codes.
 * This is the fallback transport that uses Google STUN servers.
 */
export class JoinCodeTransport implements TransportAdapter {
  readonly type = 'joinCode' as const;
  readonly name = 'Join Code';

  private connection: JoinCodeConnection | null = null;
  private log: TransportLogger;

  constructor(verboseLogging = false) {
    this.log = createTransportLogger(verboseLogging);
  }

  /**
   * Join code transport is always available in browsers
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
   * Create a host session with an offer code
   */
  async createHost(options?: HostOptions): Promise<HostSession> {
    this.log('Creating host session...');
    this.cleanup();

    let resolveGuest: ((conn: PeerConnection) => void) | null = null;
    let rejectGuest: ((err: Error) => void) | null = null;
    let guestPromise: Promise<PeerConnection> | null = null;
    let cancelled = false;

    this.connection = new JoinCodeConnection({
      onStateChange: (state) => {
        this.log('Host state:', state.phase);
        if (state.phase === 'connected' && resolveGuest && this.connection) {
          // Connection established - but we need the actual PeerConnection
          // The JoinCodeConnection doesn't expose it directly, so we'll
          // need to handle this differently
        }
        if (state.phase === 'error' && rejectGuest) {
          rejectGuest(new Error('error' in state ? state.error : 'Connection failed'));
        }
      },
      onMessage: () => {
        // Messages handled by caller
      },
      onConnectionStateChange: (state) => {
        this.log('Host connection state:', state);
        if (state === 'connected' && resolveGuest) {
          // Connected - we need to provide the PeerConnection somehow
          // For now, we'll signal success but the caller needs to use
          // the JoinCodeConnection directly
        }
      },
    });

    const offerCode = await this.connection.createGame();
    this.log('Offer code created:', offerCode.substring(0, 20) + '...');

    const session: HostSession = {
      type: 'joinCode',
      connectionId: offerCode,
      connection: null,

      waitForGuest: async (timeout?: number): Promise<PeerConnection> => {
        if (cancelled) {
          throw new Error('Session cancelled');
        }

        // For join code, the caller needs to manually accept the answer
        // This method should be called after acceptAnswer is done
        guestPromise = new Promise((resolve, reject) => {
          resolveGuest = resolve;
          rejectGuest = reject;

          if (timeout) {
            setTimeout(() => {
              if (!cancelled) {
                reject(new Error('Timeout waiting for guest'));
              }
            }, timeout);
          }
        });

        return guestPromise;
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
   * Join an existing session using an offer code
   *
   * Note: For join code transport, the target is the offer code,
   * and this returns an answer code that must be shared back.
   */
  async joinSession(offerCode: string, options?: JoinOptions): Promise<PeerConnection> {
    this.log('Joining session with offer code:', offerCode.substring(0, 20) + '...');
    this.cleanup();

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;

      this.connection = new JoinCodeConnection({
        onStateChange: (state) => {
          this.log('Guest state:', state.phase);
          if (state.phase === 'error') {
            if (timeout) clearTimeout(timeout);
            reject(new Error('error' in state ? state.error : 'Connection failed'));
          }
          if (state.phase === 'connected') {
            if (timeout) clearTimeout(timeout);
            // Note: We don't have direct access to PeerConnection
            // The caller will need to use the JoinCodeConnection
          }
        },
        onMessage: () => {
          // Messages handled by caller
        },
        onConnectionStateChange: (state) => {
          this.log('Guest connection state:', state);
        },
      });

      if (options?.timeout) {
        timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
          this.cleanup();
        }, options.timeout);
      }

      this.connection.joinGame(offerCode).catch(reject);
    });
  }

  /**
   * Get the current connection for direct access
   */
  getConnection(): JoinCodeConnection | null {
    return this.connection;
  }

  /**
   * Accept an answer code (host side)
   */
  async acceptAnswer(answerCode: string): Promise<void> {
    if (!this.connection) {
      throw new Error('No active connection');
    }
    this.log('Accepting answer code:', answerCode.substring(0, 20) + '...');
    await this.connection.acceptAnswer(answerCode);
  }

  /**
   * Get the answer code after joining (guest side)
   */
  getAnswerCode(): string | null {
    if (!this.connection) return null;
    const state = this.connection.state;
    if (state.phase === 'waiting-for-host' && 'answerCode' in state) {
      return state.answerCode;
    }
    return null;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.connection) {
      this.connection.cleanup();
      this.connection = null;
    }
    this.log('Cleaned up');
  }
}
