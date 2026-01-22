/**
 * boardgame.io P2P Transport
 *
 * A custom transport for boardgame.io that uses WebRTC data channels
 * for peer-to-peer multiplayer without a server.
 *
 * Architecture:
 * - Host embeds a game master to maintain authoritative game state
 * - Guest sends actions to host via WebRTC data channel
 * - Host processes actions and broadcasts state updates to guest
 */

import type { Game, State, ChatMessage, FilteredMetadata, LogEntry, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { JoinCodeConnection, ConnectionState } from './discovery/join-code';

/**
 * Simple in-memory storage for browser-side game state
 */
class BrowserStorage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private state: State<any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metadata: any = null;
  private log: LogEntry[] = [];

  async createMatch(matchID: string, opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialState: State<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: any;
  }): Promise<void> {
    this.state = opts.initialState;
    this.metadata = opts.metadata;
    this.log = [];
  }

  async fetch(matchID: string, opts: {
    state?: boolean;
    metadata?: boolean;
    log?: boolean;
  }): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state?: State<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    log?: LogEntry[];
  }> {
    const result: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state?: State<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata?: any;
      log?: LogEntry[];
    } = {};

    if (opts.state) result.state = this.state || undefined;
    if (opts.metadata) result.metadata = this.metadata;
    if (opts.log) result.log = this.log;

    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setState(matchID: string, state: State<any>, deltalog?: LogEntry[]): Promise<void> {
    this.state = state;
    if (deltalog) {
      this.log = [...this.log, ...deltalog];
    }
  }
}

// Message types sent over the P2P data channel
export type P2PMessageType =
  | 'action'      // Guest -> Host: player action
  | 'sync-req'    // Guest -> Host: request state sync
  | 'chat'        // Both: chat message
  | 'update'      // Host -> Guest: state update
  | 'sync'        // Host -> Guest: full state sync response
  | 'matchData'   // Host -> Guest: player metadata
  | 'patch'       // Host -> Guest: incremental state patch
  | 'error';      // Both: error message

export interface P2PMessage {
  type: P2PMessageType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];
}

export type P2PRole = 'host' | 'guest';

export interface P2PTransportOpts {
  game: Game;
  connection: JoinCodeConnection;
  role: P2PRole;
  matchID?: string;
  playerID?: string;
  numPlayers?: number;
  credentials?: string;
}

interface TransportDataCallback {
  (data: {
    type: 'update' | 'sync' | 'matchData' | 'chat' | 'patch';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[];
  }): void;
}

interface ConnectionStatusCallback {
  (): void;
}

/**
 * Create an initial game state
 * This is a simplified version of boardgame.io's InitializeGame
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initializeGameState(game: Game, numPlayers: number): State<any> {
  const ctx: Ctx = {
    numPlayers,
    playOrder: Array.from({ length: numPlayers }, (_, i) => String(i)),
    playOrderPos: 0,
    activePlayers: null,
    currentPlayer: '0',
    numMoves: 0,
    turn: 1,
    phase: 'default',
  };

  // Initialize game state using the setup function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = game.setup ? (game.setup as any)({ ctx }) : {};

  return {
    G,
    ctx,
    plugins: {},
    _stateID: 0,
  };
}

/**
 * Apply an action to the game state
 * This is a simplified game reducer
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyAction(game: Game, state: State<any>, action: any): State<any> | typeof INVALID_MOVE {
  const { type, playerID, payload } = action;

  if (type !== 'MAKE_MOVE') {
    // We only handle MAKE_MOVE actions for now
    return INVALID_MOVE;
  }

  const { type: moveType, args } = payload;
  const move = game.moves?.[moveType];

  if (!move) {
    return INVALID_MOVE;
  }

  // Create a copy of the state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let G = JSON.parse(JSON.stringify(state.G)) as any;
  const ctx = { ...state.ctx };

  // Call the move
  const moveArgs = { G, ctx, playerID };
  const result = move(moveArgs, ...args);

  // Handle move result
  if (result === INVALID_MOVE) {
    return INVALID_MOVE;
  }

  // If the move returns a new G, use it
  if (result !== undefined) {
    G = result;
  }

  // Check for end turn
  const numMoves = ctx.numMoves + 1;
  const shouldEndTurn = game.turn?.maxMoves && numMoves >= game.turn.maxMoves;

  let newCtx = { ...ctx, numMoves };

  if (shouldEndTurn) {
    // Advance to next player
    const nextPos = (ctx.playOrderPos + 1) % ctx.numPlayers;
    newCtx = {
      ...newCtx,
      playOrderPos: nextPos,
      currentPlayer: ctx.playOrder[nextPos],
      numMoves: 0,
      turn: ctx.turn + 1,
    };
  }

  // Check for game end
  let gameover;
  if (game.endIf) {
    gameover = game.endIf({ G, ctx: newCtx });
  }

  return {
    G,
    ctx: gameover ? { ...newCtx, gameover } : newCtx,
    plugins: state.plugins,
    _stateID: state._stateID + 1,
  };
}

/**
 * Simple in-memory game master for host
 */
class P2PMaster {
  private game: Game;
  private db: BrowserStorage;
  private matchID: string;
  private numPlayers: number;
  private subscribers: Map<string, (data: P2PMessage) => void> = new Map();

  constructor(game: Game, matchID: string, numPlayers: number) {
    this.game = game;
    this.db = new BrowserStorage();
    this.matchID = matchID;
    this.numPlayers = numPlayers;

    // Initialize the game state
    this.initGame();
  }

  private async initGame(): Promise<void> {
    const initialState = initializeGameState(this.game, this.numPlayers);

    await this.db.createMatch(this.matchID, {
      initialState,
      metadata: {
        gameName: this.game.name || 'unknown',
        players: this.createInitialPlayers(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  }

  private createInitialPlayers(): Record<number, { id: number; name?: string }> {
    const players: Record<number, { id: number; name?: string }> = {};
    for (let i = 0; i < this.numPlayers; i++) {
      players[i] = { id: i };
    }
    return players;
  }

  subscribe(playerID: string, callback: (data: P2PMessage) => void): void {
    this.subscribers.set(playerID, callback);
  }

  unsubscribe(playerID: string): void {
    this.subscribers.delete(playerID);
  }

  private notifyAll(data: P2PMessage): void {
    this.subscribers.forEach((callback) => {
      callback(data);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onUpdate(action: any, stateID: number, matchID: string, playerID: string): Promise<void | { error: string }> {
    if (matchID !== this.matchID) {
      return { error: 'Match ID mismatch' };
    }

    const { state } = await this.db.fetch(matchID, { state: true });

    if (!state) {
      return { error: 'Match not found' };
    }

    // Check state ID matches (prevents stale updates)
    if (state._stateID !== stateID) {
      console.log(`[P2PMaster] Stale state: expected ${state._stateID}, got ${stateID}`);
      return { error: 'Stale state' };
    }

    // Apply the action
    const newState = applyAction(this.game, state, action);

    if (newState === INVALID_MOVE) {
      return { error: 'Invalid move' };
    }

    // Save the new state
    await this.db.setState(matchID, newState);

    // Broadcast the update to all clients
    this.notifyAll({
      type: 'update',
      args: [matchID, newState, []],
    });
  }

  async onSync(matchID: string, playerID: string | null, credentials?: string, numPlayers = 2): Promise<void | { error: string }> {
    if (matchID !== this.matchID) {
      return { error: 'Match ID mismatch' };
    }

    const { state, metadata } = await this.db.fetch(matchID, { state: true, metadata: true, log: true });

    if (!state) {
      return { error: 'Match not found' };
    }

    const filteredMetadata = this.filterMetadata(metadata);

    // Send sync response to the requesting player
    const callback = this.subscribers.get(playerID || 'spectator');
    if (callback) {
      callback({
        type: 'sync',
        args: [matchID, {
          state,
          filteredMetadata,
          log: [],
        }],
      });
    }
  }

  async onChatMessage(matchID: string, chatMessage: ChatMessage, credentials?: string): Promise<void> {
    // Broadcast chat to all subscribers
    this.notifyAll({
      type: 'chat',
      args: [matchID, chatMessage],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private filterMetadata(metadata: any): FilteredMetadata {
    if (!metadata?.players) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.entries(metadata.players).map(([id, player]: [string, any]) => ({
      id: parseInt(id, 10),
      name: player?.name,
      isConnected: this.subscribers.has(id),
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getState(): Promise<State<any> | null> {
    const { state } = await this.db.fetch(this.matchID, { state: true });
    return state || null;
  }
}

/**
 * P2P Transport for boardgame.io
 *
 * This transport enables peer-to-peer multiplayer by:
 * - Having the host run an embedded game master
 * - Sending actions over WebRTC data channels
 * - Broadcasting state updates to connected peers
 *
 * Implements the Transport interface required by boardgame.io Client
 */
export class P2PTransport {
  private connection: JoinCodeConnection;
  private role: P2PRole;
  private master: P2PMaster | null = null;
  private messageBuffer: P2PMessage[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private _isConnected = false;
  private connectionStatusCallbacks: Set<ConnectionStatusCallback> = new Set();

  // Properties expected by boardgame.io Client
  private gameName: string;
  private playerID: string | null;
  private matchID: string;
  private credentials?: string;
  private numPlayers: number;
  private game: Game;
  private transportDataCallback: TransportDataCallback | null = null;

  constructor(opts: P2PTransportOpts & { transportDataCallback?: TransportDataCallback }) {
    this.connection = opts.connection;
    this.role = opts.role;
    this.gameName = opts.game.name || 'unknown';
    this.playerID = opts.playerID || null;
    this.matchID = opts.matchID || 'default';
    this.credentials = opts.credentials;
    this.numPlayers = opts.numPlayers || 2;
    this.game = opts.game;
    this.transportDataCallback = opts.transportDataCallback || null;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  subscribeToConnectionStatus(fn: ConnectionStatusCallback): () => void {
    this.connectionStatusCallbacks.add(fn);
    return () => this.connectionStatusCallbacks.delete(fn);
  }

  private setConnectionStatus(connected: boolean): void {
    if (this._isConnected !== connected) {
      this._isConnected = connected;
      this.connectionStatusCallbacks.forEach(fn => fn());
    }
  }

  private notifyClient(data: P2PMessage): void {
    if (this.transportDataCallback) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.transportDataCallback(data as { type: 'update' | 'sync' | 'matchData' | 'chat' | 'patch'; args: any[] });
    }
  }

  connect(): void {
    // Set up message handler for the P2P connection
    this.setupMessageHandler();

    if (this.role === 'host') {
      this.connectAsHost();
    } else {
      this.connectAsGuest();
    }
  }

  private setupMessageHandler(): void {
    // Get the connection's events and hook into onMessage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (this.connection as any).events;
    if (!events) {
      console.error('[P2PTransport] Cannot access connection events');
      return;
    }

    const originalOnMessage = events.onMessage;
    events.onMessage = (data: string) => {
      try {
        const message: P2PMessage = JSON.parse(data);
        this.handleMessage(message);
      } catch (e) {
        console.error('[P2PTransport] Failed to parse message:', e);
      }
      originalOnMessage?.(data);
    };

    // Listen for connection state changes
    const originalOnConnectionStateChange = events.onConnectionStateChange;
    events.onConnectionStateChange = (state: ConnectionState) => {
      this.handleConnectionStateChange(state);
      originalOnConnectionStateChange?.(state);
    };
  }

  private handleConnectionStateChange(state: ConnectionState): void {
    console.log('[P2PTransport] Connection state:', state);

    switch (state) {
      case 'connected':
        this.setConnectionStatus(true);
        this.reconnectAttempts = 0;
        this.flushMessageBuffer();
        break;
      case 'disconnected':
      case 'failed':
        this.setConnectionStatus(false);
        this.attemptReconnect();
        break;
    }
  }

  private connectAsHost(): void {
    console.log('[P2PTransport] Connecting as host');

    // Create the master for the host
    this.master = new P2PMaster(this.game, this.matchID, this.numPlayers);

    // Subscribe the host's local client
    this.master.subscribe(this.playerID || '0', (data) => {
      this.notifyClient(data);
    });

    // Note: Guest subscription happens in handleHostMessage when sync-req arrives
    // This ensures we use the guest's actual playerID for routing

    this.setConnectionStatus(true);

    // Request initial sync for local client
    this.requestSync();
  }

  private connectAsGuest(): void {
    console.log('[P2PTransport] Connecting as guest');

    if (this.connection.isConnected()) {
      this.setConnectionStatus(true);
      // Request sync from host
      this.sendToHost({ type: 'sync-req', args: [this.matchID, this.playerID, this.credentials, this.numPlayers] });
    }
  }

  private handleMessage(message: P2PMessage): void {
    if (this.role === 'host') {
      this.handleHostMessage(message);
    } else {
      this.handleGuestMessage(message);
    }
  }

  private handleHostMessage(message: P2PMessage): void {
    if (!this.master) return;

    switch (message.type) {
      case 'action':
        const [action, stateID, matchID, playerID] = message.args;
        this.master.onUpdate(action, stateID, matchID, playerID).then(result => {
          if (result?.error) {
            this.sendToGuest({ type: 'error', args: [result.error] });
          }
        });
        break;

      case 'sync-req':
        const [syncMatchID, syncPlayerID, syncCredentials, syncNumPlayers] = message.args;
        if (!this.master) return;

        // Subscribe guest using their actual playerID so onSync can find them
        // Also subscribe 'remote' as a fallback for broadcasts
        const guestId = syncPlayerID || '1';
        this.master.subscribe(guestId, (data) => {
          this.sendToGuest(data);
        });
        // Subscribe 'remote' key for state updates (notifyAll uses all subscribers)
        this.master.subscribe('remote', (data) => {
          this.sendToGuest(data);
        });

        this.master.onSync(syncMatchID, guestId, syncCredentials, syncNumPlayers);
        break;

      case 'chat':
        const [chatMatchID, chatMessage] = message.args;
        this.master.onChatMessage(chatMatchID, chatMessage, this.credentials);
        break;
    }
  }

  private handleGuestMessage(message: P2PMessage): void {
    // Guest receives state updates and syncs from host
    switch (message.type) {
      case 'update':
      case 'sync':
      case 'matchData':
      case 'chat':
      case 'patch':
        this.notifyClient(message);
        break;

      case 'error':
        console.error('[P2PTransport] Host error:', message.args[0]);
        break;
    }
  }

  private sendToHost(message: P2PMessage): void {
    this.send(message);
  }

  private sendToGuest(message: P2PMessage): void {
    this.send(message);
  }

  private send(message: P2PMessage): void {
    if (!this.connection.isConnected()) {
      console.log('[P2PTransport] Buffering message while disconnected');
      this.messageBuffer.push(message);
      return;
    }

    try {
      this.connection.send(JSON.stringify(message));
    } catch (e) {
      console.error('[P2PTransport] Failed to send message:', e);
      this.messageBuffer.push(message);
    }
  }

  private flushMessageBuffer(): void {
    if (this.messageBuffer.length === 0) return;

    console.log(`[P2PTransport] Flushing ${this.messageBuffer.length} buffered messages`);
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];

    for (const message of messages) {
      this.send(message);
    }
  }

  /**
   * Attempt to recover from a brief disconnection.
   *
   * Note: WebRTC connections can sometimes recover on their own if the
   * underlying network issue is brief. This method handles that case by:
   * 1. Waiting with exponential backoff
   * 2. Checking if the connection has recovered
   * 3. If recovered, flushing buffered messages and re-syncing
   *
   * For permanent disconnections (failed ICE, network change), the user
   * will need to re-establish the connection via a new join code exchange.
   * The UI shows connection status so users know when to reconnect.
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[P2PTransport] Max reconnect attempts reached - connection lost');
      console.log('[P2PTransport] User should re-exchange join codes to reconnect');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`[P2PTransport] Waiting for connection recovery (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

    this.reconnectTimeout = setTimeout(() => {
      // Check if WebRTC connection has recovered on its own
      if (this.connection.isConnected()) {
        console.log('[P2PTransport] Connection recovered');
        this.setConnectionStatus(true);
        this.reconnectAttempts = 0;
        this.flushMessageBuffer();

        // Guest should re-sync to get latest state after reconnect
        if (this.role === 'guest') {
          this.sendToHost({ type: 'sync-req', args: [this.matchID, this.playerID, this.credentials, this.numPlayers] });
        }
      } else {
        // Still disconnected, try again
        this.attemptReconnect();
      }
    }, delay);
  }

  disconnect(): void {
    console.log('[P2PTransport] Disconnecting');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.master) {
      this.master.unsubscribe(this.playerID || '0');
      // Unsubscribe any remote players (guest playerID and 'remote' key)
      this.master.unsubscribe('1');
      this.master.unsubscribe('remote');
      this.master = null;
    }

    this.setConnectionStatus(false);
    this.messageBuffer = [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendAction(state: State<any>, action: any): void {
    if (this.role === 'host' && this.master) {
      // Host processes action locally
      this.master.onUpdate(action, state._stateID, this.matchID, this.playerID || '0');
    } else {
      // Guest sends action to host
      this.sendToHost({
        type: 'action',
        args: [action, state._stateID, this.matchID, this.playerID],
      });
    }
  }

  sendChatMessage(matchID: string, chatMessage: ChatMessage): void {
    const message: P2PMessage = {
      type: 'chat',
      args: [matchID, chatMessage],
    };

    if (this.role === 'host' && this.master) {
      this.master.onChatMessage(matchID, chatMessage, this.credentials);
    } else {
      this.sendToHost(message);
    }
  }

  requestSync(): void {
    if (this.role === 'host' && this.master) {
      this.master.onSync(this.matchID, this.playerID, this.credentials, this.numPlayers);
    } else {
      this.sendToHost({
        type: 'sync-req',
        args: [this.matchID, this.playerID, this.credentials, this.numPlayers],
      });
    }
  }

  updateMatchID(matchID: string): void {
    this.matchID = matchID;
  }

  updatePlayerID(playerID: string | null): void {
    this.playerID = playerID;
  }

  updateCredentials(credentials?: string): void {
    this.credentials = credentials;
  }
}

/**
 * Factory function to create a P2P multiplayer configuration
 * This is the function you pass to boardgame.io Client's multiplayer option
 */
export function P2PMultiplayer(opts: Omit<P2PTransportOpts, 'game'>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (transportOpts: { game: Game; transportDataCallback: TransportDataCallback }) => {
    return new P2PTransport({
      ...opts,
      game: transportOpts.game,
      transportDataCallback: transportOpts.transportDataCallback,
    });
  };
}

export type { JoinCodeConnection, ConnectionState };
