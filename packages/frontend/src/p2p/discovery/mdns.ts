/**
 * mDNS Local Discovery Module
 *
 * Provides automatic peer discovery on local networks using mDNS-like mechanisms.
 *
 * Browser Limitations:
 * - Browsers cannot directly use multicast DNS (mDNS) due to security restrictions
 * - True mDNS requires native access (Electron, PWA with native bridge, or Node.js)
 * - This module provides a fallback using local storage broadcast for same-device testing
 *   and is designed to integrate with libp2p mDNS when running in a capable environment
 *
 * For full LAN discovery:
 * - In Electron: Use @libp2p/mdns directly
 * - In PWA: Requires a local discovery service or WebSocket relay on LAN
 * - For development: Uses localStorage polling as a simulation
 */

import { PeerConnection, type ConnectionState, type PeerConnectionEvents } from '../webrtc';

export interface LANGame {
  id: string;
  hostName: string;
  hostPeerId: string;
  gameName: string;
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  offer?: string; // For direct connection
}

export interface MDNSDiscoveryEvents {
  onGameFound: (game: LANGame) => void;
  onGameLost: (gameId: string) => void;
  onError: (error: Error) => void;
}

export type MDNSState =
  | { status: 'idle' }
  | { status: 'discovering' }
  | { status: 'hosting'; gameId: string }
  | { status: 'error'; error: string };

// Storage key prefix for local simulation
const STORAGE_PREFIX = 'manamesh_lan_';
const GAME_LIST_KEY = `${STORAGE_PREFIX}games`;
const POLL_INTERVAL = 2000; // 2 seconds
const GAME_TTL = 30000; // 30 seconds before game is considered stale

/**
 * mDNS Discovery Manager
 * Handles LAN game discovery and hosting
 */
export class MDNSDiscovery {
  private events: MDNSDiscoveryEvents;
  private _state: MDNSState = { status: 'idle' };
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private knownGames: Map<string, LANGame> = new Map();
  private hostedGame: LANGame | null = null;

  constructor(events: MDNSDiscoveryEvents) {
    this.events = events;
  }

  get state(): MDNSState {
    return this._state;
  }

  private setState(state: MDNSState): void {
    this._state = state;
  }

  /**
   * Check if mDNS is supported in current environment
   * Returns true for Electron/Node environments, false for plain browsers
   */
  static isSupported(): boolean {
    // Check for Electron
    if (typeof window !== 'undefined' && 'process' in window) {
      return true;
    }

    // In browser, we use localStorage fallback for development
    // Real mDNS would need native support
    return typeof localStorage !== 'undefined';
  }

  /**
   * Get the discovery mode being used
   */
  static getMode(): 'native' | 'localStorage' | 'unsupported' {
    if (typeof window !== 'undefined' && 'process' in window) {
      return 'native';
    }
    if (typeof localStorage !== 'undefined') {
      return 'localStorage';
    }
    return 'unsupported';
  }

  /**
   * Start discovering LAN games
   */
  startDiscovery(): void {
    if (this._state.status === 'discovering') {
      return; // Already discovering
    }

    this.setState({ status: 'discovering' });
    this.knownGames.clear();

    // Start polling for games
    this.discoveryInterval = setInterval(() => {
      this.pollForGames();
    }, POLL_INTERVAL);

    // Do initial poll immediately
    this.pollForGames();

    console.log('[mDNS] Discovery started');
  }

  /**
   * Stop discovering LAN games
   */
  stopDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }

    // Emit game lost events for all known games
    for (const gameId of this.knownGames.keys()) {
      this.events.onGameLost(gameId);
    }
    this.knownGames.clear();

    if (this._state.status === 'discovering') {
      this.setState({ status: 'idle' });
    }

    console.log('[mDNS] Discovery stopped');
  }

  /**
   * Host a LAN game (broadcast availability)
   */
  async hostGame(gameName: string, hostName: string, maxPlayers: number = 2): Promise<LANGame> {
    // Stop any existing hosting
    this.stopHosting();

    const gameId = this.generateGameId();

    this.hostedGame = {
      id: gameId,
      hostName,
      hostPeerId: gameId, // In real implementation, this would be libp2p peer ID
      gameName,
      playerCount: 1,
      maxPlayers,
      createdAt: Date.now(),
    };

    // Register game
    this.registerGame(this.hostedGame);

    // Start heartbeat to keep game alive
    this.heartbeatInterval = setInterval(() => {
      if (this.hostedGame) {
        this.hostedGame.createdAt = Date.now(); // Update timestamp
        this.registerGame(this.hostedGame);
      }
    }, POLL_INTERVAL);

    this.setState({ status: 'hosting', gameId });

    console.log('[mDNS] Hosting game:', gameName);
    return this.hostedGame;
  }

  /**
   * Stop hosting the current game
   */
  stopHosting(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.hostedGame) {
      this.unregisterGame(this.hostedGame.id);
      this.hostedGame = null;
    }

    if (this._state.status === 'hosting') {
      this.setState({ status: 'idle' });
    }

    console.log('[mDNS] Stopped hosting');
  }

  /**
   * Update player count for hosted game
   */
  updatePlayerCount(count: number): void {
    if (this.hostedGame) {
      this.hostedGame.playerCount = count;
      this.registerGame(this.hostedGame);
    }
  }

  /**
   * Get list of currently discovered games
   */
  getDiscoveredGames(): LANGame[] {
    return Array.from(this.knownGames.values());
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    this.stopDiscovery();
    this.stopHosting();
    this.setState({ status: 'idle' });
  }

  // --- Private methods ---

  private generateGameId(): string {
    return `game_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private pollForGames(): void {
    try {
      const gamesJson = localStorage.getItem(GAME_LIST_KEY);
      const games: LANGame[] = gamesJson ? JSON.parse(gamesJson) : [];
      const now = Date.now();
      const currentGameIds = new Set<string>();

      for (const game of games) {
        // Skip stale games
        if (now - game.createdAt > GAME_TTL) {
          continue;
        }

        // Skip our own game
        if (this.hostedGame && game.id === this.hostedGame.id) {
          continue;
        }

        currentGameIds.add(game.id);

        // Check if this is a new game
        if (!this.knownGames.has(game.id)) {
          this.knownGames.set(game.id, game);
          this.events.onGameFound(game);
        } else {
          // Update existing game info
          this.knownGames.set(game.id, game);
        }
      }

      // Check for lost games
      for (const [gameId] of this.knownGames) {
        if (!currentGameIds.has(gameId)) {
          this.knownGames.delete(gameId);
          this.events.onGameLost(gameId);
        }
      }

      // Clean up stale games from storage
      this.cleanupStaleGames();
    } catch (error) {
      console.error('[mDNS] Error polling for games:', error);
      this.events.onError(error instanceof Error ? error : new Error('Failed to poll for games'));
    }
  }

  private registerGame(game: LANGame): void {
    try {
      const gamesJson = localStorage.getItem(GAME_LIST_KEY);
      const games: LANGame[] = gamesJson ? JSON.parse(gamesJson) : [];

      // Remove existing entry for this game
      const filteredGames = games.filter(g => g.id !== game.id);

      // Add updated game
      filteredGames.push(game);

      localStorage.setItem(GAME_LIST_KEY, JSON.stringify(filteredGames));
    } catch (error) {
      console.error('[mDNS] Error registering game:', error);
    }
  }

  private unregisterGame(gameId: string): void {
    try {
      const gamesJson = localStorage.getItem(GAME_LIST_KEY);
      const games: LANGame[] = gamesJson ? JSON.parse(gamesJson) : [];

      const filteredGames = games.filter(g => g.id !== gameId);

      localStorage.setItem(GAME_LIST_KEY, JSON.stringify(filteredGames));
    } catch (error) {
      console.error('[mDNS] Error unregistering game:', error);
    }
  }

  private cleanupStaleGames(): void {
    try {
      const gamesJson = localStorage.getItem(GAME_LIST_KEY);
      const games: LANGame[] = gamesJson ? JSON.parse(gamesJson) : [];
      const now = Date.now();

      const activeGames = games.filter(g => now - g.createdAt <= GAME_TTL);

      if (activeGames.length !== games.length) {
        localStorage.setItem(GAME_LIST_KEY, JSON.stringify(activeGames));
      }
    } catch (error) {
      console.error('[mDNS] Error cleaning up stale games:', error);
    }
  }
}

/**
 * LAN Connection Helper
 * Combines mDNS discovery with WebRTC connection establishment
 */
export class LANConnection {
  private discovery: MDNSDiscovery;
  private peerConnection: PeerConnection | null = null;
  private connectionEvents: PeerConnectionEvents;

  constructor(
    discoveryEvents: MDNSDiscoveryEvents,
    connectionEvents: PeerConnectionEvents
  ) {
    this.discovery = new MDNSDiscovery(discoveryEvents);
    this.connectionEvents = connectionEvents;
  }

  get discoveryState(): MDNSState {
    return this.discovery.state;
  }

  /**
   * Start discovering games on LAN
   */
  startDiscovery(): void {
    this.discovery.startDiscovery();
  }

  /**
   * Stop discovering games
   */
  stopDiscovery(): void {
    this.discovery.stopDiscovery();
  }

  /**
   * Host a LAN game
   */
  async hostGame(gameName: string, hostName: string): Promise<LANGame> {
    return this.discovery.hostGame(gameName, hostName);
  }

  /**
   * Stop hosting
   */
  stopHosting(): void {
    this.discovery.stopHosting();
  }

  /**
   * Get discovered games
   */
  getDiscoveredGames(): LANGame[] {
    return this.discovery.getDiscoveredGames();
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.discovery.cleanup();
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}
