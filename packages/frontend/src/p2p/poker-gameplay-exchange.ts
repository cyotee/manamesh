import type { PokerHistorySigner, VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { PokerHistoryChannel } from './poker-history-channel';

/** Verified star-table gameplay delivery. Signing requires an explicit local
 * call; received proposals only become available for local acknowledgment.
 * The relay collects votes and distributes a fully signed checkpoint batch.
 */
export class PokerGameplayExchange {
  #links: ReadonlyMap<number, PokerHistoryChannel>;
  #history: VerifiedPokerHistory;
  #signer: PokerHistorySigner;
  #seat: number;
  #relay: number;
  #readyWire?: string;
  #forwardedWire?: string;
  #operation = false;
  #closed = false;
  #closeReason?: string;
  #waitingPeers = new Set<number>();
  #peersReady: Promise<void> = Promise.resolve();
  #releasePeers?: () => void;
  #cleanup: (() => void)[] = [];

  constructor(links: ReadonlyMap<number, PokerHistoryChannel>, history: VerifiedPokerHistory,
    signer: PokerHistorySigner, seat: number, relaySeat = 0) {
    const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < history.seatCount;
    const expected = seat === relaySeat
      ? Array.from({ length: history.seatCount }, (_, index) => index).filter(index => index !== seat) : [relaySeat];
    if (!valid(seat) || !valid(relaySeat) || links.size !== expected.length || expected.some(peer => !links.has(peer))
      || new Set(links.values()).size !== links.size || [...links.values()].some(channel => channel.closed)) {
      throw new Error('poker_gameplay:topology');
    }
    this.#links = new Map(links); this.#history = history; this.#signer = signer; this.#seat = seat; this.#relay = relaySeat;
    for (const [peer, channel] of this.#links) {
      const proposal = () => {
        // Channel event delivery occurs before its receive operation finishes.
        // Defer relay sends until that operation releases its busy guard.
        void Promise.resolve().then(() => this.#receivedProposal(channel)).catch(error => this.#finish(error));
      };
      const stop = (event: Event) => this.#finish((event as CustomEvent<Error>).detail);
      const checkpoint = () => {
        if (this.#seat !== this.#relay) {
          try { channel.sendCheckpointReceipt(); } catch (error) { this.#finish(error); }
        }
      };
      const receipt = () => {
        this.#waitingPeers.delete(peer);
        if (!this.#waitingPeers.size) { this.#releasePeers?.(); this.#releasePeers = undefined; }
      };
      channel.addEventListener('proposal', proposal);
      channel.addEventListener('rejected', stop);
      channel.addEventListener('closed', stop);
      channel.addEventListener('checkpoint', checkpoint);
      channel.addEventListener('checkpoint-receipt', receipt);
      this.#cleanup.push(() => {
        channel.removeEventListener('proposal', proposal);
        channel.removeEventListener('rejected', stop);
        channel.removeEventListener('closed', stop);
        channel.removeEventListener('checkpoint', checkpoint);
        channel.removeEventListener('checkpoint-receipt', receipt);
      });
    }
  }
  get closed() { return this.#closed; }
  get closeReason() { return this.#closeReason; }
  async #deliver(action: () => void | Promise<unknown>) {
    try { await action(); }
    catch (error) { this.#finish(error); throw error; }
  }
  #live() { if (this.#closed) throw new Error('poker_gameplay:closed'); }
  #pending() { return this.#links.values().next().value!.pendingProposal; }
  get proposalReady() { return !this.#closed && this.#readyWire !== undefined && this.#pending()?.proposalJSON === this.#readyWire; }
  get proposalForReview(): string | undefined { return this.proposalReady ? this.#readyWire : undefined; }
  get canPropose() { return !this.#closed && !this.#operation && !this.#waitingPeers.size && !this.#pending(); }
  get missingSeats(): readonly number[] { return Object.freeze(this.#pending()?.missingSeats ?? []); }
  get checkpoint() { return this.#history.checkpoint; }

  async #receivedProposal(channel: PokerHistoryChannel) {
    this.#live();
    const proposal = channel.pendingProposal;
    if (!proposal) throw new Error('poker_gameplay:no_proposal');
    const wire = proposal.proposalJSON;
    if (this.#seat === this.#relay) {
      // An early next actor may already have the previous checkpoint while a
      // slower peer is persisting it. Hold one reviewed proposal until every
      // link reports that checkpoint; never race its receiver's busy guard.
      await this.#peersReady;
      this.#live();
      // Echo to the actor too: it may acknowledge only after the relay has
      // independently reviewed the proposal. This is not a signature receipt.
      if (this.#forwardedWire !== wire) {
        this.#forwardedWire = wire;
        await this.#deliver(() => Promise.all([...this.#links.values()].map(link => link.sendProposal(wire))));
      }
    }
    this.#live();
    this.#readyWire = wire;
  }
  async #local<T>(action: () => Promise<T>): Promise<T> {
    this.#live();
    if (this.#operation) throw new Error('poker_gameplay:busy');
    this.#operation = true;
    try { return await action(); }
    finally { this.#operation = false; }
  }
  async propose(payload: string, expectedCheckpoint?: string): Promise<void> {
    return this.#local(async () => {
      if (expectedCheckpoint !== undefined && this.#history.checkpoint.head !== expectedCheckpoint) throw new Error('poker_gameplay:review_changed');
      if (this.#waitingPeers.size) throw new Error('poker_gameplay:awaiting_peer_checkpoint');
      if (this.#pending()) throw new Error('poker_gameplay:proposal_pending');
      const wire = JSON.stringify(await this.#signer.propose(payload));
      this.#live();
      await this.#deliver(() => Promise.all([...this.#links.values()].map(link => link.sendProposal(wire))));
      this.#live();
      if (this.#seat === this.#relay) { this.#forwardedWire = wire; this.#readyWire = wire; }
    });
  }
  async acknowledge(expectedProposal?: string): Promise<void> {
    return this.#local(async () => {
      if (!this.proposalReady) throw new Error('poker_gameplay:proposal_not_ready');
      const proposal = this.#pending()!;
      if (expectedProposal !== undefined && proposal.proposalJSON !== expectedProposal) throw new Error('poker_gameplay:review_changed');
      const acknowledgment = await this.#signer.acknowledge(proposal.proposalJSON);
      this.#live();
      if (acknowledgment.seat !== this.#seat) throw new Error('poker_gameplay:local_seat');
      const wire = JSON.stringify(acknowledgment);
      await proposal.addAcknowledgment(wire);
      this.#live();
      if (this.#seat !== this.#relay) await this.#deliver(() => { this.#links.get(this.#relay)!.sendAcknowledgment(wire); });
    });
  }
  async commit(expectedProposal?: string): Promise<void> {
    return this.#local(async () => {
      if (this.#seat !== this.#relay) throw new Error('poker_gameplay:relay_only');
      if (!this.proposalReady) throw new Error('poker_gameplay:proposal_not_ready');
      const proposal = this.#pending()!;
      if (expectedProposal !== undefined && proposal.proposalJSON !== expectedProposal) throw new Error('poker_gameplay:review_changed');
      const wire = proposal.batchJSON(); // Refuses any missing seat.
      await proposal.commit(); // Independently replays and durably persists.
      this.#live();
      this.#waitingPeers = new Set(this.#links.keys());
      this.#peersReady = new Promise(resolve => { this.#releasePeers = resolve; });
      await this.#deliver(() => { for (const link of this.#links.values()) link.sendBatch(wire); });
      this.#readyWire = undefined;
    });
  }
  dispose() { this.#finish(new Error('poker_gameplay:disposed')); }
  #finish(reason: unknown) {
    if (this.#closed) return;
    this.#closeReason = reason instanceof Error ? reason.message : 'poker_gameplay:failed';
    this.#closed = true;
    this.#releasePeers?.(); this.#releasePeers = undefined;
    this.#cleanup.splice(0).forEach(remove => remove());
    for (const link of this.#links.values()) link.dispose();
  }
}
