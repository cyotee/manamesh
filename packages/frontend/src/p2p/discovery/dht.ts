/**
 * DHT Discovery Module
 * Enables single-code room discovery via libp2p DHT
 *
 * Flow:
 * 1. Host creates a WebRTC offer, generates a short room code
 * 2. Host publishes offer to DHT under room key
 * 3. Guest enters room code, looks up offer from DHT
 * 4. Guest creates answer and publishes to DHT under answer key
 * 5. Host subscribes for answers and completes connection
 *
 * Fallback: If DHT is unavailable, falls back to two-way join codes
 */

import { PeerConnection, type ConnectionState, type ConnectionOffer, type PeerConnectionEvents } from '../webrtc';
import { encodeOffer, decodeOffer } from '../codec';
import {
  createNode,
  getNode,
  getRoomKey,
  getPublicGamesKey,
  isConnectedToPeers,
  type ManaMeshLibp2p
} from '../libp2p-config';

// Room code character set (case-insensitive, no confusing chars)
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

// Timeouts
const DHT_TIMEOUT_MS = 30000; // 30 seconds for DHT operations
const ANSWER_POLL_INTERVAL_MS = 2000; // Poll for answers every 2 seconds
const PUBLIC_GAMES_REFRESH_MS = 10000; // Refresh public games every 10 seconds

export type DHTState =
  | { phase: 'idle' }
  | { phase: 'initializing' }
  | { phase: 'creating-room'; role: 'host' }
  | { phase: 'publishing-offer'; role: 'host'; roomCode: string }
  | { phase: 'waiting-for-guest'; role: 'host'; roomCode: string }
  | { phase: 'connecting'; role: 'host' | 'guest' }
  | { phase: 'joining-room'; role: 'guest'; roomCode: string }
  | { phase: 'looking-up-offer'; role: 'guest'; roomCode: string }
  | { phase: 'connected' }
  | { phase: 'error'; error: string; fallbackAvailable?: boolean };

export interface PublicGame {
  roomCode: string;
  hostName: string;
  gameType: string;
  createdAt: number;
}

export interface DHTEvents {
  onStateChange: (state: DHTState) => void;
  onMessage: (data: string) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onPublicGamesUpdate: (games: PublicGame[]) => void;
}

/**
 * Generate a random, memorable room code
 */
export function generateRoomCode(): string {
  const array = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map(byte => ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length])
    .join('');
}

/**
 * Normalize room code for consistency
 */
export function normalizeRoomCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validate a room code format
 */
export function isValidRoomCode(code: string): boolean {
  const normalized = normalizeRoomCode(code);
  return normalized.length === ROOM_CODE_LENGTH &&
    /^[A-Z0-9]+$/.test(normalized);
}

/**
 * DHT-based P2P connection manager
 */
export class DHTConnection {
  private libp2p: ManaMeshLibp2p | null = null;
  private peerConnection: PeerConnection | null = null;
  private events: DHTEvents;
  private _state: DHTState = { phase: 'idle' };
  private answerPollTimer: NodeJS.Timeout | null = null;
  private publicGamesTimer: NodeJS.Timeout | null = null;
  private currentRoomCode: string | null = null;
  private isPublicGame = false;
  private hostName = 'Anonymous';
  private gameType = 'MTG';

  constructor(events: DHTEvents) {
    this.events = events;
  }

  get state(): DHTState {
    return this._state;
  }

  private setState(state: DHTState): void {
    this._state = state;
    this.events.onStateChange(state);
  }

  /**
   * Initialize libp2p node
   */
  async initialize(): Promise<boolean> {
    if (this.libp2p) return true;

    this.setState({ phase: 'initializing' });

    try {
      this.libp2p = await createNode();

      // Wait for initial peer connections (with timeout)
      const startTime = Date.now();
      while (!isConnectedToPeers() && Date.now() - startTime < 10000) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!isConnectedToPeers()) {
        console.warn('[DHT] Could not connect to bootstrap nodes');
        this.setState({
          phase: 'error',
          error: 'Could not connect to network. DHT discovery unavailable.',
          fallbackAvailable: true
        });
        return false;
      }

      console.log('[DHT] Connected to network');
      this.setState({ phase: 'idle' });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize DHT';
      console.error('[DHT] Initialization error:', message);
      this.setState({
        phase: 'error',
        error: message,
        fallbackAvailable: true
      });
      return false;
    }
  }

  private createPeerConnection(): PeerConnection {
    const peerEvents: PeerConnectionEvents = {
      onStateChange: (state) => {
        this.events.onConnectionStateChange(state);
        if (state === 'connected') {
          this.stopPolling();
          this.setState({ phase: 'connected' });
        } else if (state === 'failed' || state === 'disconnected') {
          if (this._state.phase !== 'error') {
            this.setState({ phase: 'error', error: `Connection ${state}` });
          }
        }
      },
      onMessage: (data) => {
        this.events.onMessage(data);
      },
      onError: (error) => {
        this.setState({ phase: 'error', error: error.message });
      },
    };

    return new PeerConnection(peerEvents);
  }

  /**
   * Create a game room (host side)
   */
  async createRoom(options: {
    isPublic?: boolean;
    hostName?: string;
    gameType?: string;
  } = {}): Promise<string> {
    const { isPublic = false, hostName = 'Anonymous', gameType = 'MTG' } = options;

    this.isPublicGame = isPublic;
    this.hostName = hostName;
    this.gameType = gameType;

    // Ensure initialized
    if (!this.libp2p) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('DHT not available. Try using join codes instead.');
      }
    }

    this.cleanup();
    this.setState({ phase: 'creating-room', role: 'host' });

    try {
      // Create peer connection and offer
      this.peerConnection = this.createPeerConnection();
      const offer = await this.peerConnection.createOffer();
      const offerCode = await encodeOffer(offer);

      // Generate room code
      const roomCode = generateRoomCode();
      this.currentRoomCode = roomCode;

      this.setState({ phase: 'publishing-offer', role: 'host', roomCode });

      // Publish offer to DHT
      await this.publishToDHT(getRoomKey(roomCode), {
        type: 'offer',
        data: offerCode,
        hostName,
        gameType,
        createdAt: Date.now(),
      });

      // If public, also add to public games list
      if (isPublic) {
        await this.addToPublicGames(roomCode, hostName, gameType);
      }

      this.setState({ phase: 'waiting-for-guest', role: 'host', roomCode });

      // Start polling for answers
      this.startAnswerPolling(roomCode);

      return roomCode;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create room';
      this.setState({
        phase: 'error',
        error: message,
        fallbackAvailable: true
      });
      throw error;
    }
  }

  /**
   * Join a game room (guest side)
   */
  async joinRoom(roomCode: string): Promise<void> {
    const normalized = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(normalized)) {
      throw new Error('Invalid room code format');
    }

    // Ensure initialized
    if (!this.libp2p) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('DHT not available. Try using join codes instead.');
      }
    }

    this.cleanup();
    this.currentRoomCode = normalized;
    this.setState({ phase: 'joining-room', role: 'guest', roomCode: normalized });

    try {
      this.setState({ phase: 'looking-up-offer', role: 'guest', roomCode: normalized });

      // Look up offer from DHT
      const offerData = await this.lookupFromDHT(getRoomKey(normalized));
      if (!offerData || offerData.type !== 'offer') {
        throw new Error('Room not found. Check the code and try again.');
      }

      // Decode and accept the offer
      const offer = await decodeOffer(offerData.data);
      this.peerConnection = this.createPeerConnection();
      const answer = await this.peerConnection.acceptOffer(offer);
      const answerCode = await encodeOffer(answer);

      this.setState({ phase: 'connecting', role: 'guest' });

      // Publish answer to DHT
      await this.publishToDHT(getRoomKey(`${normalized}-answer`), {
        type: 'answer',
        data: answerCode,
        createdAt: Date.now(),
      });

      // Connection will complete when host processes the answer
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join room';
      this.setState({
        phase: 'error',
        error: message,
        fallbackAvailable: true
      });
      throw error;
    }
  }

  /**
   * Publish data to DHT
   */
  private async publishToDHT(key: Uint8Array, data: unknown): Promise<void> {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized');
    }

    const encoder = new TextEncoder();
    const value = encoder.encode(JSON.stringify(data));

    try {
      await this.libp2p.services.dht.put(key, value, {
        signal: AbortSignal.timeout(DHT_TIMEOUT_MS),
      });
      console.log('[DHT] Published to key:', new TextDecoder().decode(key));
    } catch (error) {
      console.error('[DHT] Publish error:', error);
      throw new Error('Failed to publish to network');
    }
  }

  /**
   * Look up data from DHT
   */
  private async lookupFromDHT(key: Uint8Array): Promise<Record<string, unknown> | null> {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized');
    }

    try {
      const decoder = new TextDecoder();

      for await (const event of this.libp2p.services.dht.get(key, {
        signal: AbortSignal.timeout(DHT_TIMEOUT_MS),
      })) {
        if (event.name === 'VALUE') {
          const json = decoder.decode(event.value);
          return JSON.parse(json);
        }
      }

      return null;
    } catch (error) {
      console.error('[DHT] Lookup error:', error);
      return null;
    }
  }

  /**
   * Add game to public games list
   */
  private async addToPublicGames(
    roomCode: string,
    hostName: string,
    gameType: string
  ): Promise<void> {
    // For simplicity, we publish each public game under its own key
    // A more sophisticated approach would maintain a shared list
    const gameInfo: PublicGame = {
      roomCode,
      hostName,
      gameType,
      createdAt: Date.now(),
    };

    const key = new TextEncoder().encode(`${getPublicGamesKey()}/${roomCode}`);
    await this.publishToDHT(key, gameInfo);
  }

  /**
   * Start polling for answers (host side)
   */
  private startAnswerPolling(roomCode: string): void {
    this.stopPolling();

    this.answerPollTimer = setInterval(async () => {
      if (this._state.phase !== 'waiting-for-guest') {
        this.stopPolling();
        return;
      }

      try {
        const answerData = await this.lookupFromDHT(
          getRoomKey(`${roomCode}-answer`)
        );

        if (answerData && answerData.type === 'answer' && this.peerConnection) {
          console.log('[DHT] Answer received, completing connection...');
          this.stopPolling();
          this.setState({ phase: 'connecting', role: 'host' });

          const answer = await decodeOffer(answerData.data as string);
          await this.peerConnection.acceptAnswer(answer);
        }
      } catch (error) {
        console.error('[DHT] Answer poll error:', error);
      }
    }, ANSWER_POLL_INTERVAL_MS);
  }

  /**
   * Stop all polling timers
   */
  private stopPolling(): void {
    if (this.answerPollTimer) {
      clearInterval(this.answerPollTimer);
      this.answerPollTimer = null;
    }
    if (this.publicGamesTimer) {
      clearInterval(this.publicGamesTimer);
      this.publicGamesTimer = null;
    }
  }

  /**
   * Start watching for public games
   */
  startPublicGamesWatch(): void {
    this.stopPublicGamesWatch();

    // Initial fetch
    this.fetchPublicGames();

    // Periodic refresh
    this.publicGamesTimer = setInterval(() => {
      this.fetchPublicGames();
    }, PUBLIC_GAMES_REFRESH_MS);
  }

  /**
   * Stop watching for public games
   */
  stopPublicGamesWatch(): void {
    if (this.publicGamesTimer) {
      clearInterval(this.publicGamesTimer);
      this.publicGamesTimer = null;
    }
  }

  /**
   * Fetch current public games
   */
  private async fetchPublicGames(): Promise<void> {
    if (!this.libp2p) {
      this.events.onPublicGamesUpdate([]);
      return;
    }

    try {
      const games: PublicGame[] = [];
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes max age

      // Query DHT for public games
      // This is a simplified approach - in production, you'd want a more
      // sophisticated discovery mechanism
      for await (const event of this.libp2p.services.dht.getClosestPeers(
        getPublicGamesKey(),
        { signal: AbortSignal.timeout(5000) }
      )) {
        // Process discovered peers that might have games
        if (event.name === 'PEER_RESPONSE') {
          // Try to get game info from these peers
          // For now, this is a placeholder - full implementation would
          // involve querying each peer for their hosted games
        }
      }

      // Filter out stale games
      const freshGames = games.filter(g => now - g.createdAt < maxAge);
      this.events.onPublicGamesUpdate(freshGames);
    } catch (error) {
      console.error('[DHT] Fetch public games error:', error);
      this.events.onPublicGamesUpdate([]);
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
   * Get current room code
   */
  getRoomCode(): string | null {
    return this.currentRoomCode;
  }

  /**
   * Check if DHT is available
   */
  isDHTAvailable(): boolean {
    return this.libp2p !== null && isConnectedToPeers();
  }

  /**
   * Clean up and reset
   */
  cleanup(): void {
    this.stopPolling();
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.currentRoomCode = null;
    this.isPublicGame = false;
    this.setState({ phase: 'idle' });
  }

  /**
   * Close the connection
   */
  close(): void {
    this.cleanup();
  }
}
