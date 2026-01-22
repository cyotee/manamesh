/**
 * Tests for DHT Discovery Module
 * Tests room code generation, normalization, and DHT connection logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateRoomCode,
  normalizeRoomCode,
  isValidRoomCode,
  DHTConnection,
  type DHTState,
  type DHTEvents,
  type PublicGame,
} from './dht';

describe('Room Code Generation', () => {
  describe('generateRoomCode', () => {
    it('generates a 6-character code', () => {
      const code = generateRoomCode();
      expect(code.length).toBe(6);
    });

    it('generates only uppercase alphanumeric characters', () => {
      const code = generateRoomCode();
      expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
    });

    it('generates unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateRoomCode());
      }
      // With 6 chars from 32 char set, collision should be extremely rare
      expect(codes.size).toBe(100);
    });

    it('excludes confusing characters (0, O, I, 1)', () => {
      // Generate many codes and check none contain confusing chars
      for (let i = 0; i < 100; i++) {
        const code = generateRoomCode();
        expect(code).not.toMatch(/[0OI1]/);
      }
    });
  });

  describe('normalizeRoomCode', () => {
    it('converts to uppercase', () => {
      expect(normalizeRoomCode('abc123')).toBe('ABC123');
    });

    it('removes non-alphanumeric characters', () => {
      expect(normalizeRoomCode('ABC-123')).toBe('ABC123');
      expect(normalizeRoomCode('ABC 123')).toBe('ABC123');
      expect(normalizeRoomCode('ABC_123')).toBe('ABC123');
    });

    it('handles already normalized codes', () => {
      expect(normalizeRoomCode('ABC123')).toBe('ABC123');
    });

    it('handles mixed case and special chars', () => {
      expect(normalizeRoomCode('aBc-1 2_3')).toBe('ABC123');
    });
  });

  describe('isValidRoomCode', () => {
    it('accepts valid 6-character codes', () => {
      expect(isValidRoomCode('ABC123')).toBe(true);
      expect(isValidRoomCode('ZZZZZ9')).toBe(true);
    });

    it('accepts lowercase codes (after normalization)', () => {
      expect(isValidRoomCode('abc123')).toBe(true);
    });

    it('rejects codes that are too short', () => {
      expect(isValidRoomCode('ABC12')).toBe(false);
      expect(isValidRoomCode('A')).toBe(false);
      expect(isValidRoomCode('')).toBe(false);
    });

    it('rejects codes that are too long', () => {
      expect(isValidRoomCode('ABC1234')).toBe(false);
    });

    it('accepts codes with removed special chars if length is correct', () => {
      // After normalization 'ABC-12' becomes 'ABC12' which is only 5 chars
      expect(isValidRoomCode('ABC-12')).toBe(false);
      // 'ABC-123' becomes 'ABC123' which is 6 chars
      expect(isValidRoomCode('ABC-123')).toBe(true);
    });
  });
});

describe('DHTConnection', () => {
  const createMockEvents = (): {
    events: DHTEvents;
    calls: {
      stateChanges: DHTState[];
      messages: string[];
      publicGames: PublicGame[][];
    };
  } => {
    const calls = {
      stateChanges: [] as DHTState[],
      messages: [] as string[],
      publicGames: [] as PublicGame[][],
    };

    return {
      events: {
        onStateChange: (state) => calls.stateChanges.push(state),
        onMessage: (data) => calls.messages.push(data),
        onConnectionStateChange: vi.fn(),
        onPublicGamesUpdate: (games) => calls.publicGames.push(games),
      },
      calls,
    };
  };

  describe('constructor', () => {
    it('initializes with idle state', () => {
      const { events } = createMockEvents();
      const connection = new DHTConnection(events);

      expect(connection.state).toEqual({ phase: 'idle' });
    });
  });

  describe('isConnected', () => {
    it('returns false when not connected', () => {
      const { events } = createMockEvents();
      const connection = new DHTConnection(events);

      expect(connection.isConnected()).toBe(false);
    });
  });

  describe('getRoomCode', () => {
    it('returns null when no room is created', () => {
      const { events } = createMockEvents();
      const connection = new DHTConnection(events);

      expect(connection.getRoomCode()).toBe(null);
    });
  });

  describe('isDHTAvailable', () => {
    it('returns false when libp2p is not initialized', () => {
      const { events } = createMockEvents();
      const connection = new DHTConnection(events);

      expect(connection.isDHTAvailable()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('resets state to idle', () => {
      const { events, calls } = createMockEvents();
      const connection = new DHTConnection(events);

      connection.cleanup();

      expect(connection.state).toEqual({ phase: 'idle' });
      expect(calls.stateChanges).toContainEqual({ phase: 'idle' });
    });

    it('clears room code', () => {
      const { events } = createMockEvents();
      const connection = new DHTConnection(events);

      connection.cleanup();

      expect(connection.getRoomCode()).toBe(null);
    });
  });

  describe('close', () => {
    it('calls cleanup', () => {
      const { events, calls } = createMockEvents();
      const connection = new DHTConnection(events);

      connection.close();

      expect(connection.state).toEqual({ phase: 'idle' });
      expect(calls.stateChanges).toContainEqual({ phase: 'idle' });
    });
  });
});

describe('Error handling', () => {
  it('joinRoom rejects invalid room codes', async () => {
    const { events } = {
      events: {
        onStateChange: vi.fn(),
        onMessage: vi.fn(),
        onConnectionStateChange: vi.fn(),
        onPublicGamesUpdate: vi.fn(),
      },
    };

    const connection = new DHTConnection(events);

    await expect(connection.joinRoom('ABC')).rejects.toThrow('Invalid room code format');
  });

  it('joinRoom rejects empty room codes', async () => {
    const { events } = {
      events: {
        onStateChange: vi.fn(),
        onMessage: vi.fn(),
        onConnectionStateChange: vi.fn(),
        onPublicGamesUpdate: vi.fn(),
      },
    };

    const connection = new DHTConnection(events);

    await expect(connection.joinRoom('')).rejects.toThrow('Invalid room code format');
  });

  it('send throws when not connected', () => {
    const { events } = {
      events: {
        onStateChange: vi.fn(),
        onMessage: vi.fn(),
        onConnectionStateChange: vi.fn(),
        onPublicGamesUpdate: vi.fn(),
      },
    };

    const connection = new DHTConnection(events);

    expect(() => connection.send('test')).toThrow('Not connected');
  });
});

describe('State transitions', () => {
  // These tests take longer because libp2p actually initializes and waits for bootstrap
  it('createRoom transitions through correct states when DHT unavailable', async () => {
    const calls: DHTState[] = [];
    const events: DHTEvents = {
      onStateChange: (state) => calls.push(state),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate: vi.fn(),
    };

    const connection = new DHTConnection(events);

    // Without bootstrap peer connection, createRoom should fail gracefully
    await expect(connection.createRoom()).rejects.toThrow();

    // Should have gone through initializing state before error
    expect(calls.some(s => s.phase === 'initializing')).toBe(true);
    expect(calls.some(s => s.phase === 'error')).toBe(true);
  }, 15000); // 15 second timeout for libp2p initialization

  it('joinRoom transitions through correct states when DHT unavailable', async () => {
    const calls: DHTState[] = [];
    const events: DHTEvents = {
      onStateChange: (state) => calls.push(state),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate: vi.fn(),
    };

    const connection = new DHTConnection(events);

    // Without bootstrap peer connection, joinRoom should fail gracefully
    await expect(connection.joinRoom('ABC123')).rejects.toThrow();

    // Should have gone through initializing state before error
    expect(calls.some(s => s.phase === 'initializing')).toBe(true);
    expect(calls.some(s => s.phase === 'error')).toBe(true);
  }, 15000); // 15 second timeout for libp2p initialization
});

describe('Public games', () => {
  it('stopPublicGamesWatch is safe to call without starting', () => {
    const events: DHTEvents = {
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate: vi.fn(),
    };

    const connection = new DHTConnection(events);

    // Should not throw
    expect(() => connection.stopPublicGamesWatch()).not.toThrow();
  });

  it('startPublicGamesWatch calls onPublicGamesUpdate', () => {
    const onPublicGamesUpdate = vi.fn();
    const events: DHTEvents = {
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate,
    };

    const connection = new DHTConnection(events);

    // Start watching (will fail to fetch but should call update with empty array)
    connection.startPublicGamesWatch();

    // Wait a tick for the initial fetch
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(onPublicGamesUpdate).toHaveBeenCalledWith([]);
        connection.stopPublicGamesWatch();
        resolve();
      }, 100);
    });
  });
});

describe('Public game key generation', () => {
  // Import key generators for testing
  it('exports correct key helpers from libp2p-config', async () => {
    const {
      getPublicGamesKey,
      getPublicGamesIndexKey,
      getPublicGameKey,
      PUBLIC_GAMES_TOPIC,
    } = await import('../libp2p-config');

    const decoder = new TextDecoder();

    // Public games key matches the topic
    const publicGamesKey = getPublicGamesKey();
    expect(decoder.decode(publicGamesKey)).toBe(PUBLIC_GAMES_TOPIC);

    // Index key is the topic + /index
    const indexKey = getPublicGamesIndexKey();
    expect(decoder.decode(indexKey)).toBe(`${PUBLIC_GAMES_TOPIC}/index`);

    // Game key includes the room code (uppercase)
    const gameKey = getPublicGameKey('abc123');
    expect(decoder.decode(gameKey)).toBe(`${PUBLIC_GAMES_TOPIC}/ABC123`);
  });

  it('getPublicGameKey normalizes room codes to uppercase', async () => {
    const { getPublicGameKey, PUBLIC_GAMES_TOPIC } = await import('../libp2p-config');
    const decoder = new TextDecoder();

    const key1 = getPublicGameKey('abc123');
    const key2 = getPublicGameKey('ABC123');
    const key3 = getPublicGameKey('AbC123');

    expect(decoder.decode(key1)).toBe(`${PUBLIC_GAMES_TOPIC}/ABC123`);
    expect(decoder.decode(key2)).toBe(`${PUBLIC_GAMES_TOPIC}/ABC123`);
    expect(decoder.decode(key3)).toBe(`${PUBLIC_GAMES_TOPIC}/ABC123`);
  });
});

describe('PublicGame type validation', () => {
  it('validates complete PublicGame objects with expiresAt', () => {
    const now = Date.now();
    const validGame: PublicGame = {
      roomCode: 'ABC123',
      hostName: 'Player 1',
      gameType: 'MTG',
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000, // 5 minute TTL
    };

    expect(validGame.roomCode).toBe('ABC123');
    expect(validGame.hostName).toBe('Player 1');
    expect(validGame.gameType).toBe('MTG');
    expect(typeof validGame.createdAt).toBe('number');
    expect(typeof validGame.expiresAt).toBe('number');
    expect(validGame.expiresAt).toBeGreaterThan(validGame.createdAt);
  });

  it('allows different game types', () => {
    const now = Date.now();
    const games: PublicGame[] = [
      { roomCode: 'ABC123', hostName: 'Host 1', gameType: 'MTG', createdAt: now, expiresAt: now + 300000 },
      { roomCode: 'DEF456', hostName: 'Host 2', gameType: 'Pokemon', createdAt: now, expiresAt: now + 300000 },
      { roomCode: 'GHI789', hostName: 'Host 3', gameType: 'Lorcana', createdAt: now, expiresAt: now + 300000 },
    ];

    expect(games.length).toBe(3);
    expect(games.map(g => g.gameType)).toEqual(['MTG', 'Pokemon', 'Lorcana']);
  });
});

describe('Index-based public game discovery', () => {
  it('DHTConnection exposes startPublicGamesWatch and stopPublicGamesWatch', () => {
    const events: DHTEvents = {
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate: vi.fn(),
    };

    const connection = new DHTConnection(events);

    // Verify methods exist
    expect(typeof connection.startPublicGamesWatch).toBe('function');
    expect(typeof connection.stopPublicGamesWatch).toBe('function');
  });

  it('public games update is called with empty array when libp2p not initialized', async () => {
    const onPublicGamesUpdate = vi.fn();
    const events: DHTEvents = {
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate,
    };

    const connection = new DHTConnection(events);

    // Start watching - should immediately call with empty array since no libp2p
    connection.startPublicGamesWatch();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onPublicGamesUpdate).toHaveBeenCalledWith([]);
    connection.stopPublicGamesWatch();
  });

  it('stopping watch prevents further updates', async () => {
    const onPublicGamesUpdate = vi.fn();
    const events: DHTEvents = {
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate,
    };

    const connection = new DHTConnection(events);

    // Start and immediately stop
    connection.startPublicGamesWatch();
    connection.stopPublicGamesWatch();

    const callCountAfterStop = onPublicGamesUpdate.mock.calls.length;

    // Wait for what would be a refresh interval
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should not have more calls after stopping
    expect(onPublicGamesUpdate.mock.calls.length).toBe(callCountAfterStop);
  });
});

describe('Record expiry logic', () => {
  it('PublicGame expiresAt should be in the future', () => {
    const now = Date.now();
    const RECORD_TTL_MS = 5 * 60 * 1000; // Same as in dht.ts

    const game: PublicGame = {
      roomCode: 'ABC123',
      hostName: 'Player 1',
      gameType: 'MTG',
      createdAt: now,
      expiresAt: now + RECORD_TTL_MS,
    };

    // expiresAt should be 5 minutes in the future
    expect(game.expiresAt - game.createdAt).toBe(RECORD_TTL_MS);
    expect(game.expiresAt).toBeGreaterThan(now);
  });

  it('detects expired games by expiresAt', () => {
    const now = Date.now();
    const pastTime = now - 10 * 60 * 1000; // 10 minutes ago

    const expiredGame: PublicGame = {
      roomCode: 'OLDGAME',
      hostName: 'Old Player',
      gameType: 'MTG',
      createdAt: pastTime,
      expiresAt: pastTime + 5 * 60 * 1000, // Expired 5 minutes ago
    };

    const freshGame: PublicGame = {
      roomCode: 'NEWGAME',
      hostName: 'New Player',
      gameType: 'MTG',
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000, // Expires in 5 minutes
    };

    // Expired game's expiresAt is in the past
    expect(now > expiredGame.expiresAt).toBe(true);

    // Fresh game's expiresAt is in the future
    expect(now < freshGame.expiresAt).toBe(true);
  });

  it('can filter expired games from a list', () => {
    const now = Date.now();
    const RECORD_TTL_MS = 5 * 60 * 1000;

    const games: PublicGame[] = [
      // Fresh game - should be kept
      {
        roomCode: 'FRESH1',
        hostName: 'Host 1',
        gameType: 'MTG',
        createdAt: now,
        expiresAt: now + RECORD_TTL_MS,
      },
      // Expired game - should be filtered out
      {
        roomCode: 'EXPIRED',
        hostName: 'Host 2',
        gameType: 'MTG',
        createdAt: now - 10 * 60 * 1000,
        expiresAt: now - 5 * 60 * 1000, // Expired 5 minutes ago
      },
      // Another fresh game - should be kept
      {
        roomCode: 'FRESH2',
        hostName: 'Host 3',
        gameType: 'Pokemon',
        createdAt: now - 1 * 60 * 1000,
        expiresAt: now + 4 * 60 * 1000, // Expires in 4 minutes
      },
    ];

    // Filter out expired games (same logic as in fetchPublicGames)
    const freshGames = games.filter(game => {
      const isExpired = game.expiresAt
        ? now > game.expiresAt
        : now - game.createdAt > RECORD_TTL_MS;
      return !isExpired;
    });

    expect(freshGames.length).toBe(2);
    expect(freshGames.map(g => g.roomCode)).toEqual(['FRESH1', 'FRESH2']);
    expect(freshGames.find(g => g.roomCode === 'EXPIRED')).toBeUndefined();
  });

  it('falls back to createdAt if expiresAt is missing', () => {
    const now = Date.now();
    const RECORD_TTL_MS = 5 * 60 * 1000;

    // Legacy game without expiresAt field (cast to test backward compat)
    const legacyGame = {
      roomCode: 'LEGACY',
      hostName: 'Legacy Host',
      gameType: 'MTG',
      createdAt: now - 6 * 60 * 1000, // 6 minutes ago (expired by TTL)
    } as PublicGame;

    // Filter logic should use createdAt when expiresAt is missing
    const isExpired = legacyGame.expiresAt
      ? now > legacyGame.expiresAt
      : now - legacyGame.createdAt > RECORD_TTL_MS;

    expect(isExpired).toBe(true); // Should be expired based on createdAt
  });

  it('keeps games with expiresAt even if createdAt is old', () => {
    const now = Date.now();
    const RECORD_TTL_MS = 5 * 60 * 1000;

    // Game with old createdAt but recently republished (fresh expiresAt)
    const republishedGame: PublicGame = {
      roomCode: 'REPUBLISHED',
      hostName: 'Active Host',
      gameType: 'MTG',
      createdAt: now - 30 * 60 * 1000, // Created 30 minutes ago
      expiresAt: now + 3 * 60 * 1000, // But just republished, expires in 3 minutes
    };

    const isExpired = republishedGame.expiresAt
      ? now > republishedGame.expiresAt
      : now - republishedGame.createdAt > RECORD_TTL_MS;

    expect(isExpired).toBe(false); // Should NOT be expired because expiresAt is fresh
  });
});
