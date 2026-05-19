import { createLibp2p, type Libp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { resolveBootstrapNodes } from '../../bootstrap-resolver';
import { DHTTableAdapter } from './dht-adapter';
import { GossipLobbyAdapter } from './gossip-adapter';
import type {
  TableRegistration,
  PlayerInfo,
  LobbyMessage,
  JoinRequestPayload,
  JoinResponsePayload,
  JoinConfirmPayload,
  LeaveNoticePayload,
  ReadyTogglePayload,
  GameStartPayload,
  GameAbortPayload,
} from './types';

export interface MatchmakingConfig {
  gameType: string;
  displayName: string;
  maxPlayers: number;
  isHost: boolean;
  roomCode?: string;
  minBuyIn?: number;
}

export interface MatchmakingEvents {
  onTableFound: (table: TableRegistration) => void;
  onPlayerJoined: (player: PlayerInfo) => void;
  onPlayerLeft: (peerId: string, reason: string) => void;
  onReadyChange: (peerId: string, ready: boolean) => void;
  onGameStart: (startTime: number, seed?: string, joinCode?: string) => void;
  onGameAbort: (reason: string) => void;
  onJoinRequest: (peerId: string, payload: JoinRequestPayload) => void;
  onJoinResponse: (payload: JoinResponsePayload) => void;
  onError: (error: Error) => void;
  onStateChange: (state: string) => void;
}

type ServiceState =
  | 'idle'
  | 'connecting'
  | 'lobby'
  | 'game'
  | 'error';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

function generateRoomCode(): string {
  const array = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length])
    .join('');
}

function isMessageForUs(msg: LobbyMessage): boolean {
  return msg._matchmaking === true;
}

export class MatchmakingService {
  private libp2p: Libp2p<any> | null = null;
  private config: MatchmakingConfig;
  private events: MatchmakingEvents;
  private state: ServiceState = 'idle';
  private roomCode: string = '';
  private tableId: string = '';
  private dhtAdapter: DHTTableAdapter | null = null;
  private gossipAdapter: GossipLobbyAdapter | null = null;
  private players: Map<string, PlayerInfo> = new Map();
  private myPeerId: string = '';
  private mySeat: number = -1;

  constructor(config: MatchmakingConfig, events: MatchmakingEvents) {
    this.config = config;
    this.events = events;
  }

  private setState(state: ServiceState): void {
    this.state = state;
    this.events.onStateChange(state);
  }

  private handleLobbyMessage(msg: LobbyMessage): void {
    switch (msg.payload.type) {
      case 'JoinRequest':
        if (this.config.isHost) {
          this.events.onJoinRequest(msg.sender, msg.payload as JoinRequestPayload);
        }
        break;
      case 'JoinResponse':
        this.events.onJoinResponse(msg.payload as JoinResponsePayload);
        break;
      case 'JoinConfirm':
        if (this.config.isHost) {
          const payload = msg.payload as JoinConfirmPayload;
          this.players.set(msg.sender, {
            peerId: msg.sender,
            name: 'Player',
            seat: payload.seat,
            ready: false,
          });
          this.events.onPlayerJoined(this.players.get(msg.sender)!);
        }
        break;
      case 'LeaveNotice': {
        const payload = msg.payload as LeaveNoticePayload;
        this.players.delete(msg.sender);
        this.events.onPlayerLeft(msg.sender, payload.reason);
        break;
      }
      case 'ReadyToggle': {
        const payload = msg.payload as ReadyTogglePayload;
        const player = this.players.get(msg.sender);
        if (player) {
          player.ready = payload.ready;
          this.events.onReadyChange(msg.sender, payload.ready);
        }
        break;
      }
      case 'GameStart': {
        const payload = msg.payload as GameStartPayload;
        this.events.onGameStart(payload.startTime, payload.seed, payload.joinCode);
        break;
      }
      case 'GameAbort': {
        const payload = msg.payload as GameAbortPayload;
        this.events.onGameAbort(payload.reason);
        break;
      }
    }
  }

  async start(): Promise<void> {
    this.setState('connecting');
    try {
      const bootstrapNodes = await resolveBootstrapNodes();
      this.libp2p = await createLibp2p({
        addresses: { listen: ['/p2p-circuit', '/webrtc'] },
        transports: [webSockets(), webRTC(), circuitRelayTransport()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        peerDiscovery: [bootstrap({ list: [...bootstrapNodes] })],
        services: {
          dht: kadDHT({ clientMode: true }),
          identify: identify(),
          ping: ping(),
        },
      });
      await this.libp2p.start();
      this.myPeerId = this.libp2p.peerId.toString();
      if (this.config.isHost) {
        await this.hostTable();
      } else {
        if (!this.config.roomCode) throw new Error('roomCode required to join');
        await this.joinTable(this.config.roomCode);
      }
    } catch (err) {
      this.setState('error');
      this.events.onError(err as Error);
      throw err;
    }
  }

  private async hostTable(): Promise<void> {
    if (!this.libp2p) throw new Error('libp2p not initialized');
    this.roomCode = this.config.roomCode ?? generateRoomCode();
    this.tableId = crypto.randomUUID();
    this.dhtAdapter = new DHTTableAdapter(this.libp2p as any);
    await this.dhtAdapter.createTable({
      tableId: this.tableId,
      roomCode: this.roomCode,
      gameType: this.config.gameType,
      hostPeerId: this.myPeerId,
      hostName: this.config.displayName,
      maxPlayers: this.config.maxPlayers,
      minBuyIn: this.config.minBuyIn,
      createdAt: Date.now(),
    });
    this.players.set(this.myPeerId, {
      peerId: this.myPeerId,
      name: this.config.displayName,
      seat: 0,
      ready: false,
    });
    this.mySeat = 0;
    this.gossipAdapter = new GossipLobbyAdapter(this.libp2p as any, this.roomCode, {
      onMessage: (msg) => {
        if (isMessageForUs(msg)) this.handleLobbyMessage(msg);
      },
      onError: (err) => this.events.onError(err),
    });
    await this.gossipAdapter.start();
    this.gossipAdapter.startHeartbeat();
    this.setState('lobby');
  }

  private async joinTable(roomCode: string): Promise<void> {
    if (!this.libp2p) throw new Error('libp2p not initialized');
    this.roomCode = roomCode.toUpperCase();
    const { lookupTable } = await import('./dht-adapter');
    const registration = await lookupTable(this.libp2p as any, this.config.gameType, this.roomCode);
    if (!registration) throw new Error('Table not found');
    this.tableId = registration.tableId;
    this.events.onTableFound(registration);
    this.gossipAdapter = new GossipLobbyAdapter(this.libp2p as any, this.roomCode, {
      onMessage: (msg) => {
        if (isMessageForUs(msg)) this.handleLobbyMessage(msg);
      },
      onError: (err) => this.events.onError(err),
    });
    await this.gossipAdapter.start();
    this.gossipAdapter.startHeartbeat();
    this.gossipAdapter.send('JoinRequest', {
      type: 'JoinRequest',
      displayName: this.config.displayName,
    });
    this.setState('lobby');
  }

  acceptJoin(peerId: string, seat: number): void {
    this.gossipAdapter?.send('JoinResponse', {
      type: 'JoinResponse',
      accepted: true,
      seatOffered: seat,
    });
  }

  rejectJoin(peerId: string, reason: string): void {
    this.gossipAdapter?.send('JoinResponse', {
      type: 'JoinResponse',
      accepted: false,
      reason,
    });
  }

  confirmSeat(seat: number): void {
    this.mySeat = seat;
    this.gossipAdapter?.send('JoinConfirm', {
      type: 'JoinConfirm',
      seat,
    });
  }

  setReady(ready: boolean): void {
    this.gossipAdapter?.send('ReadyToggle', {
      type: 'ReadyToggle',
      ready,
    });
    const me = this.players.get(this.myPeerId);
    if (me) {
      me.ready = ready;
      this.events.onReadyChange(this.myPeerId, ready);
    }
  }

  startGame(seed?: string, joinCode?: string): void {
    this.gossipAdapter?.send('GameStart', {
      type: 'GameStart',
      startTime: Date.now() + 3000,
      seed,
      joinCode,
    });
    this.setState('game');
  }

  abortGame(reason: string): void {
    this.gossipAdapter?.send('GameAbort', {
      type: 'GameAbort',
      reason,
    });
  }

  leaveLobby(): void {
    this.gossipAdapter?.send('LeaveNotice', {
      type: 'LeaveNotice',
      reason: 'voluntary',
    });
    this.stop();
  }

  async stop(): Promise<void> {
    this.gossipAdapter?.stopHeartbeat();
    await this.gossipAdapter?.stop();
    this.dhtAdapter?.close();
    await this.libp2p?.stop();
    this.libp2p = null;
    this.setState('idle');
  }

  getRoomCode(): string {
    return this.roomCode;
  }

  getPlayers(): PlayerInfo[] {
    return Array.from(this.players.values());
  }

  getMySeat(): number {
    return this.mySeat;
  }

  getState(): ServiceState {
    return this.state;
  }
}
