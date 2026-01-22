/**
 * Tests for mDNS Local Discovery Module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MDNSDiscovery, type LANGame, type MDNSDiscoveryEvents } from './mdns';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

describe('MDNSDiscovery', () => {
  let discovery: MDNSDiscovery;
  let events: MDNSDiscoveryEvents;
  let onGameFound: ReturnType<typeof vi.fn>;
  let onGameLost: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorageMock.clear();

    onGameFound = vi.fn();
    onGameLost = vi.fn();
    onError = vi.fn();

    events = {
      onGameFound,
      onGameLost,
      onError,
    };

    discovery = new MDNSDiscovery(events);
  });

  afterEach(() => {
    discovery.cleanup();
    vi.useRealTimers();
  });

  describe('isSupported', () => {
    it('should return true when localStorage is available', () => {
      expect(MDNSDiscovery.isSupported()).toBe(true);
    });

    it('should return correct mode for browser environment', () => {
      expect(MDNSDiscovery.getMode()).toBe('localStorage');
    });
  });

  describe('state management', () => {
    it('should start in idle state', () => {
      expect(discovery.state).toEqual({ status: 'idle' });
    });

    it('should transition to discovering state when started', () => {
      discovery.startDiscovery();
      expect(discovery.state).toEqual({ status: 'discovering' });
    });

    it('should transition to idle state when stopped', () => {
      discovery.startDiscovery();
      discovery.stopDiscovery();
      expect(discovery.state).toEqual({ status: 'idle' });
    });
  });

  describe('hosting games', () => {
    it('should host a game and set hosting state', async () => {
      const game = await discovery.hostGame('Test Game', 'TestHost');

      expect(game.gameName).toBe('Test Game');
      expect(game.hostName).toBe('TestHost');
      expect(game.playerCount).toBe(1);
      expect(game.maxPlayers).toBe(2);
      expect(discovery.state.status).toBe('hosting');
    });

    it('should register game in localStorage when hosting', async () => {
      await discovery.hostGame('Test Game', 'TestHost');

      expect(localStorageMock.setItem).toHaveBeenCalled();
      const storedGames = JSON.parse(
        localStorageMock.setItem.mock.calls[0][1]
      ) as LANGame[];
      expect(storedGames.length).toBe(1);
      expect(storedGames[0].gameName).toBe('Test Game');
    });

    it('should stop hosting and cleanup', async () => {
      await discovery.hostGame('Test Game', 'TestHost');
      discovery.stopHosting();

      expect(discovery.state).toEqual({ status: 'idle' });
    });

    it('should update player count', async () => {
      await discovery.hostGame('Test Game', 'TestHost');
      discovery.updatePlayerCount(2);

      // Advance timers to trigger heartbeat
      vi.advanceTimersByTime(2100);

      const storedGames = JSON.parse(
        localStorageMock.setItem.mock.calls.at(-1)?.[1] ?? '[]'
      ) as LANGame[];
      expect(storedGames[0].playerCount).toBe(2);
    });
  });

  describe('discovering games', () => {
    it('should emit onGameFound when a new game is discovered', async () => {
      // First, set up a game in storage (simulating another instance)
      const otherGame: LANGame = {
        id: 'other-game-123',
        hostName: 'OtherHost',
        hostPeerId: 'peer-123',
        gameName: 'Other Game',
        playerCount: 1,
        maxPlayers: 2,
        createdAt: Date.now(),
      };
      localStorageMock.setItem('manamesh_lan_games', JSON.stringify([otherGame]));

      discovery.startDiscovery();

      // First poll happens immediately
      expect(onGameFound).toHaveBeenCalledWith(otherGame);
    });

    it('should not discover own hosted game', async () => {
      const hostedGame = await discovery.hostGame('My Game', 'Me');
      discovery.startDiscovery();

      // Should not emit our own game
      expect(onGameFound).not.toHaveBeenCalled();
    });

    it('should emit onGameLost when a game disappears', async () => {
      // Set up a game
      const otherGame: LANGame = {
        id: 'other-game-123',
        hostName: 'OtherHost',
        hostPeerId: 'peer-123',
        gameName: 'Other Game',
        playerCount: 1,
        maxPlayers: 2,
        createdAt: Date.now(),
      };
      localStorageMock.setItem('manamesh_lan_games', JSON.stringify([otherGame]));

      discovery.startDiscovery();
      expect(onGameFound).toHaveBeenCalledTimes(1);

      // Remove the game
      localStorageMock.setItem('manamesh_lan_games', JSON.stringify([]));

      // Advance time to trigger next poll
      vi.advanceTimersByTime(2100);

      expect(onGameLost).toHaveBeenCalledWith('other-game-123');
    });

    it('should filter out stale games (older than TTL)', async () => {
      // Set up a stale game (older than 30 seconds)
      const staleGame: LANGame = {
        id: 'stale-game',
        hostName: 'StaleHost',
        hostPeerId: 'peer-stale',
        gameName: 'Stale Game',
        playerCount: 1,
        maxPlayers: 2,
        createdAt: Date.now() - 35000, // 35 seconds ago
      };
      localStorageMock.setItem('manamesh_lan_games', JSON.stringify([staleGame]));

      discovery.startDiscovery();

      // Stale games should not trigger onGameFound
      expect(onGameFound).not.toHaveBeenCalled();
    });

    it('should return discovered games via getDiscoveredGames', async () => {
      const otherGame: LANGame = {
        id: 'other-game-123',
        hostName: 'OtherHost',
        hostPeerId: 'peer-123',
        gameName: 'Other Game',
        playerCount: 1,
        maxPlayers: 2,
        createdAt: Date.now(),
      };
      localStorageMock.setItem('manamesh_lan_games', JSON.stringify([otherGame]));

      discovery.startDiscovery();

      const games = discovery.getDiscoveredGames();
      expect(games).toHaveLength(1);
      expect(games[0].id).toBe('other-game-123');
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources', async () => {
      await discovery.hostGame('Test Game', 'TestHost');
      discovery.startDiscovery();

      discovery.cleanup();

      expect(discovery.state).toEqual({ status: 'idle' });
      expect(discovery.getDiscoveredGames()).toHaveLength(0);
    });

    it('should emit onGameLost for all known games on stopDiscovery', async () => {
      const game1: LANGame = {
        id: 'game-1',
        hostName: 'Host1',
        hostPeerId: 'peer-1',
        gameName: 'Game 1',
        playerCount: 1,
        maxPlayers: 2,
        createdAt: Date.now(),
      };
      const game2: LANGame = {
        id: 'game-2',
        hostName: 'Host2',
        hostPeerId: 'peer-2',
        gameName: 'Game 2',
        playerCount: 1,
        maxPlayers: 2,
        createdAt: Date.now(),
      };
      localStorageMock.setItem('manamesh_lan_games', JSON.stringify([game1, game2]));

      discovery.startDiscovery();
      expect(onGameFound).toHaveBeenCalledTimes(2);

      discovery.stopDiscovery();

      expect(onGameLost).toHaveBeenCalledWith('game-1');
      expect(onGameLost).toHaveBeenCalledWith('game-2');
    });
  });

  describe('heartbeat', () => {
    it('should update game timestamp periodically when hosting', async () => {
      const game = await discovery.hostGame('Test Game', 'TestHost');
      const initialTimestamp = game.createdAt;

      // Advance time to trigger heartbeat
      vi.advanceTimersByTime(2100);

      const storedGames = JSON.parse(
        localStorageMock.setItem.mock.calls.at(-1)?.[1] ?? '[]'
      ) as LANGame[];

      // Timestamp should be updated
      expect(storedGames[0].createdAt).toBeGreaterThan(initialTimestamp);
    });
  });
});
