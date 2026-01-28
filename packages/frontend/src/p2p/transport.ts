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
  private initialState: State<any> | null = null;
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
    this.initialState = opts.initialState;
    this.metadata = opts.metadata;
    this.log = [];
  }

  async fetch(matchID: string, opts: {
    state?: boolean;
    metadata?: boolean;
    log?: boolean;
    initialState?: boolean;
  }): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state?: State<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialState?: State<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    log?: LogEntry[];
  }> {
    const result: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state?: State<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialState?: State<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata?: any;
      log?: LogEntry[];
    } = {};

    if (opts.state) result.state = this.state || undefined;
    if (opts.initialState) result.initialState = this.initialState || undefined;
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
 * Find the starting phase from game config
 * Looks for a phase with start: true
 */
function findStartingPhase(game: Game): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phases = (game as any).phases;
  if (!phases) return null;

  for (const [phaseName, phaseConfig] of Object.entries(phases)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((phaseConfig as any).start === true) {
      return phaseName;
    }
  }
  return null;
}

/**
 * Create an initial game state
 * This is a simplified version of boardgame.io's InitializeGame
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initializeGameState(game: Game, numPlayers: number): State<any> {
  // Find the starting phase from game config
  const startingPhase = findStartingPhase(game);

  const ctx: Ctx = {
    numPlayers,
    playOrder: Array.from({ length: numPlayers }, (_, i) => String(i)),
    playOrderPos: 0,
    activePlayers: null,
    currentPlayer: '0',
    numMoves: 0,
    turn: 1,
    phase: startingPhase || null,
  };

  // Initialize game state using the setup function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = game.setup ? (game.setup as any)({ ctx }) : {};

  return {
    G,
    ctx,
    plugins: {},
    _stateID: 0,
    _undo: [],
    _redo: [],
  };
}

/**
 * Find a move definition from the game config
 * Checks both top-level moves and phase-specific moves
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMove(game: Game, moveType: string, phase: string | null): ((args: any, ...moveArgs: any[]) => any) | null {
  // Check top-level moves first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let moveDef = (game.moves as any)?.[moveType];

  // If not found and we have a phase, check phase-specific moves
  if (!moveDef && phase) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phases = (game as any).phases;
    moveDef = phases?.[phase]?.moves?.[moveType];
  }

  if (!moveDef) {
    return null;
  }

  // Handle both direct function and { move: fn } formats
  if (typeof moveDef === 'function') {
    return moveDef;
  }
  if (typeof moveDef === 'object' && typeof moveDef.move === 'function') {
    return moveDef.move;
  }

  return null;
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
  const move = findMove(game, moveType, state.ctx.phase);

  if (!move) {
    console.log('[applyAction] Move not found:', moveType, 'phase:', state.ctx.phase);
    return INVALID_MOVE;
  }

  // Create a copy of the state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let G = JSON.parse(JSON.stringify(state.G)) as any;
  let ctx = { ...state.ctx };

  // Track events triggered by the move
  let phaseEnded = false;
  let turnEnded = false;

  // Create events object for moves to use
  const events = {
    endPhase: () => {
      console.log('[applyAction] endPhase called');
      phaseEnded = true;
    },
    endTurn: () => {
      console.log('[applyAction] endTurn called');
      turnEnded = true;
    },
  };

  // Call the move with events
  const moveArgs = { G, ctx, playerID, events };
  const result = move(moveArgs, ...args);

  // Handle move result
  if (result === INVALID_MOVE) {
    return INVALID_MOVE;
  }

  // If the move returns a new G, use it
  if (result !== undefined) {
    G = result;
  }

  // Handle phase transition
  if (phaseEnded && game.phases) {
    const currentPhase = ctx.phase;
    const phaseConfig = game.phases[currentPhase];
    if (phaseConfig?.next) {
      const nextPhase = typeof phaseConfig.next === 'function'
        ? phaseConfig.next({ G, ctx })
        : phaseConfig.next;
      console.log('[applyAction] Transitioning from phase', currentPhase, 'to', nextPhase);
      ctx = { ...ctx, phase: nextPhase };
    }
  }

  // Check phase endIf (automatic phase transition)
  if (!phaseEnded && game.phases && ctx.phase) {
    const phaseConfig = game.phases[ctx.phase];
    if (phaseConfig?.endIf) {
      const shouldEnd = phaseConfig.endIf({ G, ctx });
      if (shouldEnd && phaseConfig.next) {
        const nextPhase = typeof phaseConfig.next === 'function'
          ? phaseConfig.next({ G, ctx })
          : phaseConfig.next;
        console.log('[applyAction] Phase endIf triggered, transitioning to', nextPhase);
        ctx = { ...ctx, phase: nextPhase };
      }
    }
  }

  // Check for end turn
  const numMoves = ctx.numMoves + 1;
  const shouldEndTurn = turnEnded || (game.turn?.maxMoves && numMoves >= game.turn.maxMoves);

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
  private initialized: Promise<void>;
  private _isInitialized = false;

  constructor(game: Game, matchID: string, numPlayers: number) {
    this.game = game;
    this.db = new BrowserStorage();
    this.matchID = matchID;
    this.numPlayers = numPlayers;

    // Initialize the game state and store the promise
    this.initialized = this.initGame();
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

    this._isInitialized = true;
    console.log('[P2PMaster] Game initialized with state:', initialState);
  }

  async waitForInit(): Promise<void> {
    await this.initialized;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
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
    // Wait for initialization to complete
    await this.initialized;

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
    // Wait for initialization to complete
    await this.initialized;

    if (matchID !== this.matchID) {
      return { error: 'Match ID mismatch' };
    }

    const { state, initialState, metadata, log } = await this.db.fetch(matchID, { state: true, initialState: true, metadata: true, log: true });
    console.log('[P2PMaster] onSync - state:', state ? 'present' : 'null', 'initialState:', initialState ? 'present' : 'null', 'for player:', playerID);

    if (!state) {
      return { error: 'Match not found' };
    }

    const filteredMetadata = this.filterMetadata(metadata);

    // Send sync response to the requesting player
    // Include initialState as required by boardgame.io's SyncInfo interface
    const callback = this.subscribers.get(playerID || 'spectator');
    if (callback) {
      callback({
        type: 'sync',
        args: [matchID, {
          state,
          initialState: initialState || state,
          filteredMetadata,
          log: log || [],
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
    console.log('[P2PTransport] notifyClient called with type:', data.type, 'callback:', this.transportDataCallback ? 'present' : 'null');
    if (this.transportDataCallback) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.transportDataCallback(data as { type: 'update' | 'sync' | 'matchData' | 'chat' | 'patch'; args: any[] });
    } else {
      console.warn('[P2PTransport] transportDataCallback is null, cannot notify client');
    }
  }

  connect(): void {
    // Set up message handler for the P2P connection
    this.setupMessageHandler();

    if (this.role === 'host') {
      // connectAsHost is async, but connect() is called synchronously by boardgame.io
      // The async initialization will complete and trigger a sync
      this.connectAsHost().catch(err => {
        console.error('[P2PTransport] Failed to connect as host:', err);
      });
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

  private async connectAsHost(): Promise<void> {
    console.log('[P2PTransport] Connecting as host');

    // Create the master for the host
    this.master = new P2PMaster(this.game, this.matchID, this.numPlayers);

    // Wait for the master to initialize the game state
    await this.master.waitForInit();
    console.log('[P2PTransport] Master initialized');

    // Subscribe the host's local client
    this.master.subscribe(this.playerID || '0', (data) => {
      console.log('[P2PTransport] Host received data:', data.type);
      this.notifyClient(data);
    });

    // Subscribe guest player '1' proactively and send them state updates
    // This ensures the guest receives updates even if their sync-req was missed
    this.master.subscribe('1', (data) => {
      console.log('[P2PTransport] Sending to guest:', data.type);
      this.sendToGuest(data);
    });
    // Also subscribe 'remote' key for broadcasts
    this.master.subscribe('remote', (data) => {
      this.sendToGuest(data);
    });

    this.setConnectionStatus(true);

    // Request initial sync for local client
    this.requestSync();

    // Proactively send initial state to guest after a short delay
    // This handles the case where guest's sync-req was received before our handler was ready
    setTimeout(() => {
      if (this.master && this.connection.isConnected()) {
        console.log('[P2PTransport] Proactively syncing guest');
        this.master.onSync(this.matchID, '1', undefined, this.numPlayers);
      }
    }, 100);
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

        // Guest is already subscribed in connectAsHost, just handle the sync request
        const guestId = syncPlayerID || '1';
        console.log('[P2PTransport] Received sync-req from guest:', guestId);
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
    console.log('[P2PTransport] sendAction called:', action.type, 'state:', state ? `stateID=${state._stateID}` : 'null');
    if (this.role === 'host' && this.master) {
      // Host processes action locally
      this.master.onUpdate(action, state._stateID, this.matchID, this.playerID || '0').then(result => {
        if (result?.error) {
          console.error('[P2PTransport] Action failed:', result.error);
        } else {
          console.log('[P2PTransport] Action processed successfully');
        }
      });
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
    console.log('[P2PTransport] requestSync called, role:', this.role, 'master:', this.master ? 'present' : 'null');
    if (this.role === 'host' && this.master) {
      this.master.onSync(this.matchID, this.playerID, this.credentials, this.numPlayers).then(() => {
        console.log('[P2PTransport] Host sync complete');
      });
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
