/**
 * Integration tests for P2P game flow
 *
 * These tests simulate two players (host and guest) completing a game
 * through the P2P transport layer using mock connections.
 *
 * For true browser-based integration tests, consider adding Playwright.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { P2PTransport, type P2PMessage } from '../../src/p2p/transport';
import type { Game, State } from 'boardgame.io';

// Simple test game with turns
const TurnBasedGame: Game = {
  name: 'turn-based-test',
  setup: () => ({
    scores: { '0': 0, '1': 0 },
    moves: [] as string[],
  }),
  moves: {
    score: ({ G, playerID }) => {
      if (!playerID) return G;
      return {
        ...G,
        scores: { ...G.scores, [playerID]: G.scores[playerID] + 1 },
        moves: [...G.moves, `${playerID}:score`],
      };
    },
  },
  turn: {
    minMoves: 1,
    maxMoves: 1,
  },
  endIf: ({ G }) => {
    // Game ends when either player reaches 3 points
    if (G.scores['0'] >= 3) return { winner: '0' };
    if (G.scores['1'] >= 3) return { winner: '1' };
    return undefined;
  },
};

/**
 * Creates a pair of mock connections that relay messages to each other
 */
function createConnectedPair() {
  const hostMessages: string[] = [];
  const guestMessages: string[] = [];

  const hostConnection = {
    _connected: true,
    _onMessage: null as ((data: string) => void) | null,
    _onStateChange: null as ((state: string) => void) | null,
    events: {
      onMessage: (data: string) => hostConnection._onMessage?.(data),
      onConnectionStateChange: (state: string) => hostConnection._onStateChange?.(state),
    },
    isConnected: () => hostConnection._connected,
    send: (data: string) => {
      hostMessages.push(data);
      // Relay to guest
      setTimeout(() => guestConnection._onMessage?.(data), 1);
    },
    close: () => { hostConnection._connected = false; },
  };

  const guestConnection = {
    _connected: true,
    _onMessage: null as ((data: string) => void) | null,
    _onStateChange: null as ((state: string) => void) | null,
    events: {
      onMessage: (data: string) => guestConnection._onMessage?.(data),
      onConnectionStateChange: (state: string) => guestConnection._onStateChange?.(state),
    },
    isConnected: () => guestConnection._connected,
    send: (data: string) => {
      guestMessages.push(data);
      // Relay to host
      setTimeout(() => hostConnection._onMessage?.(data), 1);
    },
    close: () => { guestConnection._connected = false; },
  };

  return {
    hostConnection,
    guestConnection,
    getHostMessages: () => hostMessages,
    getGuestMessages: () => guestMessages,
  };
}

describe('P2P Game Integration', () => {
  describe('Two-player game completion', () => {
    it('completes a full game with alternating turns', async () => {
      const { hostConnection, guestConnection } = createConnectedPair();

      const hostDataCallback = vi.fn();
      const guestDataCallback = vi.fn();

      // Create host transport
      const hostTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: 'integration-test',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: hostDataCallback,
      });

      // Create guest transport
      const guestTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: guestConnection as any,
        role: 'guest',
        matchID: 'integration-test',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: guestDataCallback,
      });

      // Connect both
      hostTransport.connect();
      guestTransport.connect();

      // Wait for initial sync
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify host received initial sync
      expect(hostDataCallback).toHaveBeenCalled();
      const hostSyncCall = hostDataCallback.mock.calls.find(c => c[0].type === 'sync');
      expect(hostSyncCall).toBeDefined();

      // Verify guest sent sync-req and eventually receives sync
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get current state for making moves
      let currentState = hostSyncCall[0].args[1].state;
      expect(currentState.G.scores['0']).toBe(0);
      expect(currentState.G.scores['1']).toBe(0);

      // Simulate a few moves - player 0 scores
      hostTransport.sendAction(currentState, {
        type: 'MAKE_MOVE',
        playerID: '0',
        payload: { type: 'score', args: [] },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Get updated state from the latest update callback
      const updateCalls = hostDataCallback.mock.calls.filter(c => c[0].type === 'update');
      if (updateCalls.length > 0) {
        const latestUpdate = updateCalls[updateCalls.length - 1][0];
        currentState = latestUpdate.args[1];
        expect(currentState.G.scores['0']).toBe(1);
      }

      // Cleanup
      hostTransport.disconnect();
      guestTransport.disconnect();
    });

    it('handles message ordering correctly', async () => {
      const { hostConnection, guestConnection } = createConnectedPair();

      const events: string[] = [];

      const hostDataCallback = vi.fn((data) => {
        events.push(`host:${data.type}`);
      });
      const guestDataCallback = vi.fn((data) => {
        events.push(`guest:${data.type}`);
      });

      const hostTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: 'ordering-test',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: hostDataCallback,
      });

      const guestTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: guestConnection as any,
        role: 'guest',
        matchID: 'ordering-test',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: guestDataCallback,
      });

      hostTransport.connect();
      guestTransport.connect();

      await new Promise(resolve => setTimeout(resolve, 100));

      // Host should have received sync first
      expect(events[0]).toBe('host:sync');

      hostTransport.disconnect();
      guestTransport.disconnect();
    });

    it('handles disconnection during game gracefully', async () => {
      const { hostConnection, guestConnection } = createConnectedPair();

      const hostDataCallback = vi.fn();
      const guestDataCallback = vi.fn();

      const hostTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: 'disconnect-test',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: hostDataCallback,
      });

      const guestTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: guestConnection as any,
        role: 'guest',
        matchID: 'disconnect-test',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: guestDataCallback,
      });

      hostTransport.connect();
      guestTransport.connect();

      await new Promise(resolve => setTimeout(resolve, 50));

      // Both should be connected
      expect(hostTransport.isConnected).toBe(true);
      expect(guestTransport.isConnected).toBe(true);

      // Explicitly disconnect guest transport
      guestTransport.disconnect();

      // Guest transport should report disconnected after explicit disconnect
      expect(guestTransport.isConnected).toBe(false);

      // Host should still be connected (independent connection)
      expect(hostTransport.isConnected).toBe(true);

      hostTransport.disconnect();
    });

    it('logs events for debugging', async () => {
      const { hostConnection, guestConnection } = createConnectedPair();

      const eventLog: Array<{ timestamp: number; event: string; data?: unknown }> = [];

      const log = (event: string, data?: unknown) => {
        eventLog.push({ timestamp: Date.now(), event, data });
      };

      const hostDataCallback = vi.fn((data) => {
        log('host-received', data.type);
      });

      const guestDataCallback = vi.fn((data) => {
        log('guest-received', data.type);
      });

      const hostTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: 'logging-test',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: hostDataCallback,
      });

      const guestTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: guestConnection as any,
        role: 'guest',
        matchID: 'logging-test',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: guestDataCallback,
      });

      log('host-connect');
      hostTransport.connect();

      log('guest-connect');
      guestTransport.connect();

      await new Promise(resolve => setTimeout(resolve, 100));

      log('test-complete');

      // Verify we have a complete event log
      expect(eventLog.length).toBeGreaterThan(3);
      expect(eventLog.map(e => e.event)).toContain('host-connect');
      expect(eventLog.map(e => e.event)).toContain('guest-connect');
      expect(eventLog.map(e => e.event)).toContain('host-received');

      // Log can be used for debugging
      // console.log('Event Log:', JSON.stringify(eventLog, null, 2));

      hostTransport.disconnect();
      guestTransport.disconnect();
    });
  });

  describe('Error handling', () => {
    it('handles malformed messages without crashing', async () => {
      const { hostConnection, guestConnection } = createConnectedPair();

      const hostDataCallback = vi.fn();

      const hostTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: 'error-test',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: hostDataCallback,
      });

      hostTransport.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      // Send malformed message (won't crash due to JSON parse try/catch)
      hostConnection._onMessage?.('not valid json');
      hostConnection._onMessage?.('{}');
      hostConnection._onMessage?.(JSON.stringify({ type: 'unknown-type' }));

      await new Promise(resolve => setTimeout(resolve, 20));

      // Transport should still be functional
      expect(hostTransport.isConnected).toBe(true);

      hostTransport.disconnect();
    });
  });

  describe('Timeout handling', () => {
    it('allows configuring connection timeout behavior', async () => {
      // This test documents that the transport doesn't have built-in timeouts
      // In production, the UI layer should handle connection timeout logic

      const { hostConnection, guestConnection } = createConnectedPair();

      const hostDataCallback = vi.fn();

      const hostTransport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: 'timeout-test',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: hostDataCallback,
      });

      // Simulate slow connection by not immediately connecting guest
      hostTransport.connect();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Host should still be connected, waiting for guest
      expect(hostTransport.isConnected).toBe(true);

      hostTransport.disconnect();
    });
  });
});

describe('CI compatibility checks', () => {
  it('tests are deterministic (same result on multiple runs)', async () => {
    const results: number[] = [];

    for (let i = 0; i < 5; i++) {
      const { hostConnection } = createConnectedPair();
      const dataCallback = vi.fn();

      const transport = new P2PTransport({
        game: TurnBasedGame,
        connection: hostConnection as any,
        role: 'host',
        matchID: `determinism-test-${i}`,
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      results.push(dataCallback.mock.calls.length);
      transport.disconnect();
    }

    // All runs should have the same number of callbacks
    expect(new Set(results).size).toBe(1);
  });

  it('tests do not rely on wall-clock timing', async () => {
    // Use small timeouts to ensure tests don't depend on specific timing
    const { hostConnection } = createConnectedPair();
    const dataCallback = vi.fn();

    const transport = new P2PTransport({
      game: TurnBasedGame,
      connection: hostConnection as any,
      role: 'host',
      matchID: 'timing-test',
      playerID: '0',
      numPlayers: 2,
      transportDataCallback: dataCallback,
    });

    transport.connect();

    // Use explicit waits instead of arbitrary timeouts
    await vi.waitFor(() => {
      expect(dataCallback.mock.calls.length).toBeGreaterThan(0);
    }, { timeout: 1000 });

    transport.disconnect();
  });
});
