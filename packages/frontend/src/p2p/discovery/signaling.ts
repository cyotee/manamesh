/**
 * WebSocket Signaling Server Client
 *
 * Provides a fallback discovery method when DHT/mDNS/join codes fail.
 * Connects to a signaling server to exchange SDP offers/answers.
 */

import { PeerConnection, type ConnectionOffer, type PeerConnectionEvents } from '../webrtc';

export type SignalingState = 'disconnected' | 'connecting' | 'connected' | 'in-room' | 'error';

export interface SignalingEvents {
  onStateChange: (state: SignalingState) => void;
  onPeerJoined: (peerId: string) => void;
  onPeerLeft: (peerId: string) => void;
  onError: (error: Error) => void;
}

interface SignalingMessage {
  type: string;
  roomId?: string;
  peerId?: string;
  peers?: string[];
  payload?: unknown;
  message?: string;
}

const DEFAULT_SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:4000/signaling';

export class SignalingConnection {
  private ws: WebSocket | null = null;
  private _state: SignalingState = 'disconnected';
  private events: SignalingEvents;
  private serverUrl: string;
  private roomId: string | null = null;
  private peerId: string | null = null;
  private peerConnections = new Map<string, PeerConnection>();
  private peerConnectionEvents: PeerConnectionEvents;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;

  constructor(events: SignalingEvents, peerConnectionEvents: PeerConnectionEvents, serverUrl?: string) {
    this.events = events;
    this.peerConnectionEvents = peerConnectionEvents;
    this.serverUrl = serverUrl || DEFAULT_SIGNALING_URL;
  }

  get state(): SignalingState {
    return this._state;
  }

  get currentPeerId(): string | null {
    return this.peerId;
  }

  get currentRoomId(): string | null {
    return this.roomId;
  }

  private setState(state: SignalingState): void {
    this._state = state;
    this.events.onStateChange(state);
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.setState('connecting');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log('[Signaling] Connected to server');
          this.setState('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = () => {
          console.log('[Signaling] Disconnected from server');
          this.handleDisconnect();
        };

        this.ws.onerror = (event) => {
          console.error('[Signaling] WebSocket error:', event);
          this.setState('error');
          reject(new Error('Failed to connect to signaling server'));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };
      } catch (err) {
        this.setState('error');
        reject(err);
      }
    });
  }

  private handleDisconnect(): void {
    this.setState('disconnected');
    this.roomId = null;
    this.peerId = null;

    // Attempt reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[Signaling] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect().catch(() => {}), this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private handleMessage(message: SignalingMessage): void {
    console.log('[Signaling] Received:', message.type);

    switch (message.type) {
      case 'joined':
        this.peerId = message.peerId || null;
        this.roomId = message.roomId || null;
        this.setState('in-room');
        console.log(`[Signaling] Joined room ${this.roomId} as ${this.peerId}`);

        // If there are existing peers, initiate connections to them
        if (message.peers && message.peers.length > 0) {
          console.log(`[Signaling] ${message.peers.length} peers already in room`);
          for (const existingPeerId of message.peers) {
            this.initiateConnection(existingPeerId);
          }
        }
        break;

      case 'peer-joined':
        if (message.peerId) {
          console.log(`[Signaling] Peer ${message.peerId} joined`);
          this.events.onPeerJoined(message.peerId);
          // New peer will initiate connection to us
        }
        break;

      case 'peer-left':
        if (message.peerId) {
          console.log(`[Signaling] Peer ${message.peerId} left`);
          this.events.onPeerLeft(message.peerId);
          this.peerConnections.get(message.peerId)?.close();
          this.peerConnections.delete(message.peerId);
        }
        break;

      case 'offer':
        this.handleOffer(message.peerId!, message.payload as ConnectionOffer);
        break;

      case 'answer':
        this.handleAnswer(message.peerId!, message.payload as ConnectionOffer);
        break;

      case 'ice-candidate':
        // ICE candidates are bundled with offers/answers, so this is a no-op for trickle ICE
        break;

      case 'error':
        console.error('[Signaling] Server error:', message.message);
        this.events.onError(new Error(message.message || 'Unknown server error'));
        break;
    }
  }

  private async initiateConnection(targetPeerId: string): Promise<void> {
    console.log(`[Signaling] Initiating connection to ${targetPeerId}`);

    const pc = new PeerConnection(this.peerConnectionEvents);
    this.peerConnections.set(targetPeerId, pc);

    try {
      const offer = await pc.createOffer();
      this.send({
        type: 'offer',
        roomId: this.roomId!,
        peerId: targetPeerId,
        payload: offer,
      });
    } catch (err) {
      console.error('[Signaling] Failed to create offer:', err);
      this.peerConnections.delete(targetPeerId);
    }
  }

  private async handleOffer(fromPeerId: string, offer: ConnectionOffer): Promise<void> {
    console.log(`[Signaling] Received offer from ${fromPeerId}`);

    const pc = new PeerConnection(this.peerConnectionEvents);
    this.peerConnections.set(fromPeerId, pc);

    try {
      const answer = await pc.acceptOffer(offer);
      this.send({
        type: 'answer',
        roomId: this.roomId!,
        peerId: fromPeerId,
        payload: answer,
      });
    } catch (err) {
      console.error('[Signaling] Failed to accept offer:', err);
      this.peerConnections.delete(fromPeerId);
    }
  }

  private async handleAnswer(fromPeerId: string, answer: ConnectionOffer): Promise<void> {
    console.log(`[Signaling] Received answer from ${fromPeerId}`);

    const pc = this.peerConnections.get(fromPeerId);
    if (!pc) {
      console.error('[Signaling] No pending connection for peer:', fromPeerId);
      return;
    }

    try {
      await pc.acceptAnswer(answer);
    } catch (err) {
      console.error('[Signaling] Failed to accept answer:', err);
    }
  }

  private send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[Signaling] Cannot send - not connected');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  async joinRoom(roomId: string): Promise<void> {
    if (this._state !== 'connected' && this._state !== 'in-room') {
      await this.connect();
    }

    this.send({
      type: 'join',
      roomId,
    });
  }

  leaveRoom(): void {
    if (this.roomId) {
      this.send({
        type: 'leave',
        roomId: this.roomId,
      });
      this.roomId = null;
      this.peerId = null;

      // Close all peer connections
      for (const pc of this.peerConnections.values()) {
        pc.close();
      }
      this.peerConnections.clear();

      this.setState('connected');
    }
  }

  disconnect(): void {
    this.leaveRoom();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  getPeerConnection(peerId: string): PeerConnection | undefined {
    return this.peerConnections.get(peerId);
  }

  getAllPeerConnections(): Map<string, PeerConnection> {
    return new Map(this.peerConnections);
  }
}

/**
 * Check if signaling server is available
 */
export async function isSignalingAvailable(serverUrl?: string): Promise<boolean> {
  const url = serverUrl || DEFAULT_SIGNALING_URL;

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 3000);

    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
  });
}

/**
 * Get the configured signaling server URL
 */
export function getSignalingUrl(): string {
  return DEFAULT_SIGNALING_URL;
}
