import type { Hex } from 'viem';
import type { PokerApprovalKind, VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { PokerHistoryChannel } from '../poker-history-channel';
import { bindPokerShuffleProofs } from './poker-shuffle-proof-channel';
import type { ExperimentalPokerShuffleAdmission } from './poker-shuffle-admission';

/** Application proof routing and worker lifetime for one admitted star table.
 * Received artifacts are forwarded only after local verification. This class
 * never signs or chooses gameplay actions; callers drive explicit stage work.
 */
export class PokerProofExchange {
  #links: ReadonlyMap<number, PokerHistoryChannel>;
  #senders = new Map<number, ReturnType<typeof bindPokerShuffleProofs>>();
  #history: VerifiedPokerHistory;
  #admission: ExperimentalPokerShuffleAdmission;
  #seat: number;
  #relay: number;
  #reason?: string;
  #cleanup: (() => void)[] = [];
  #head: Hex;
  #steps = new Set<number>();
  #public = new Set<string>();
  #private = new Set<string>();
  #prepared = new Map<number, Uint8Array>();
  #progressWaiters = new Set<() => void>();
  constructor(links: ReadonlyMap<number, PokerHistoryChannel>, history: VerifiedPokerHistory,
    admission: ExperimentalPokerShuffleAdmission, seat: number, relaySeat = 0) {
    const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < history.seatCount;
    const expected = seat === relaySeat ? Array.from({ length: history.seatCount }, (_, index) => index).filter(index => index !== seat) : [relaySeat];
    if (!valid(seat) || !valid(relaySeat) || links.size !== expected.length || expected.some(peer => !links.has(peer))
      || new Set(links.values()).size !== links.size || [...links.values()].some(link => link.closed) || admission.closed) throw new Error('poker_proofs:topology');
    this.#links = new Map(links); this.#history = history; this.#admission = admission;
    this.#seat = seat; this.#relay = relaySeat; this.#head = history.checkpoint.head;
    const workerClosed = (event: Event) => this.#stop((event as CustomEvent<Error>).detail);
    admission.addEventListener('closed', workerClosed);
    this.#cleanup.push(() => admission.removeEventListener('closed', workerClosed));
    try {
      for (const [peer, channel] of this.#links) {
        this.#senders.set(peer, bindPokerShuffleProofs(channel, history, admission));
        const artifact = (event: Event) => {
          try {
            this.#live(); this.#scope();
            const wire = (event as CustomEvent<string>).detail;
            const packet = JSON.parse(wire);
            if (packet.type === 'shuffle-proof-v1') this.#steps.add(packet.step);
            if (packet.type === 'public-contribution-v1') this.#public.add(`${packet.position}:${packet.seat}`);
            if (packet.type === 'private-contribution-v1') this.#private.add(`${packet.position}:${packet.seat}`);
            if (this.#seat === this.#relay) for (const [other, link] of this.#links) if (other !== peer) link.sendArtifact(wire);
            this.#notifyProgress();
          } catch (error) { this.#stop(error); }
        };
        const stop = (event: Event) => this.#stop((event as CustomEvent<Error>).detail);
        channel.addEventListener('artifact', artifact); channel.addEventListener('closed', stop); channel.addEventListener('rejected', stop);
        this.#cleanup.push(() => { channel.removeEventListener('artifact', artifact); channel.removeEventListener('closed', stop); channel.removeEventListener('rejected', stop); });
      }
    } catch (error) { this.#stop(error); throw error; }
  }
  get closed() { return this.#reason !== undefined; }
  get closeReason() { return this.#reason; }
  #live() { if (this.closed || this.#admission.closed) throw new Error('poker_proofs:closed'); }
  #scope() {
    if (this.#head !== this.#history.checkpoint.head) {
      this.#head = this.#history.checkpoint.head;
      this.#public.clear(); this.#private.clear(); this.#prepared.clear();
    }
  }
  get shuffleSteps(): readonly number[] { return Object.freeze([...this.#steps]); }
  hasPublic(position: number, seat: number) { this.#scope(); return this.#public.has(`${position}:${seat}`); }
  hasPrivate(position: number, seat: number) { this.#scope(); return this.#private.has(`${position}:${seat}`); }
  #notifyProgress() { for (const check of [...this.#progressWaiters]) check(); }
  /** Wait for locally verified contributions from every non-owner. This never
   * opens a card and does not treat delivery as cryptographic verification. */
  waitForPrivate(position: number): Promise<void> {
    const owner = this.#admission.dealPlan.holeRecipients[position];
    if (!Number.isInteger(position) || owner === undefined) return Promise.reject(new Error('poker_proofs:position'));
    return this.#waitForContributions(position, 'private', owner);
  }
  waitForPublic(position: number): Promise<void> {
    if (!Number.isInteger(position) || position < 0 || position >= 52) return Promise.reject(new Error('poker_proofs:position'));
    return this.#waitForContributions(position, 'public');
  }
  #waitForContributions(position: number, kind: 'public' | 'private', owner?: number): Promise<void> {
    return this.#wait(kind, () => Array.from({ length: this.#history.seatCount }, (_, seat) => seat)
      .every(seat => seat === owner || (kind === 'private' ? this.hasPrivate(position, seat) : this.hasPublic(position, seat))));
  }
  waitForAnnouncements() { return this.#wait('announcements', () => this.#admission.missingAnnouncements.length === 0); }
  waitForShuffle(step: number): Promise<void> {
    if (!Number.isInteger(step) || step < 0 || step >= this.#history.seatCount) return Promise.reject(new Error('poker_proofs:step'));
    return this.#wait('shuffle', () => this.#steps.has(step), 120_000);
  }
  #wait(kind: string, complete: () => boolean, deadline = 20_000): Promise<void> {
    if (this.#progressWaiters.size >= 16) return Promise.reject(new Error('poker_proofs:wait_limit'));
    const head = this.#history.checkpoint.head;
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        clearTimeout(timer); this.#progressWaiters.delete(check);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (this.closed) return finish(new Error(this.#reason));
        if (this.#history.checkpoint.head !== head) return finish(new Error(`poker_proofs:stale_${kind}`));
        try { if (complete()) finish(); }
        catch (error) { finish(error instanceof Error ? error : new Error('poker_proofs:wait_failed')); }
      };
      this.#progressWaiters.add(check);
      timer = setTimeout(() => this.#stop(new Error(`poker_proofs:${kind}_timeout`)), deadline);
      check();
    });
  }
  async #work<T>(run: () => Promise<T>): Promise<T> {
    this.#live(); this.#scope();
    try { const result = await run(); this.#live(); return result; }
    catch (error) { if (this.#admission.closed) this.#stop(error); throw error; }
  }
  #broadcast(send: (sender: ReturnType<typeof bindPokerShuffleProofs>) => void) {
    this.#live();
    try { for (const sender of this.#senders.values()) send(sender); }
    catch (error) { this.#stop(error); throw error; }
  }
  announce() { return this.#work(async () => {
    const wire = this.#admission.ownAnnouncement;
    await this.#admission.receiveAnnouncement(this.#seat, wire);
    this.#broadcast(sender => sender.sendAnnouncement(this.#seat, wire));
    this.#notifyProgress();
  }); }
  shuffle() { return this.#work(async () => {
    const proof = await this.#admission.makeShuffle(); this.#steps.add(this.#seat);
    this.#broadcast(sender => sender.send(this.#seat, proof));
    this.#notifyProgress();
  }); }
  approve(kind: PokerApprovalKind, signature: Hex) { return this.#work(async () => {
    await this.#admission.receiveApproval(kind, this.#seat, signature);
    this.#broadcast(sender => sender.sendApproval(kind, this.#seat, signature));
  }); }
  preparePublic(position: number) { return this.#work(async () => {
    const proof = await this.#admission.makePublicContribution(position);
    this.#prepared.set(position, Uint8Array.from(proof)); this.#public.add(`${position}:${this.#seat}`);
    this.#notifyProgress();
    return Uint8Array.from(proof); // Public proof; callers cannot mutate cached bytes.
  }); }
  sendPreparedPublic(position: number) {
    this.#live(); this.#scope();
    const proof = this.#prepared.get(position);
    if (!proof) throw new Error('poker_proofs:unprepared');
    this.#broadcast(sender => sender.sendPublicContribution(position, this.#seat, proof));
  }
  sendPrivate(position: number) { return this.#work(async () => {
    const proof = await this.#admission.makePrivateContribution(position);
    this.#private.add(`${position}:${this.#seat}`);
    this.#broadcast(sender => sender.sendPrivateContribution(position, this.#seat, proof));
    this.#notifyProgress();
  }); }
  dispose(reason = new Error('poker_proofs:disposed')) { this.#stop(reason); }
  #stop(error: unknown) {
    if (this.closed) return;
    const reason = error instanceof Error ? error : new Error('poker_proofs:failed');
    this.#reason = reason.message;
    this.#notifyProgress();
    this.#cleanup.splice(0).forEach(remove => remove());
    this.#prepared.clear();
    this.#admission.dispose(reason);
    for (const channel of this.#links.values()) channel.dispose();
  }
}
