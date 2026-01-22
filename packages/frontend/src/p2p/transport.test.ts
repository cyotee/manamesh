/**
 * Tests for the P2P Transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P2PTransport, P2PMultiplayer, type P2PMessage } from './transport';
import type { Game } from 'boardgame.io';

// Mock JoinCodeConnection
class MockJoinCodeConnection {
  private messages: string[] = [];
  private onMessageHandler: ((data: string) => void) | null = null;
  private onConnectionStateChangeHandler: ((state: string) => void) | null = null;
  private _isConnected = true;

  events = {
    onMessage: (data: string) => {
      this.onMessageHandler?.(data);
    },
    onConnectionStateChange: (state: string) => {
      this.onConnectionStateChangeHandler?.(state);
    },
  };

  isConnected(): boolean {
    return this._isConnected;
  }

  send(data: string): void {
    this.messages.push(data);
  }

  close(): void {
    this._isConnected = false;
  }

  // Test helpers
  getSentMessages(): string[] {
    return this.messages;
  }

  clearMessages(): void {
    this.messages = [];
  }

  setConnected(connected: boolean): void {
    this._isConnected = connected;
    this.events.onConnectionStateChange(connected ? 'connected' : 'disconnected');
  }

  simulateMessage(message: P2PMessage): void {
    this.events.onMessage(JSON.stringify(message));
  }
}

// Simple test game
const TestGame: Game = {
  name: 'test-game',
  setup: () => ({ value: 0 }),
  moves: {
    increment: ({ G }) => {
      return { ...G, value: G.value + 1 };
    },
    setValue: ({ G }, newValue: number) => {
      return { ...G, value: newValue };
    },
  },
  turn: {
    minMoves: 1,
    maxMoves: 3,
  },
};

describe('P2PTransport', () => {
  let mockConnection: MockJoinCodeConnection;
  let dataCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConnection = new MockJoinCodeConnection();
    dataCallback = vi.fn();
  });

  describe('host mode', () => {
    it('should initialize as host and create game master', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();

      expect(transport.isConnected).toBe(true);
    });

    it('should send initial sync to host client after connect', async () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(dataCallback).toHaveBeenCalled();
      const call = dataCallback.mock.calls[0][0];
      expect(call.type).toBe('sync');
    });

    it('should process actions locally', async () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Get initial state
      const syncCall = dataCallback.mock.calls[0][0];
      const initialState = syncCall.args[1].state;

      // Send an action
      transport.sendAction(initialState, {
        type: 'MAKE_MOVE',
        playerID: '0',
        payload: { type: 'increment', args: [] },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have received an update
      const updateCall = dataCallback.mock.calls.find(call => call[0].type === 'update');
      expect(updateCall).toBeDefined();
      expect(updateCall[0].args[1].G.value).toBe(1);
    });

    it('should handle guest sync requests', async () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      await new Promise(resolve => setTimeout(resolve, 10));
      mockConnection.clearMessages();

      // Simulate sync request from guest using real playerID '1'
      // The host subscribes the guest under their actual playerID
      mockConnection.simulateMessage({
        type: 'sync-req',
        args: ['test-match', '1', undefined, 2],
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have sent sync to guest (host subscribes guest under their playerID '1')
      const messages = mockConnection.getSentMessages();
      expect(messages.length).toBeGreaterThan(0);
      const syncMessage = JSON.parse(messages[0]);
      expect(syncMessage.type).toBe('sync');
    });

    it('should handle guest actions', async () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      // First, guest must send sync-req to establish subscription
      mockConnection.simulateMessage({
        type: 'sync-req',
        args: ['test-match', '1', undefined, 2],
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      mockConnection.clearMessages();

      // Simulate action from guest
      mockConnection.simulateMessage({
        type: 'action',
        args: [
          { type: 'MAKE_MOVE', playerID: '1', payload: { type: 'setValue', args: [42] } },
          0,
          'test-match',
          '1',
        ],
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should have broadcast update
      const messages = mockConnection.getSentMessages();
      expect(messages.length).toBeGreaterThan(0);
      const updateMessage = JSON.parse(messages[0]);
      expect(updateMessage.type).toBe('update');
      expect(updateMessage.args[1].G.value).toBe(42);
    });
  });

  describe('guest mode', () => {
    it('should initialize as guest and request sync', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();

      expect(transport.isConnected).toBe(true);

      // Should have sent sync request
      const messages = mockConnection.getSentMessages();
      expect(messages.length).toBe(1);
      const syncReq = JSON.parse(messages[0]);
      expect(syncReq.type).toBe('sync-req');
    });

    it('should forward actions to host', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      mockConnection.clearMessages();

      // Send an action
      const mockState = { G: { value: 0 }, ctx: {}, plugins: {}, _stateID: 0 };
      transport.sendAction(mockState, {
        type: 'MAKE_MOVE',
        playerID: '1',
        payload: { type: 'increment', args: [] },
      });

      const messages = mockConnection.getSentMessages();
      expect(messages.length).toBe(1);
      const actionMessage = JSON.parse(messages[0]);
      expect(actionMessage.type).toBe('action');
    });

    it('should process update messages from host', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();

      // Simulate update from host
      const newState = { G: { value: 5 }, ctx: {}, plugins: {}, _stateID: 1 };
      mockConnection.simulateMessage({
        type: 'update',
        args: ['test-match', newState, []],
      });

      expect(dataCallback).toHaveBeenCalledWith({
        type: 'update',
        args: ['test-match', newState, []],
      });
    });

    it('should process sync messages from host', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();

      // Simulate sync from host
      const syncData = {
        state: { G: { value: 0 }, ctx: {}, plugins: {}, _stateID: 0 },
        filteredMetadata: [],
        log: [],
      };
      mockConnection.simulateMessage({
        type: 'sync',
        args: ['test-match', syncData],
      });

      expect(dataCallback).toHaveBeenCalledWith({
        type: 'sync',
        args: ['test-match', syncData],
      });
    });
  });

  describe('connection resilience', () => {
    it('should buffer messages when disconnected', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      mockConnection.clearMessages();

      // Disconnect
      mockConnection.setConnected(false);

      // Try to send action
      const mockState = { G: { value: 0 }, ctx: {}, plugins: {}, _stateID: 0 };
      transport.sendAction(mockState, {
        type: 'MAKE_MOVE',
        playerID: '1',
        payload: { type: 'increment', args: [] },
      });

      // Should be buffered, not sent
      expect(mockConnection.getSentMessages().length).toBe(0);

      // Reconnect
      mockConnection.setConnected(true);

      // Buffer should be flushed
      expect(mockConnection.getSentMessages().length).toBe(1);
    });

    it('should update connection status on state changes', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      const statusCallback = vi.fn();
      transport.subscribeToConnectionStatus(statusCallback);

      transport.connect();
      expect(transport.isConnected).toBe(true);

      mockConnection.setConnected(false);
      expect(transport.isConnected).toBe(false);
      expect(statusCallback).toHaveBeenCalled();
    });
  });

  describe('chat messages', () => {
    it('should send chat messages as guest', () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'guest',
        matchID: 'test-match',
        playerID: '1',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      mockConnection.clearMessages();

      transport.sendChatMessage('test-match', { id: '1', sender: '1', payload: 'Hello!' });

      const messages = mockConnection.getSentMessages();
      expect(messages.length).toBe(1);
      const chatMessage = JSON.parse(messages[0]);
      expect(chatMessage.type).toBe('chat');
      expect(chatMessage.args[1].payload).toBe('Hello!');
    });

    it('should process chat as host and broadcast', async () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      // First, guest must send sync-req to establish subscription for broadcast
      mockConnection.simulateMessage({
        type: 'sync-req',
        args: ['test-match', '1', undefined, 2],
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      mockConnection.clearMessages();

      transport.sendChatMessage('test-match', { id: '1', sender: '0', payload: 'Hello from host!' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Should broadcast chat
      const messages = mockConnection.getSentMessages();
      expect(messages.length).toBeGreaterThan(0);
      const chatMessage = JSON.parse(messages.find(m => JSON.parse(m).type === 'chat')!);
      expect(chatMessage.type).toBe('chat');
    });
  });

  describe('P2PMultiplayer factory', () => {
    it('should create a transport factory function', () => {
      const factory = P2PMultiplayer({
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
      });

      expect(typeof factory).toBe('function');

      const transport = factory({
        game: TestGame,
        transportDataCallback: dataCallback,
      });

      expect(transport).toBeInstanceOf(P2PTransport);
    });
  });

  describe('disconnect', () => {
    it('should clean up resources on disconnect', async () => {
      const transport = new P2PTransport({
        game: TestGame,
        connection: mockConnection as any,
        role: 'host',
        matchID: 'test-match',
        playerID: '0',
        numPlayers: 2,
        transportDataCallback: dataCallback,
      });

      transport.connect();
      await new Promise(resolve => setTimeout(resolve, 10));

      transport.disconnect();

      expect(transport.isConnected).toBe(false);
    });
  });
});
