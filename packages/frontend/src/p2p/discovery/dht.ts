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
  getPublicGamesIndexKey,
  getPublicGameKey,
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
   *
   * This uses a two-part approach:
   * 1. Store the game details under a game-specific key
   * 2. Update the index with the room code
   */
  private async addToPublicGames(
    roomCode: string,
    hostName: string,
    gameType: string
  ): Promise<void> {
    const gameInfo: PublicGame = {
      roomCode,
      hostName,
      gameType,
      createdAt: Date.now(),
    };

    // 1. Store game details under its own key
    await this.publishToDHT(getPublicGameKey(roomCode), gameInfo);
    console.log(`[DHT] Published public game: ${roomCode}`);

    // 2. Update the index with this room code
    await this.updatePublicGamesIndex(roomCode);
  }

  /**
   * Update the public games index with a new room code
   */
  private async updatePublicGamesIndex(roomCode: string): Promise<void> {
    try {
      // Fetch current index
      const currentIndex = await this.lookupFromDHT(getPublicGamesIndexKey());
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes

      let roomCodes: Array<{ code: string; timestamp: number }> = [];

      if (currentIndex && Array.isArray(currentIndex.rooms)) {
        // Filter out stale entries
        roomCodes = (currentIndex.rooms as Array<{ code: string; timestamp: number }>)
          .filter(entry => now - entry.timestamp < maxAge);
      }

      // Add or update this room code
      const existingIndex = roomCodes.findIndex(entry => entry.code === roomCode);
      if (existingIndex >= 0) {
        roomCodes[existingIndex].timestamp = now;
      } else {
        roomCodes.push({ code: roomCode, timestamp: now });
      }

      // Publish updated index
      await this.publishToDHT(getPublicGamesIndexKey(), {
        rooms: roomCodes,
        updatedAt: now,
      });
      console.log(`[DHT] Updated public games index with ${roomCodes.length} entries`);
    } catch (error) {
      console.error('[DHT] Failed to update public games index:', error);
      // Don't throw - the game is still published, just not indexed
    }
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
   *
   * This uses a two-step approach:
   * 1. Fetch the index to get room codes
   * 2. Fetch each game's details from its individual key
   */
  private async fetchPublicGames(): Promise<void> {
    if (!this.libp2p) {
      this.events.onPublicGamesUpdate([]);
      return;
    }

    try {
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes max age

      // Step 1: Fetch the index
      const indexData = await this.lookupFromDHT(getPublicGamesIndexKey());

      if (!indexData || !Array.isArray(indexData.rooms)) {
        console.log('[DHT] No public games index found');
        this.events.onPublicGamesUpdate([]);
        return;
      }

      // Filter out stale room codes from index
      const freshRoomCodes = (indexData.rooms as Array<{ code: string; timestamp: number }>)
        .filter(entry => now - entry.timestamp < maxAge)
        .map(entry => entry.code);

      console.log(`[DHT] Found ${freshRoomCodes.length} room codes in index`);

      // Step 2: Fetch each game's details
      const games: PublicGame[] = [];

      for (const roomCode of freshRoomCodes) {
        try {
          const gameData = await this.lookupFromDHT(getPublicGameKey(roomCode));

          if (gameData && this.isValidPublicGame(gameData)) {
            const game = gameData as unknown as PublicGame;
            // Double-check freshness
            if (now - game.createdAt < maxAge) {
              games.push(game);
            }
          }
        } catch (error) {
          // Skip games we can't fetch
          console.warn(`[DHT] Could not fetch game ${roomCode}:`, error);
        }
      }

      console.log(`[DHT] Retrieved ${games.length} public games`);

      // Sort by creation time (newest first)
      games.sort((a, b) => b.createdAt - a.createdAt);

      this.events.onPublicGamesUpdate(games);
    } catch (error) {
      console.error('[DHT] Fetch public games error:', error);
      this.events.onPublicGamesUpdate([]);
    }
  }

  /**
   * Type guard to validate a PublicGame object
   */
  private isValidPublicGame(data: unknown): data is PublicGame {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.roomCode === 'string' &&
      typeof obj.hostName === 'string' &&
      typeof obj.gameType === 'string' &&
      typeof obj.createdAt === 'number'
    );
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
