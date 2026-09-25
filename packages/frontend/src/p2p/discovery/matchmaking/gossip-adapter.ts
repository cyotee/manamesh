import { StrictSign, type Message } from '@libp2p/gossipsub';
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

type LobbyNode = Pick<ManaMeshLibp2p, 'peerId'> & { services: Pick<ManaMeshLibp2p['services'], 'pubsub'> };

export class GossipLobbyAdapter {
  private libp2p: LobbyNode;
  private topic: string;
  private events: LobbyEvents;
  private subscription: ((event: CustomEvent<Message>) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private peerId: string;

  constructor(
    libp2p: LobbyNode,
    roomCode: string,
    events: LobbyEvents,
  ) {
    this.libp2p = libp2p;
    this.topic = getLobbyTopic(roomCode);
    this.events = events;
    this.peerId = libp2p.peerId.toString();
  }

  async start(): Promise<void> {
    if (this.subscription) return;
    if (this.libp2p.services.pubsub.globalSignaturePolicy !== StrictSign) {
      throw new Error('Lobby requires signed pubsub messages');
    }
    this.subscription = (event: CustomEvent<Message>) => {
      const wire = event.detail;
      if (wire.type !== 'signed' || wire.topic !== this.topic || wire.data.byteLength > 65536) return;
      const author = wire.from.toString();
      if (author === this.peerId) return;
      let msg: unknown;
      try { msg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire.data)); }
      catch { return; }
      if (!isLobbyMessage(msg) || msg.sender !== author) return;
      this.events.onMessage(msg);
    };
    this.libp2p.services.pubsub.addEventListener('message', this.subscription);
    try { await this.libp2p.services.pubsub.subscribe(this.topic); }
    catch (error) {
      this.libp2p.services.pubsub.removeEventListener('message', this.subscription);
      this.subscription = null;
      throw error;
    }
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
    if (!this.subscription || data.byteLength > 65536 || !isLobbyMessage(msg)) {
      this.events.onError(new Error('Invalid or inactive lobby send'));
      return;
    }
    this.libp2p.services.pubsub.publish(this.topic, data).catch((err: unknown) => {
      this.events.onError(err instanceof Error ? err : new Error(String(err)));
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
      this.libp2p.services.pubsub.removeEventListener('message', this.subscription);
      this.subscription = null;
    }
    await this.libp2p.services.pubsub.unsubscribe(this.topic);
  }
}


const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;
const seat = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 64;
function isLobbyMessage(value: unknown): value is LobbyMessage {
  if (!object(value) || value._matchmaking !== true || !text(value.sender) ||
      !Number.isSafeInteger(value.timestamp) || !object(value.payload) || value.type !== value.payload.type) return false;
  const p = value.payload;
  switch (p.type) {
    case 'JoinRequest': return text(p.displayName) && (p.requestedSeat === undefined || seat(p.requestedSeat));
    case 'JoinResponse': return text(p.recipientPeerId) && p.recipientPeerId.length > 0 && typeof p.accepted === 'boolean' && (p.seatOffered === undefined || seat(p.seatOffered)) && (p.reason === undefined || text(p.reason));
    case 'JoinConfirm': case 'SeatOffer': return seat(p.seat);
    case 'LeaveNotice': return ['voluntary', 'kicked', 'timeout'].includes(String(p.reason));
    case 'ReadyToggle': return typeof p.ready === 'boolean';
    case 'GameStart': return Number.isSafeInteger(p.startTime) && (p.seed === undefined || text(p.seed)) && (p.joinCode === undefined || text(p.joinCode));
    case 'GameAbort': return text(p.reason);
    case 'Heartbeat': return true;
    default: return false;
  }
}
