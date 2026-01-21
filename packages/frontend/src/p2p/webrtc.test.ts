/**
 * Tests for WebRTC wrapper
 * Uses mocks since actual WebRTC requires browser environment
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerConnection, type ConnectionState, type PeerConnectionEvents } from './webrtc';

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  iceGatheringState: RTCIceGatheringState = 'new';
  connectionState: RTCPeerConnectionState = 'new';

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  private dataChannels: MockRTCDataChannel[] = [];
  private listeners: Map<string, Function[]> = new Map();

  createDataChannel(label: string, options?: RTCDataChannelInit): MockRTCDataChannel {
    const channel = new MockRTCDataChannel(label);
    this.dataChannels.push(channel);
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc as RTCSessionDescription;
    // Simulate ICE gathering
    setTimeout(() => {
      if (this.onicecandidate) {
        this.onicecandidate({
          candidate: {
            candidate: 'mock-candidate',
            sdpMid: '0',
            sdpMLineIndex: 0,
            toJSON: () => ({ candidate: 'mock-candidate', sdpMid: '0', sdpMLineIndex: 0 }),
          } as RTCIceCandidate,
        } as RTCPeerConnectionIceEvent);
      }
      this.iceGatheringState = 'complete';
      if (this.onicegatheringstatechange) {
        this.onicegatheringstatechange();
      }
      this.dispatchEvent('icegatheringstatechange');
    }, 10);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc as RTCSessionDescription;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Mock implementation - just accept the candidate
  }

  addEventListener(type: string, listener: Function): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: Function): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  dispatchEvent(type: string): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach(listener => listener());
    }
  }

  close(): void {
    this.connectionState = 'closed';
    this.dataChannels.forEach(channel => channel.close());
  }

  // Helper for tests to simulate connection state changes
  simulateConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange();
    }
  }

  // Helper for tests to simulate receiving a data channel
  simulateDataChannel(channel: MockRTCDataChannel): void {
    if (this.ondatachannel) {
      this.ondatachannel({ channel } as unknown as RTCDataChannelEvent);
    }
  }
}

class MockRTCDataChannel {
  label: string;
  readyState: RTCDataChannelState = 'connecting';

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private sentMessages: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    if (this.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 'closed';
    if (this.onclose) {
      this.onclose();
    }
  }

  // Helper for tests
  simulateOpen(): void {
    this.readyState = 'open';
    if (this.onopen) {
      this.onopen();
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  getSentMessages(): string[] {
    return this.sentMessages;
  }
}

// Store original RTCPeerConnection
const originalRTCPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
  // Replace with mock
  (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
});

afterEach(() => {
  // Restore original
  if (originalRTCPeerConnection) {
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
  }
});

describe('PeerConnection', () => {
  const createMockEvents = (): { events: PeerConnectionEvents; calls: { stateChanges: ConnectionState[]; messages: string[]; errors: Error[] } } => {
    const calls = {
      stateChanges: [] as ConnectionState[],
      messages: [] as string[],
      errors: [] as Error[],
    };

    return {
      events: {
        onStateChange: (state) => calls.stateChanges.push(state),
        onMessage: (data) => calls.messages.push(data),
        onError: (error) => calls.errors.push(error),
      },
      calls,
    };
  };

  describe('constructor', () => {
    it('initializes with new state', () => {
      const { events } = createMockEvents();
      const pc = new PeerConnection(events);

      expect(pc.state).toBe('new');
    });
  });

  describe('createOffer', () => {
    it('creates an offer and returns connection data', async () => {
      const { events, calls } = createMockEvents();
      const pc = new PeerConnection(events);

      const offer = await pc.createOffer();

      expect(offer.sdp).toBe('mock-offer-sdp');
      expect(offer.iceCandidates).toBeDefined();
      expect(calls.stateChanges).toContain('connecting');
    });

    it('gathers ICE candidates', async () => {
      const { events } = createMockEvents();
      const pc = new PeerConnection(events);

      const offer = await pc.createOffer();

      // Should have at least the mock candidate
      expect(offer.iceCandidates.length).toBeGreaterThanOrEqual(1);
      expect(offer.iceCandidates[0]).toHaveProperty('candidate');
    });
  });

  describe('acceptOffer', () => {
    it('accepts an offer and returns an answer', async () => {
      const { events } = createMockEvents();
      const pc = new PeerConnection(events);

      const offer = { sdp: 'remote-offer-sdp', iceCandidates: [] };
      const answer = await pc.acceptOffer(offer);

      expect(answer.sdp).toBe('mock-answer-sdp');
      expect(answer.iceCandidates).toBeDefined();
    });
  });

  describe('acceptAnswer', () => {
    it('accepts an answer after creating an offer', async () => {
      const { events } = createMockEvents();
      const pc = new PeerConnection(events);

      // First create an offer
      await pc.createOffer();

      // Then accept an answer
      const answer = { sdp: 'remote-answer-sdp', iceCandidates: [] };
      await pc.acceptAnswer(answer);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('send', () => {
    it('throws when data channel is not open', () => {
      const { events } = createMockEvents();
      const pc = new PeerConnection(events);

      expect(() => pc.send('test')).toThrow('Data channel not open');
    });
  });

  describe('close', () => {
    it('closes the connection and updates state', async () => {
      const { events, calls } = createMockEvents();
      const pc = new PeerConnection(events);

      await pc.createOffer();
      pc.close();

      expect(calls.stateChanges).toContain('disconnected');
    });
  });

  describe('connection state events', () => {
    it('emits state changes for connection events', async () => {
      const { events, calls } = createMockEvents();
      const pc = new PeerConnection(events);

      await pc.createOffer();

      // Access the underlying mock to simulate state changes
      const mockPc = (pc as any).pc as MockRTCPeerConnection;

      mockPc.simulateConnectionState('connected');
      expect(calls.stateChanges).toContain('connected');

      mockPc.simulateConnectionState('disconnected');
      expect(calls.stateChanges).toContain('disconnected');
    });

    it('emits error on connection failure', async () => {
      const { events, calls } = createMockEvents();
      const pc = new PeerConnection(events);

      await pc.createOffer();

      const mockPc = (pc as any).pc as MockRTCPeerConnection;
      mockPc.simulateConnectionState('failed');

      expect(calls.stateChanges).toContain('failed');
      expect(calls.errors.length).toBeGreaterThan(0);
      expect(calls.errors[0].message).toBe('Connection failed');
    });
  });

  describe('message handling', () => {
    it('receives messages through data channel', async () => {
      const { events, calls } = createMockEvents();
      const pc = new PeerConnection(events);

      await pc.createOffer();

      // Get the data channel that was created
      const mockPc = (pc as any).pc as MockRTCPeerConnection;
      const mockChannel = (pc as any).dataChannel as MockRTCDataChannel;

      // Simulate receiving a message
      mockChannel.simulateMessage('hello world');

      expect(calls.messages).toContain('hello world');
    });
  });
});

describe('Integration scenarios', () => {
  it('simulates a host-guest connection flow', async () => {
    const hostEvents = {
      stateChanges: [] as ConnectionState[],
      messages: [] as string[],
      errors: [] as Error[],
    };

    const guestEvents = {
      stateChanges: [] as ConnectionState[],
      messages: [] as string[],
      errors: [] as Error[],
    };

    // Host creates an offer
    const host = new PeerConnection({
      onStateChange: (s) => hostEvents.stateChanges.push(s),
      onMessage: (m) => hostEvents.messages.push(m),
      onError: (e) => hostEvents.errors.push(e),
    });

    const offer = await host.createOffer();
    expect(offer.sdp).toBeDefined();

    // Guest accepts offer and creates answer
    const guest = new PeerConnection({
      onStateChange: (s) => guestEvents.stateChanges.push(s),
      onMessage: (m) => guestEvents.messages.push(m),
      onError: (e) => guestEvents.errors.push(e),
    });

    const answer = await guest.acceptOffer(offer);
    expect(answer.sdp).toBeDefined();

    // Host accepts answer
    await host.acceptAnswer(answer);

    // Both should be in connecting state
    expect(hostEvents.stateChanges).toContain('connecting');
    expect(guestEvents.stateChanges).toContain('connecting');

    // Cleanup
    host.close();
    guest.close();
  });
});
