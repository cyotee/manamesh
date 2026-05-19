export interface TableRegistration {
  tableId: string;
  roomCode: string;
  gameType: string;
  hostPeerId: string;
  hostName: string;
  maxPlayers: number;
  minBuyIn?: number;
  createdAt: number;
  expiresAt: number;
  version: number;
  signature?: string;
}

export interface PlayerInfo {
  peerId: string;
  name: string;
  seat: number;
  ready: boolean;
}

export type LobbyMessageType =
  | 'JoinRequest'
  | 'JoinResponse'
  | 'JoinConfirm'
  | 'LeaveNotice'
  | 'ReadyToggle'
  | 'SeatOffer'
  | 'GameStart'
  | 'GameAbort'
  | 'Heartbeat';

export interface LobbyMessage {
  _matchmaking: true;
  type: LobbyMessageType;
  sender: string;
  timestamp: number;
  payload: LobbyPayload;
}

export type LobbyPayload =
  | JoinRequestPayload
  | JoinResponsePayload
  | JoinConfirmPayload
  | LeaveNoticePayload
  | ReadyTogglePayload
  | SeatOfferPayload
  | GameStartPayload
  | GameAbortPayload
  | HeartbeatPayload;

export interface JoinRequestPayload {
  type: 'JoinRequest';
  displayName: string;
  requestedSeat?: number;
}

export interface JoinResponsePayload {
  type: 'JoinResponse';
  accepted: boolean;
  seatOffered?: number;
  reason?: string;
}

export interface JoinConfirmPayload {
  type: 'JoinConfirm';
  seat: number;
}

export interface LeaveNoticePayload {
  type: 'LeaveNotice';
  reason: 'voluntary' | 'kicked' | 'timeout';
}

export interface ReadyTogglePayload {
  type: 'ReadyToggle';
  ready: boolean;
}

export interface SeatOfferPayload {
  type: 'SeatOffer';
  seat: number;
}

export interface GameStartPayload {
  type: 'GameStart';
  startTime: number;
  seed?: string;
  /** Join code for establishing the game WebRTC connection (host → guests) */
  joinCode?: string;
}

export interface GameAbortPayload {
  type: 'GameAbort';
  reason: string;
}

export interface HeartbeatPayload {
  type: 'Heartbeat';
}
