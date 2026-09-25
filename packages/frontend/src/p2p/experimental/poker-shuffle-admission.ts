import { PokerWorkerQueue } from './poker-worker-queue';
/** Experimental pinned-candidate adapter; not a live Poker entry or an audited protocol. */
import { hexToBytes, keccak256, toHex, type Hex, type LocalAccount } from 'viem';
import { PokerApprovalCollection, type PokerApprovalKind, createPokerDealPlan, type PokerDealPlan, type PokerDealtBettingReplay, type PokerPublicStreet, PokerEncryptionRoster, type VerifiedPokerHistory, type PokerSigningJournal, type PokerSigningJournalRef } from '@manamesh/poker/verified-history';

// Identifies the evaluated artifact, not a claim of audit or production approval.
export const MODULE_SHA256 = 'd1031ede4c2e4fe0f92b7aa1ca3a6e28b3c15778a215dab97b548f506ad2cf44';
export const EXPERIMENTAL_POKER_SHUFFLE_PROTOCOL = keccak256(toHex('ziffle:f24f38e6049d43336517079d4abb36e465ea2512:ark-compressed:52:worker-context-v7'));
const source = `
let instance;
onmessage = async ({ data }) => {
  try {
    if (data.op === 'initialize') {
      if (instance) throw new Error('already_initialized');
      const module = await WebAssembly.compile(data.module);
      if (WebAssembly.Module.imports(module).length) throw new Error('unexpected_imports');
      instance = await WebAssembly.instantiate(module);
    }
    const api = instance.exports;
    const bytes = new Uint8Array(data.bytes || []);
    if (bytes.length > 10000) throw new Error('input_size');
    new Uint8Array(api.memory.buffer, api.input_ptr(), bytes.length).set(bytes);
    let status;
    if (data.op === 'initialize') {
      const seed = crypto.getRandomValues(new Uint32Array(8));
      status = api.initialize(data.seats, data.seat, data.dealer, bytes.length, ...seed); seed.fill(0);
    } else if (['admit', 'receive_shuffle'].includes(data.op)) {
      status = api[data.op](data.index, bytes.length);
    } else if (['receive_token', 'review_token', 'receive_public_token'].includes(data.op)) {
      status = api[data.op](data.position, data.index, bytes.length);
    } else if (['make_token', 'open_private_card', 'make_public_token', 'open_public_card'].includes(data.op)) {
      status = api[data.op](data.position);
    } else if (['authorize_street', 'authorize_showdown'].includes(data.op)) {
      status = api[data.op](data.index, bytes.length);
    } else if (['make_shuffle', 'checkpoint_digest'].includes(data.op)) {
      status = api[data.op]();
    } else throw new Error('operation');
    const output = status === 0 ? new Uint8Array(api.memory.buffer, api.output_ptr(), api.output_len()).slice() : new Uint8Array();
    postMessage({ status, output }, [output.buffer]);
  } catch (error) { postMessage({ error: String(error) }); }
};`;

export class ExperimentalPokerShuffleAdmission extends EventTarget {
  #worker: Worker;
  #approvals = new Map<PokerApprovalKind, PokerApprovalCollection>();
  #history: VerifiedPokerHistory;
  #seat: number;
  #dealPlan: PokerDealPlan;
  #protocol: Hex;
  #own!: Hex;
  #commands = new PokerWorkerQueue(() => this.dispose());
  #roster?: PokerEncryptionRoster;
  #announcements = new Map<number, Hex>();
  #announcementJobs = new Map<number, { wire: Hex; result: Promise<void> }>();
  #announcementTail: Promise<void> = Promise.resolve();
  #authorized = false;
  #shuffleSteps = 0;
  #deckHead?: Hex;
  #deckAuthorized = false;
  #opened = new Set<number>();
  #publicCheckpoint?: Hex;
  #publicStage = -1;
  #showdownMask = 0;
  #publicPositions: readonly number[] = [];
  #publicOpened = new Map<number, number>();
  #reviewing = false;
  #closed = false;
  #pending?: { reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

  private constructor(history: VerifiedPokerHistory, seat: number, dealer: number) {
    super();
    history.signerAt(seat);
    this.#history = history; this.#seat = seat;
    this.#dealPlan = createPokerDealPlan(history.seatCount, dealer);
    this.#protocol = keccak256(toHex(JSON.stringify({ suite: EXPERIMENTAL_POKER_SHUFFLE_PROTOCOL, deal: this.#dealPlan })));
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { this.#worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
  }
  static async create(history: VerifiedPokerHistory, seat: number, wasm: Uint8Array, dealer: number, signal?: AbortSignal) {
    const abortReason = () => signal?.reason instanceof Error ? signal.reason : new Error('poker_shuffle:initialization_aborted');
    if (signal?.aborted) throw abortReason();
    createPokerDealPlan(history.seatCount, dealer);
    if (history.seatCount > 5) throw new Error('poker_shuffle:seats');
    if (!(wasm instanceof Uint8Array) || wasm.length > 1024 * 1024) throw new Error('poker_shuffle:module_size');
    const module = Uint8Array.from(wasm);
    const hash = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', module.buffer))).slice(2);
    if (signal?.aborted) throw abortReason();
    if (hash !== MODULE_SHA256) throw new Error('poker_shuffle:module_hash');
    const client = new ExperimentalPokerShuffleAdmission(history, seat, dealer);
    const aborted = () => client.dispose(abortReason());
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      if (signal?.aborted) throw abortReason();
      client.#own = toHex(await client.#call('initialize', { module: module.buffer, seats: history.seatCount, seat, dealer, bytes: hexToBytes(history.sessionId) }));
      if (signal?.aborted) throw abortReason();
      return client;
    } catch (error) { client.dispose(); throw error; }
    finally { signal?.removeEventListener('abort', aborted); }
  }
  get closed() { return this.#closed; }
  get approvalProgress() {
    const missing = () => Object.freeze(Array.from({ length: this.#history.seatCount }, (_, seat) => seat));
    return Object.freeze({ roster: this.#approvals.get('roster')?.missingSeats ?? missing(),
      deck: this.#approvals.get('deck')?.missingSeats ?? missing(), deal: this.#approvals.get('deal')?.missingSeats ?? missing() });
  }
  get dealPlan(): PokerDealPlan { return this.#dealPlan; }
  get ownAnnouncement(): Hex { return this.#own; }
  get roster(): PokerEncryptionRoster {
    if (!this.#roster) throw new Error('poker_shuffle:roster_unreviewed');
    return this.#roster;
  }
  dispose(reason = new Error('poker_shuffle:closed')) {
    if (this.#closed) return;
    this.#closed = true; this.#authorized = false; this.#deckAuthorized = false;
    this.#commands.close(reason);
    this.#worker.terminate();
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(reason);
      this.#pending = undefined;
    }
    this.dispatchEvent(new CustomEvent('closed', { detail: reason }));
  }
  #call(op: string, args: Record<string, unknown> = {}): Promise<Uint8Array> {
    const head = this.#history.checkpoint.head;
    const current = () => {
      if (this.#closed || this.#history.checkpoint.head !== head) {
        const reason = new Error('poker_shuffle:stale_command');
        this.dispose(reason); throw reason;
      }
    };
    return this.#commands.enqueue(async () => {
      current();
      const output = await this.#rawCall(op, args);
      current();
      return output;
    });
  }
  #rawCall(op: string, args: Record<string, unknown>): Promise<Uint8Array> {
    if (this.#closed) return Promise.reject(new Error('poker_shuffle:closed'));
    if (this.#pending) return Promise.reject(new Error('poker_shuffle:busy'));
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(this.#pending?.timer); this.#pending = undefined; };
      const timer = setTimeout(() => this.dispose(), 120_000);
      this.#pending = { reject, timer };
      this.#worker.onerror = () => this.dispose();
      this.#worker.onmessageerror = () => this.dispose();
      this.#worker.onmessage = ({ data }) => {
        finish();
        if (data.error) { this.dispose(); reject(new Error('poker_shuffle:worker_failed')); }
        else if (data.status !== 0) reject(new Error('poker_shuffle:proof_or_phase'));
        else if (!(data.output instanceof Uint8Array) || data.output.length > 10000) {
          this.dispose(); reject(new Error('poker_shuffle:output'));
        } else resolve(data.output);
      };
      try { this.#worker.postMessage({ op, ...args }); }
      catch (error) { finish(); this.dispose(); reject(error); }
    });
  }
  /** Native decoding/ownership/aggregate checks must finish before signing is exposed. */
  async reviewRoster(announcements: readonly Hex[]): Promise<void> {
    if (this.#roster || this.#closed || this.#pending || this.#reviewing || this.#announcements.size || this.#announcementJobs.size) throw new Error('poker_shuffle:roster_state');
    const roster = new PokerEncryptionRoster(this.#history, this.#protocol, announcements);
    if (roster.announcements[this.#seat] !== this.#own) throw new Error('poker_shuffle:own_key_substitution');
    this.#reviewing = true;
    try {
      for (const [seat, bytes] of roster.announcements.entries()) await this.#call('admit', { index: seat, bytes: hexToBytes(bytes) });
      if (this.#closed) throw new Error('poker_shuffle:closed');
      this.#roster = roster;
    } catch (error) { this.dispose(); throw error; }
    finally { this.#reviewing = false; }
  }
  get missingAnnouncements(): readonly number[] {
    return Object.freeze(this.#roster ? [] : Array.from({ length: this.#history.seatCount }, (_, seat) => seat).filter(seat => !this.#announcements.has(seat)));
  }
  /** Bounded seat collection; worker operations are serialized across peer links.
   * Ownership proofs are checked here; roster signing remains a separate gate.
   */
  receiveAnnouncement(seat: number, wire: Hex): Promise<void> {
    if (this.#closed || this.#reviewing || this.#history.checkpoint.sequence !== 0) return Promise.reject(new Error('poker_shuffle:announcement_state'));
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.#history.seatCount || typeof wire !== 'string' || !/^0x[0-9a-f]{196}$/.test(wire)) return Promise.reject(new Error('poker_shuffle:announcement'));
    if (seat === this.#seat && wire !== this.#own) return Promise.reject(new Error('poker_shuffle:own_key_substitution'));
    const known = this.#roster?.announcements[seat] ?? this.#announcements.get(seat);
    if (known) return known === wire ? Promise.resolve() : Promise.reject(new Error('poker_shuffle:announcement_conflict'));
    const pending = this.#announcementJobs.get(seat);
    if (pending) return pending.wire === wire ? pending.result : Promise.reject(new Error('poker_shuffle:announcement_busy'));
    const result = this.#announcementTail.then(async () => {
      if (this.#closed || this.#history.checkpoint.sequence !== 0) throw new Error('poker_shuffle:announcement_state');
      await this.#call('admit', { index: seat, bytes: hexToBytes(wire) });
      if (this.#closed || this.#history.checkpoint.sequence !== 0) throw new Error('poker_shuffle:announcement_state');
      this.#announcements.set(seat, wire);
      if (this.#announcements.size === this.#history.seatCount) {
        this.#roster = new PokerEncryptionRoster(this.#history, this.#protocol,
          Array.from({ length: this.#history.seatCount }, (_, index) => this.#announcements.get(index)!));
      }
    }).catch(error => { this.dispose(error); throw error; }).finally(() => this.#announcementJobs.delete(seat));
    this.#announcementJobs.set(seat, { wire, result });
    this.#announcementTail = result.catch(() => {});
    return result;
  }
  #approvalCollection(kind: PokerApprovalKind) {
    if (this.#closed) throw new Error('poker_shuffle:closed');
    if (kind !== 'roster' && kind !== 'deck' && kind !== 'deal') throw new Error('poker_shuffle:approval_kind');
    if (kind !== 'roster') {
      this.#ready();
      if (!this.#deckHead || this.#shuffleSteps !== this.#history.seatCount) throw new Error('poker_shuffle:shuffle_incomplete');
    }
    if (kind === 'deal') this.#privateReady();
    let collection = this.#approvals.get(kind);
    if (!collection) {
      collection = new PokerApprovalCollection(this.roster, kind, kind === 'roster' ? undefined : this.#deckHead!);
      this.#approvals.set(kind, collection);
    }
    return collection;
  }
  async receiveApproval(kind: PokerApprovalKind, seat: number, signature: Hex) {
    await this.#approvalCollection(kind).add(seat, signature);
    if (this.#closed) throw new Error('poker_shuffle:closed');
  }
  missingApprovals(kind: PokerApprovalKind) { return this.#approvalCollection(kind).missingSeats; }
  approvalEnvelope(kind: PokerApprovalKind) { return this.#approvalCollection(kind).envelope(); }
  signRoster(account: Pick<LocalAccount, 'address' | 'signTypedData'>, journal: PokerSigningJournal, reference: PokerSigningJournalRef) {
    if (this.#closed) throw new Error('poker_shuffle:closed');
    return this.roster.sign(this.#seat, this.#own, account, journal, reference);
  }
  async authorize(wire: string) {
    if (this.#closed) throw new Error('poker_shuffle:closed');
    await this.roster.verifyAuthorization(wire);
    if (this.#closed) throw new Error('poker_shuffle:closed');
    this.#authorized = true;
  }
  #ready() {
    if (this.#closed || !this.#authorized) throw new Error('poker_shuffle:unauthorized');
  }
  async makeShuffle() {
    this.#ready();
    const bytes = await this.#call('make_shuffle');
    this.#shuffleSteps++;
    return bytes;
  }
  async receiveShuffle(step: number, bytes: Uint8Array) {
    this.#ready(); this.#input(step, bytes);
    const output = await this.#call('receive_shuffle', { index: step, bytes: Uint8Array.from(bytes) });
    this.#shuffleSteps++;
    return output;
  }
  /** No host-supplied head: the completed local verifier is the only source. */
  async reviewDeck(): Promise<Hex> {
    this.#ready();
    if (this.#shuffleSteps !== this.#history.seatCount) throw new Error('poker_shuffle:shuffle_incomplete');
    if (!this.#deckHead) {
      const digest = await this.#call('checkpoint_digest');
      if (digest.length !== 32) { this.dispose(); throw new Error('poker_shuffle:deck_digest'); }
      this.#deckHead = toHex(digest);
    }
    return this.#deckHead;
  }
  async signDeck(account: Pick<LocalAccount, 'address' | 'signTypedData'>, journal: PokerSigningJournal, reference: PokerSigningJournalRef) {
    const head = await this.reviewDeck();
    this.#ready();
    return this.roster.signDeck(this.#seat, head, account, journal, reference);
  }
  async authorizeDeck(wire: string) {
    const head = await this.reviewDeck();
    await this.roster.verifyDeckAuthorization(wire, head);
    this.#ready();
    this.#deckAuthorized = true;
  }
  #privateReady() {
    this.#ready();
    if (!this.#deckAuthorized) throw new Error('poker_shuffle:deck_unauthorized');
  }
  makePrivateContribution(position: number) { this.#privateReady(); this.#position(position); return this.#call('make_token', { position }); }
  /** Verify a non-owner contribution without retaining it or opening any card. */
  reviewPrivateContribution(position: number, seat: number, bytes: Uint8Array) {
    this.#privateReady(); this.#position(position); this.#input(seat, bytes);
    return this.#call('review_token', { position, index: seat, bytes: Uint8Array.from(bytes) });
  }
  /** The canonical owner retains verified shares; every other seat only reviews. */
  acceptPrivateContribution(position: number, seat: number, bytes: Uint8Array) {
    this.#privateReady(); this.#position(position); this.#input(seat, bytes);
    const op = this.#dealPlan.holeRecipients[position] === this.#seat ? 'receive_token' : 'review_token';
    return this.#call(op, { position, index: seat, bytes: Uint8Array.from(bytes) });
  }
  receivePrivateContribution(position: number, seat: number, bytes: Uint8Array) {
    this.#privateReady(); this.#position(position); this.#input(seat, bytes); return this.#call('receive_token', { position, index: seat, bytes: Uint8Array.from(bytes) });
  }
  async openPrivateCard(position: number) {
    this.#privateReady(); this.#position(position);
    const card = await this.#call('open_private_card', { position });
    if (card.length !== 1 || card[0] >= 52) { this.dispose(); throw new Error('poker_shuffle:private_card'); }
    this.#opened.add(position);
    return card;
  }
  signDeal(account: Pick<LocalAccount, 'address' | 'signTypedData'>, journal: PokerSigningJournal, reference: PokerSigningJournalRef) {
    this.#privateReady();
    if (!this.#dealPlan.holePositions[this.#seat].every(position => this.#opened.has(position))) throw new Error('poker_shuffle:private_deal_incomplete');
    return this.roster.signDeal(this.#seat, this.#deckHead!, account, journal, reference);
  }
  authorizeFlop(replay: PokerDealtBettingReplay) { return this.authorizePublicStreet(replay, 'flop'); }
  async authorizePublicStreet(replay: PokerDealtBettingReplay, street: PokerPublicStreet) {
    this.#privateReady();
    const request = replay.communityRequest(this.#history, street);
    const expected = request.stage === 0 ? this.#dealPlan.communityPositions.slice(0, 3) : [this.#dealPlan.communityPositions[request.stage + 2]];
    if (request.deckHead !== this.#deckHead || JSON.stringify(request.positions) !== JSON.stringify(expected)) throw new Error('poker_shuffle:street_binding');
    if (this.#publicCheckpoint === request.checkpoint && this.#publicStage === request.stage) return;
    if (request.stage !== this.#publicStage + 1) throw new Error('poker_shuffle:street_order');
    await this.#call('authorize_street', { index: request.stage, bytes: hexToBytes(request.checkpoint) });
    if (this.#closed || this.#history.checkpoint.head !== request.checkpoint) { this.dispose(); throw new Error('poker_shuffle:stale_public'); }
    this.#publicCheckpoint = request.checkpoint;
    this.#publicStage = request.stage;
    this.#publicPositions = request.positions;
  }
  async authorizeShowdown(replay: PokerDealtBettingReplay) {
    this.#privateReady();
    const request = replay.showdownRequest(this.#history);
    const expected = this.#dealPlan.holeRecipients.flatMap((owner, position) => request.mask & (1 << owner) ? [position] : []);
    if (request.deckHead !== this.#deckHead || JSON.stringify(request.positions) !== JSON.stringify(expected)) throw new Error('poker_shuffle:showdown_binding');
    if (this.#publicStage === 3 && this.#publicCheckpoint === request.checkpoint) return;
    if (this.#publicStage !== 2) throw new Error('poker_shuffle:showdown_order');
    await this.#call('authorize_showdown', { index: request.mask, bytes: hexToBytes(request.checkpoint) });
    if (this.#closed || this.#history.checkpoint.head !== request.checkpoint) { this.dispose(); throw new Error('poker_shuffle:stale_showdown'); }
    this.#publicCheckpoint = request.checkpoint;
    this.#publicStage = 3;
    this.#showdownMask = request.mask;
    this.#publicPositions = request.positions;
  }
  bindShowdown(replay: PokerDealtBettingReplay) {
    if (this.#publicStage !== 3) throw new Error('poker_shuffle:showdown_order');
    this.#publicPositions.forEach(position => this.#publicReady(position));
    if (this.#publicPositions.some(position => !this.#publicOpened.has(position))) throw new Error('poker_shuffle:showdown_incomplete');
    const hands = this.#dealPlan.holePositions.map((positions, seat) => this.#showdownMask & (1 << seat) ? positions.map(position => this.#publicOpened.get(position)!) : null);
    replay.bindShowdown(this.#history, this.#publicCheckpoint!, hands);
    return hands;
  }
  #publicReady(position: number) {
    this.#privateReady();
    if (!this.#publicCheckpoint || this.#history.checkpoint.head !== this.#publicCheckpoint) throw new Error('poker_shuffle:public_unauthorized');
    if (!Number.isInteger(position) || !this.#publicPositions.includes(position)) throw new Error('poker_shuffle:public_position');
  }
  makePublicContribution(position: number) { this.#publicReady(position); return this.#call('make_public_token', { position }); }
  receivePublicContribution(position: number, seat: number, bytes: Uint8Array) {
    this.#publicReady(position); this.#input(seat, bytes);
    return this.#call('receive_public_token', { position, index: seat, bytes: Uint8Array.from(bytes) });
  }
  async openPublicCard(position: number) {
    this.#publicReady(position);
    const card = await this.#call('open_public_card', { position });
    this.#publicReady(position);
    if (card.length !== 1 || card[0] >= 52) { this.dispose(); throw new Error('poker_shuffle:public_card'); }
    this.#publicOpened.set(position, card[0]);
    return card;
  }
  bindFlop(replay: PokerDealtBettingReplay) { return this.bindPublicStreet(replay, 'flop'); }
  bindPublicStreet(replay: PokerDealtBettingReplay, street: PokerPublicStreet) {
    if (['flop', 'turn', 'river'].indexOf(street) !== this.#publicStage) throw new Error('poker_shuffle:street_order');
    const positions = this.#publicPositions;
    positions.forEach(position => this.#publicReady(position));
    if (positions.some(position => !this.#publicOpened.has(position))) throw new Error(`poker_shuffle:${street}_incomplete`);
    const cards = positions.map(position => this.#publicOpened.get(position)!);
    replay.bindCommunity(this.#history, street, this.#publicCheckpoint!, cards);
    return cards;
  }
  #position(position: number) {
    if (!Number.isInteger(position) || position < 0 || position >= this.#dealPlan.holeRecipients.length) throw new Error('poker_shuffle:position');
  }
  #input(index: number, bytes: Uint8Array) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#history.seatCount
      || !(bytes instanceof Uint8Array) || bytes.length > 10000) throw new Error('poker_shuffle:input');
  }
}
