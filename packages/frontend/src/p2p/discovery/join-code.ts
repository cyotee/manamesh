/**
 * Two-way join code discovery mechanism
 * Fully serverless P2P connection using manual code exchange
 */

import { PeerConnection, type ConnectionState, type PeerConnectionEvents } from '../webrtc';
import { encodeOffer, decodeOffer, isValidJoinCode } from '../codec';

export type JoinCodeRole = 'host' | 'guest';

export type JoinCodeState =
  | { phase: 'idle' }
  | { phase: 'creating-offer'; role: 'host' }
  | { phase: 'waiting-for-answer'; role: 'host'; offerCode: string }
  | { phase: 'entering-offer'; role: 'guest' }
  | { phase: 'waiting-for-host'; role: 'guest'; answerCode: string }
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'error'; error: string };

export interface JoinCodeEvents {
  onStateChange: (state: JoinCodeState) => void;
  onMessage: (data: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
}

/**
 * Manages the two-way join code exchange process
 */
export class JoinCodeConnection {
  private peerConnection: PeerConnection | null = null;
  private events: JoinCodeEvents;
  private _state: JoinCodeState = { phase: 'idle' };

  constructor(events: JoinCodeEvents) {
    this.events = events;
  }

  get state(): JoinCodeState {
    return this._state;
  }

  private setState(state: JoinCodeState): void {
    this._state = state;
    this.events.onStateChange(state);
  }

  private createPeerConnection(): PeerConnection {
    const peerEvents: PeerConnectionEvents = {
      onStateChange: (state) => {
        this.events.onConnectionStateChange(state);
        if (state === 'connected') {
          this.setState({ phase: 'connected' });
        } else if (state === 'failed' || state === 'disconnected') {
          if (this._state.phase !== 'error') {
            this.setState({ phase: 'error', error: `Connection ${state}` });
          }
        }
      },
      onMessage: (data) => {
        // Check for signal messages and dispatch them separately
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === '__signal__') {
            this._dispatchSignal(parsed.payload);
            return; // Don't forward signal messages to regular handler
          }
        } catch (e) {
          // Not JSON or not a signal, forward normally
        }
        this.events.onMessage(data);
      },
      onError: (error) => {
        this.setState({ phase: 'error', error: error.message });
      },
    };

    return new PeerConnection(peerEvents);
  }

  /**
   * Start hosting a game (creates an offer code)
   */
  async createGame(): Promise<string> {
    this.cleanup();
    this.setState({ phase: 'creating-offer', role: 'host' });

    try {
      this.peerConnection = this.createPeerConnection();
      const offer = await this.peerConnection.createOffer();
      const offerCode = await encodeOffer(offer);

      this.setState({ phase: 'waiting-for-answer', role: 'host', offerCode });
      return offerCode;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create offer';
      this.setState({ phase: 'error', error: message });
      throw error;
    }
  }

  /**
   * Join a game using an offer code (creates an answer code)
   */
  async joinGame(offerCode: string): Promise<string> {
    if (!isValidJoinCode(offerCode)) {
      throw new Error('Invalid offer code format');
    }

    this.cleanup();
    this.setState({ phase: 'entering-offer', role: 'guest' });

    try {
      const offer = await decodeOffer(offerCode);

      this.peerConnection = this.createPeerConnection();
      const answer = await this.peerConnection.acceptOffer(offer);
      const answerCode = await encodeOffer(answer);

      this.setState({ phase: 'waiting-for-host', role: 'guest', answerCode });
      return answerCode;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join game';
      this.setState({ phase: 'error', error: message });
      throw error;
    }
  }

  /**
   * Complete the connection by entering the answer code (host side)
   */
  async acceptAnswer(answerCode: string): Promise<void> {
    if (!isValidJoinCode(answerCode)) {
      throw new Error('Invalid answer code format');
    }

    if (!this.peerConnection) {
      throw new Error('No pending connection - create a game first');
    }

    if (this._state.phase !== 'waiting-for-answer') {
      throw new Error('Not waiting for answer');
    }

    this.setState({ phase: 'connecting' });

    try {
      const answer = await decodeOffer(answerCode);
      await this.peerConnection.acceptAnswer(answer);
      // Connection state will be updated by the peer connection events
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept answer';
      this.setState({ phase: 'error', error: message });
      throw error;
    }
  }

  /**
   * Send a message to the connected peer
   */
  send(data: string): void {
    if (!this.peerConnection) {
      throw new Error('Not connected');
    }
    this.peerConnection.send(data);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this._state.phase === 'connected';
  }

  /**
   * Clean up and reset
   */
  cleanup(): void {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.setState({ phase: 'idle' });
  }

  /**
   * Close the connection
   */
  close(): void {
    this.cleanup();
  }

  // Signal handlers for custom messages (e.g., new-hand signals)
  private signalHandlers: Set<(signal: unknown) => void> = new Set();

  /**
   * Send a signal (custom message) to the peer
   * Used for out-of-band communication like new-hand notifications
   */
  sendSignal(signal: unknown): void {
    const message = JSON.stringify({
      type: '__signal__',
      payload: signal,
    });
    this.send(message);
  }

  /**
   * Register a handler for incoming signals
   */
  onSignal(handler: (signal: unknown) => void): void {
    this.signalHandlers.add(handler);
  }

  /**
   * Unregister a signal handler
   */
  offSignal(handler: (signal: unknown) => void): void {
    this.signalHandlers.delete(handler);
  }

  /**
   * Internal: dispatch signal to handlers
   * Called when a signal message is received
   */
  _dispatchSignal(signal: unknown): void {
    this.signalHandlers.forEach(handler => {
      try {
        handler(signal);
      } catch (e) {
        console.error('[JoinCodeConnection] Signal handler error:', e);
      }
    });
  }
}
