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
  it('createRoom transitions through correct states when DHT unavailable', async () => {
    const calls: DHTState[] = [];
    const events: DHTEvents = {
      onStateChange: (state) => calls.push(state),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate: vi.fn(),
    };

    const connection = new DHTConnection(events);

    // Without libp2p initialized, createRoom should fail gracefully
    await expect(connection.createRoom()).rejects.toThrow();

    // Should have gone through initializing state before error
    expect(calls.some(s => s.phase === 'initializing')).toBe(true);
    expect(calls.some(s => s.phase === 'error')).toBe(true);
  });

  it('joinRoom transitions through correct states when DHT unavailable', async () => {
    const calls: DHTState[] = [];
    const events: DHTEvents = {
      onStateChange: (state) => calls.push(state),
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onPublicGamesUpdate: vi.fn(),
    };

    const connection = new DHTConnection(events);

    // Without libp2p initialized, joinRoom should fail gracefully
    await expect(connection.joinRoom('ABC123')).rejects.toThrow();

    // Should have gone through initializing state before error
    expect(calls.some(s => s.phase === 'initializing')).toBe(true);
    expect(calls.some(s => s.phase === 'error')).toBe(true);
  });
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
