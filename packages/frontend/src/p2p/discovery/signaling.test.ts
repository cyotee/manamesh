/**
 * Tests for WebSocket Signaling Server Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalingConnection, isSignalingAvailable, getSignalingUrl, type SignalingEvents } from './signaling';
import type { PeerConnectionEvents } from '../webrtc';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  private static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError(error: unknown) {
    this.onerror?.(error);
  }

  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  static clearInstances() {
    MockWebSocket.instances = [];
  }
}

// Replace global WebSocket
const originalWebSocket = global.WebSocket;

describe('SignalingConnection', () => {
  let signalingEvents: SignalingEvents;
  let peerConnectionEvents: PeerConnectionEvents;

  beforeEach(() => {
    MockWebSocket.clearInstances();
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;

    signalingEvents = {
      onStateChange: vi.fn(),
      onPeerJoined: vi.fn(),
      onPeerLeft: vi.fn(),
      onError: vi.fn(),
    };

    peerConnectionEvents = {
      onStateChange: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
    };
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('should start in disconnected state', () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents);
    expect(connection.state).toBe('disconnected');
  });

  it('should connect to signaling server', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();

    // Simulate WebSocket opening
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();

    await connectPromise;

    expect(connection.state).toBe('connected');
    expect(signalingEvents.onStateChange).toHaveBeenCalledWith('connecting');
    expect(signalingEvents.onStateChange).toHaveBeenCalledWith('connected');
  });

  it('should join a room', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    await connection.joinRoom('test-room');

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'join',
      roomId: 'test-room',
    }));
  });

  it('should handle joined message', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    ws.simulateMessage({
      type: 'joined',
      peerId: 'peer-123',
      roomId: 'test-room',
      peers: [],
    });

    expect(connection.state).toBe('in-room');
    expect(connection.currentPeerId).toBe('peer-123');
    expect(connection.currentRoomId).toBe('test-room');
  });

  it('should handle peer-joined event', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    ws.simulateMessage({ type: 'peer-joined', peerId: 'new-peer' });

    expect(signalingEvents.onPeerJoined).toHaveBeenCalledWith('new-peer');
  });

  it('should handle peer-left event', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    ws.simulateMessage({ type: 'peer-left', peerId: 'leaving-peer' });

    expect(signalingEvents.onPeerLeft).toHaveBeenCalledWith('leaving-peer');
  });

  it('should handle server errors', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    ws.simulateMessage({ type: 'error', message: 'Test error' });

    expect(signalingEvents.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should leave room and close connections', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    // Join room first
    ws.simulateMessage({
      type: 'joined',
      peerId: 'peer-123',
      roomId: 'test-room',
      peers: [],
    });

    connection.leaveRoom();

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'leave',
      roomId: 'test-room',
    }));
    expect(connection.state).toBe('connected');
    expect(connection.currentRoomId).toBeNull();
  });

  it('should disconnect completely', async () => {
    const connection = new SignalingConnection(signalingEvents, peerConnectionEvents, 'ws://test:4000/signaling');

    const connectPromise = connection.connect();
    const ws = MockWebSocket.getLastInstance()!;
    ws.simulateOpen();
    await connectPromise;

    connection.disconnect();

    expect(ws.close).toHaveBeenCalled();
    expect(connection.state).toBe('disconnected');
  });
});

describe('isSignalingAvailable', () => {
  beforeEach(() => {
    MockWebSocket.clearInstances();
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('should return true when server is available', async () => {
    const checkPromise = isSignalingAvailable('ws://test:4000/signaling');

    // Simulate successful connection
    setTimeout(() => {
      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
    }, 10);

    const result = await checkPromise;
    expect(result).toBe(true);
  });

  it('should return false when server is unavailable', async () => {
    const checkPromise = isSignalingAvailable('ws://test:4000/signaling');

    // Simulate error
    setTimeout(() => {
      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateError(new Error('Connection failed'));
    }, 10);

    const result = await checkPromise;
    expect(result).toBe(false);
  });
});

describe('getSignalingUrl', () => {
  it('should return the configured URL', () => {
    const url = getSignalingUrl();
    expect(url).toBeDefined();
    expect(typeof url).toBe('string');
  });
});
