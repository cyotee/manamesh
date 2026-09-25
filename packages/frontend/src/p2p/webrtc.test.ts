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
  ordered = true;
  maxPacketLifeTime: number | null = null;
  maxRetransmits: number | null = null;
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
    it('closes and updates state without emitting an unexpected disconnect', async () => {
      const { events, calls } = createMockEvents();
      const pc = new PeerConnection(events);

      await pc.createOffer();
      pc.close();

      expect(pc.state).toBe('disconnected');
      // Intentional cleanup must not trigger callers' reconnect/failure flows.
      expect(calls.stateChanges).not.toContain('disconnected');
      pc.close();
      expect(pc.state).toBe('disconnected');
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


describe('dedicated reliable channels', () => {
  function fixture() {
    const messages = vi.fn();
    const peer = new PeerConnection({ onMessage: messages, onStateChange: vi.fn(), onError: vi.fn() });
    const rtc = (peer as unknown as { pc: MockRTCPeerConnection }).pc;
    const game = new MockRTCDataChannel('game');
    rtc.simulateDataChannel(game);
    game.simulateOpen();
    rtc.simulateConnectionState('connected');
    return { peer, rtc, game, messages };
  }
  it('refuses unknown and duplicate channels without replacing game routing', () => {
    const f = fixture();
    const unknown = new MockRTCDataChannel('unknown');
    const duplicate = new MockRTCDataChannel('game');
    f.rtc.simulateDataChannel(unknown); f.rtc.simulateDataChannel(duplicate);
    expect(unknown.readyState).toBe('closed'); expect(duplicate.readyState).toBe('closed');
    unknown.simulateMessage('injected'); duplicate.simulateMessage('injected');
    f.game.simulateMessage('real'); f.peer.send('outgoing');
    expect(f.messages.mock.calls).toEqual([['real']]);
    expect(f.game.getSentMessages()).toEqual(['outgoing']);
    f.peer.close();
  });
  it('routes an admitted channel separately and never replaces it after closure', () => {
    const f = fixture(); const accept = vi.fn();
    const dispose = f.peer.registerReliableChannel('manamesh-poker-history-v1', accept);
    const history = new MockRTCDataChannel('manamesh-poker-history-v1');
    f.rtc.simulateDataChannel(history);
    expect(accept).toHaveBeenCalledWith(history);
    history.simulateMessage('not a game snapshot');
    expect(f.messages).not.toHaveBeenCalled();
    dispose();
    const replacement = new MockRTCDataChannel(history.label);
    f.rtc.simulateDataChannel(replacement);
    expect(replacement.readyState).toBe('closed'); expect(accept).toHaveBeenCalledTimes(1);
    expect(f.game.readyState).toBe('open');
    f.peer.close();
  });
  it('rejects unreliable channels without consuming the registered receiver', () => {
    const f = fixture(); const accept = vi.fn();
    f.peer.registerReliableChannel('proofs', accept);
    for (const option of ['ordered', 'maxPacketLifeTime', 'maxRetransmits'] as const) {
      const invalid = new MockRTCDataChannel('proofs');
      if (option === 'ordered') invalid.ordered = false; else invalid[option] = 1;
      f.rtc.simulateDataChannel(invalid); expect(invalid.readyState).toBe('closed');
    }
    const valid = new MockRTCDataChannel('proofs'); f.rtc.simulateDataChannel(valid);
    expect(accept).toHaveBeenCalledTimes(1); f.peer.close();
  });
  it('bounds local registrations and refuses opening before connection or after disposal', () => {
    const f = fixture();
    expect(() => f.peer.registerReliableChannel('game', vi.fn())).toThrow('channel_label');
    const dispose = f.peer.registerReliableChannel('history', vi.fn());
    expect(() => f.peer.registerReliableChannel('history', vi.fn())).toThrow('channel_registration');
    for (const label of ['proofs', 'admission', 'control']) f.peer.registerReliableChannel(label, vi.fn());
    expect(() => f.peer.registerReliableChannel('extra', vi.fn())).toThrow('channel_registration');
    f.rtc.simulateConnectionState('connecting');
    expect(() => f.peer.openReliableChannel('history')).toThrow('not_connected');
    f.rtc.simulateConnectionState('connected');
    dispose(); expect(() => f.peer.openReliableChannel('history')).toThrow('channel_registration');
    const proofs = f.peer.openReliableChannel('proofs');
    expect(proofs.label).toBe('proofs');
    expect(() => f.peer.openReliableChannel('proofs')).toThrow('channel_registration');
    f.peer.close(); expect(proofs.readyState).toBe('closed');
    expect(() => f.peer.registerReliableChannel('new', vi.fn())).toThrow('closed');
  });
});
