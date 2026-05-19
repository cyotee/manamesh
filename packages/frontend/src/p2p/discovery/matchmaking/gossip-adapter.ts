import type { ManaMeshLibp2p } from '../../libp2p-config';
import { getLobbyTopic } from './keys';
import type {
  LobbyMessage,
  LobbyPayload,
  LobbyMessageType,
} from './types';

export interface LobbyEvents {
  onMessage: (msg: LobbyMessage) => void;
  onError: (err: Error) => void;
}

export class GossipLobbyAdapter {
  private libp2p: ManaMeshLibp2p;
  private topic: string;
  private events: LobbyEvents;
  private subscription: ((msg: Uint8Array, peerId: string) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private peerId: string;

  constructor(
    libp2p: ManaMeshLibp2p,
    roomCode: string,
    events: LobbyEvents,
  ) {
    this.libp2p = libp2p;
    this.topic = getLobbyTopic(roomCode);
    this.events = events;
    this.peerId = libp2p.peerId.toString();
  }

  async start(): Promise<void> {
    await this.libp2p.services.pubsub.subscribe(this.topic);
    this.subscription = (data: Uint8Array, peerId: string) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(data)) as LobbyMessage;
        if (msg.sender !== this.peerId) {
          this.events.onMessage(msg);
        }
      } catch (err) {
        console.warn('[Gossip] Failed to parse message:', err);
      }
    };
    this.libp2p.services.pubsub.addEventListener('message', this.subscription as any);
  }

  send(type: LobbyMessageType, payload: Omit<LobbyPayload, 'type'>): void {
    const msg: LobbyMessage = {
      _matchmaking: true,
      type,
      sender: this.peerId,
      timestamp: Date.now(),
      payload: { ...payload, type } as LobbyPayload,
    };
    const data = new TextEncoder().encode(JSON.stringify(msg));
    this.libp2p.services.pubsub.publish(this.topic, data).catch((err) => {
      this.events.onError(err as Error);
    });
  }

  startHeartbeat(intervalMs = 5_000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('Heartbeat', { type: 'Heartbeat' });
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    if (this.subscription) {
      this.libp2p.services.pubsub.removeEventListener('message', this.subscription as any);
      this.subscription = null;
    }
    await this.libp2p.services.pubsub.unsubscribe(this.topic);
  }
}
