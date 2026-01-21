/**
 * WebRTC wrapper for P2P connections
 * Handles RTCPeerConnection, offers/answers, ICE candidates, and data channels
 */

export type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface PeerConnectionEvents {
  onStateChange: (state: ConnectionState) => void;
  onMessage: (data: string) => void;
  onError: (error: Error) => void;
}

export interface ConnectionOffer {
  sdp: string;
  iceCandidates: RTCIceCandidateInit[];
}

// Free public STUN servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private iceCandidates: RTCIceCandidateInit[] = [];
  private iceGatheringComplete = false;
  private events: PeerConnectionEvents;
  private _state: ConnectionState = 'new';

  constructor(events: PeerConnectionEvents) {
    this.events = events;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.setupPeerConnectionHandlers();
  }

  get state(): ConnectionState {
    return this._state;
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.events.onStateChange(state);
  }

  private setupPeerConnectionHandlers(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.iceCandidates.push(event.candidate.toJSON());
      }
    };

    this.pc.onicegatheringstatechange = () => {
      if (this.pc.iceGatheringState === 'complete') {
        this.iceGatheringComplete = true;
      }
    };

    this.pc.onconnectionstatechange = () => {
      switch (this.pc.connectionState) {
        case 'connecting':
          this.setState('connecting');
          break;
        case 'connected':
          this.setState('connected');
          break;
        case 'disconnected':
          this.setState('disconnected');
          break;
        case 'failed':
          this.setState('failed');
          this.events.onError(new Error('Connection failed'));
          break;
      }
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('[WebRTC] Data channel opened');
      this.setState('connected');
    };

    channel.onclose = () => {
      console.log('[WebRTC] Data channel closed');
      this.setState('disconnected');
    };

    channel.onerror = (event) => {
      console.error('[WebRTC] Data channel error:', event);
      this.events.onError(new Error('Data channel error'));
    };

    channel.onmessage = (event) => {
      this.events.onMessage(event.data);
    };
  }

  /**
   * Create an offer (host side)
   * Returns the offer with ICE candidates once gathering is complete
   */
  async createOffer(): Promise<ConnectionOffer> {
    this.setState('connecting');

    // Create data channel before creating offer
    const channel = this.pc.createDataChannel('game', {
      ordered: true,
    });
    this.setupDataChannel(channel);

    // Create and set local description
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete
    await this.waitForIceGathering();

    return {
      sdp: this.pc.localDescription!.sdp,
      iceCandidates: this.iceCandidates,
    };
  }

  /**
   * Accept an offer and create an answer (guest side)
   */
  async acceptOffer(offer: ConnectionOffer): Promise<ConnectionOffer> {
    this.setState('connecting');

    // Set remote description from offer
    await this.pc.setRemoteDescription({
      type: 'offer',
      sdp: offer.sdp,
    });

    // Add ICE candidates from offer
    for (const candidate of offer.iceCandidates) {
      await this.pc.addIceCandidate(candidate);
    }

    // Create and set local description (answer)
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Wait for ICE gathering to complete
    await this.waitForIceGathering();

    return {
      sdp: this.pc.localDescription!.sdp,
      iceCandidates: this.iceCandidates,
    };
  }

  /**
   * Accept an answer (host side, completes the connection)
   */
  async acceptAnswer(answer: ConnectionOffer): Promise<void> {
    // Set remote description from answer
    await this.pc.setRemoteDescription({
      type: 'answer',
      sdp: answer.sdp,
    });

    // Add ICE candidates from answer
    for (const candidate of answer.iceCandidates) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  /**
   * Send a message over the data channel
   */
  send(data: string): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    this.dataChannel.send(data);
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    this.pc.close();
    this.setState('disconnected');
  }

  /**
   * Wait for ICE gathering to complete with timeout
   */
  private waitForIceGathering(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.iceGatheringComplete || this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        // Resolve anyway after timeout - we may have enough candidates
        console.log('[WebRTC] ICE gathering timeout, proceeding with available candidates');
        resolve();
      }, timeoutMs);

      const checkComplete = () => {
        if (this.pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          this.pc.removeEventListener('icegatheringstatechange', checkComplete);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', checkComplete);
    });
  }
}
