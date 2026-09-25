import type { Hex } from 'viem';
import type { PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import type { JoinCodeConnection } from './discovery/join-code';

type Link = Pick<JoinCodeConnection, 'isConnected' | 'sendSignal' | 'onSignal' | 'offSignal'>;
const PROTOCOL = 'manamesh-poker-enrollment-v1';

/** Pre-history exchange of public wallet approvals for independently reviewed
 * local terms. Never signs or changes the expected wallet/session-key roster.
 * Caller must dispose this bootstrap exchange before starting history traffic.
 */
export class PokerEnrollmentExchange {
  #enrollment: PokerHistoryEnrollment;
  #links: ReadonlyMap<number, Link>;
  #seat: number;
  #relay: number;
  #registered = new Set<number>();
  #verified = new Map<number, Hex>();
  #processing = new Map<number, Hex>();
  #sent = new Set<string>();
  #cleanup: (() => void)[] = [];
  #interval?: ReturnType<typeof setInterval>;
  #deadline?: ReturnType<typeof setTimeout>;
  #reason?: string;
  #resolveComplete!: (wire: string) => void;
  #rejectComplete!: (reason: Error) => void;
  #resolveClosed!: (reason: Error) => void;
  readonly completed = new Promise<string>((resolve, reject) => { this.#resolveComplete = resolve; this.#rejectComplete = reject; });
  readonly whenClosed = new Promise<Error>(resolve => { this.#resolveClosed = resolve; });
  constructor(links: ReadonlyMap<number, Link>, enrollment: PokerHistoryEnrollment, seat: number, relaySeat = 0) {
    void this.completed.catch(() => {});
    const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < enrollment.seatCount;
    const peers = seat === relaySeat ? Array.from({ length: enrollment.seatCount }, (_, i) => i).filter(i => i !== seat) : [relaySeat];
    if (!valid(seat) || !valid(relaySeat) || links.size !== peers.length || peers.some(peer => !links.has(peer))
      || new Set(links.values()).size !== links.size || [...links.values()].some(link => !link.isConnected())) throw new Error('poker_enrollment_link:topology');
    this.#links = new Map(links); this.#enrollment = enrollment; this.#seat = seat; this.#relay = relaySeat;
    try {
      for (const [peer, link] of this.#links) {
        const receive = (value: unknown) => { try { this.#receive(peer, value); } catch (error) { this.#stop(error); } };
        link.onSignal(receive); this.#cleanup.push(() => link.offSignal(receive));
      }
      this.#interval = setInterval(() => this.#tick(), 500);
      this.#deadline = setTimeout(() => { if (!this.ready) this.#stop(new Error('poker_enrollment_link:registration_timeout')); }, 20_000);
      this.#tick();
    } catch (error) { this.#stop(error); throw error; }
  }
  get closed() { return this.#reason !== undefined; }
  get closeReason() { return this.#reason; }
  get ready() { return !this.closed && this.#registered.size === this.#links.size; }
  get missingSeats() { return this.#enrollment.missingSeats; }
  #live() { if (this.closed) throw new Error('poker_enrollment_link:closed'); }
  #registration(peer: number) {
    this.#links.get(peer)!.sendSignal({ protocol: PROTOCOL, type: 'registered', sessionId: this.#enrollment.sessionId, seat: this.#seat, peerSeat: peer });
  }
  #tick() {
    if (this.closed) return;
    try {
      for (const [peer, link] of this.#links) {
        if (!link.isConnected()) throw new Error('poker_enrollment_link:disconnected');
        if (!this.#registered.has(peer)) this.#registration(peer);
      }
    } catch (error) { this.#stop(error); }
  }
  #receive(peer: number, value: unknown) {
    if (this.closed || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const packet = value as Record<string, unknown>;
    if (packet.protocol !== PROTOCOL) return; // Other join-code protocols coexist.
    const keys = packet.type === 'registered' ? ['protocol', 'type', 'sessionId', 'seat', 'peerSeat'] : ['protocol', 'type', 'sessionId', 'seat', 'signature'];
    if (Object.keys(packet).length !== keys.length || !Object.keys(packet).every(key => keys.includes(key))
      || packet.sessionId !== this.#enrollment.sessionId) throw new Error('poker_enrollment_link:terms');
    if (packet.type === 'registered') {
      if (packet.seat !== peer || packet.peerSeat !== this.#seat) throw new Error('poker_enrollment_link:direction');
      if (!this.#registered.has(peer)) {
        this.#registered.add(peer); this.#registration(peer);
        if (this.ready) { clearTimeout(this.#deadline); this.#flush(); this.#complete(); }
      }
    } else if (packet.type === 'approval') {
      if (!Number.isInteger(packet.seat) || Number(packet.seat) < 0 || Number(packet.seat) >= this.#enrollment.seatCount
        || typeof packet.signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(packet.signature)) throw new Error('poker_enrollment_link:approval');
      const seat = packet.seat as number; const signature = packet.signature as Hex;
      if (this.#verified.get(seat) === signature || this.#processing.get(seat) === signature) return;
      if (this.#processing.has(seat)) throw new Error('poker_enrollment_link:busy');
      this.#processing.set(seat, signature);
      void this.#enrollment.collectApproval(seat, signature).then(() => {
        this.#live();
        if (!this.#verified.has(seat)) this.#verified.set(seat, signature);
        if (this.#seat === this.#relay) this.#flush();
      }).catch(error => this.#stop(error)).finally(() => { this.#processing.delete(seat); this.#complete(); });
    } else throw new Error('poker_enrollment_link:type');
  }
  #flush() {
    if (!this.ready) return;
    for (const [seat, signature] of this.#verified) {
      if (this.#seat !== this.#relay && seat !== this.#seat) continue;
      for (const [peer, link] of this.#links) {
        const key = `${peer}:${seat}`;
        if (this.#sent.has(key)) continue;
        link.sendSignal({ protocol: PROTOCOL, type: 'approval', sessionId: this.#enrollment.sessionId, seat, signature });
        this.#sent.add(key);
      }
    }
  }
  #complete() {
    if (!this.ready || this.#processing.size || this.#verified.size !== this.#enrollment.seatCount) return;
    this.#resolveComplete(this.#enrollment.approvalEnvelope());
  }
  /** Signature must be obtained by a separate explicit local wallet action. */
  async submitApproval(signature: Hex) {
    this.#live();
    await this.#enrollment.collectApproval(this.#seat, signature);
    this.#live();
    if (!this.#verified.has(this.#seat)) this.#verified.set(this.#seat, signature);
    try { this.#flush(); this.#complete(); } catch (error) { this.#stop(error); throw error; }
  }
  approvalEnvelope() { this.#live(); return this.#enrollment.approvalEnvelope(); }
  dispose() { this.#stop(new Error('poker_enrollment_link:disposed')); }
  #stop(error: unknown) {
    if (this.closed) return;
    const reason = error instanceof Error ? error : new Error('poker_enrollment_link:failed');
    this.#reason = reason.message;
    this.#rejectComplete(reason); this.#resolveClosed(reason);
    clearInterval(this.#interval); clearTimeout(this.#deadline);
    this.#cleanup.splice(0).forEach(remove => remove());
  }
}
