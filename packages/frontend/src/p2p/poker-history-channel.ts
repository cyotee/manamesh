import { PokerHistoryProposal, type VerifiedPokerHistory } from '@manamesh/poker/verified-history';

export const POKER_HISTORY_CHANNEL = 'manamesh-poker-history-v1';
const CHUNK_CHARS = 4096;
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_CHUNKS = MAX_BATCH_BYTES / CHUNK_CHARS;
const MAX_FRAME_BYTES = 32 * 1024;
const MAX_QUEUED_MESSAGES = 8;
const MAX_QUEUED_BYTES = MAX_BATCH_BYTES;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const ASSEMBLY_TIMEOUT_MS = 30_000;
interface Frame { version: 1; id: string; index: number; count: number; chunk: string }
interface Assembly { id: string; count: number; chunks: string[] }

/** One collection per local history, shared by all of that seat's peer links. */
class ProposalInbox {
  #proposal?: PokerHistoryProposal;
  #parent?: string;
  #reviewing?: { wire: string; result: Promise<PokerHistoryProposal> };
  constructor(private history: VerifiedPokerHistory) {}

  get pending(): PokerHistoryProposal | undefined {
    if (this.#parent !== this.history.checkpoint.head) this.#proposal = undefined;
    return this.#proposal;
  }

  async review(wire: string): Promise<PokerHistoryProposal> {
    const pending = this.pending;
    if (pending) {
      if (pending.proposalJSON !== wire) throw new Error('poker_channel:proposal_pending');
      return pending;
    }
    // Concurrent links may announce the same action. Verify it once, without
    // allowing a competing proposal to replace it during asynchronous recovery.
    if (this.#reviewing) {
      if (this.#reviewing.wire !== wire) throw new Error('poker_channel:proposal_pending');
      return this.#reviewing.result;
    }
    const result = PokerHistoryProposal.review(this.history, wire).then(proposal => {
      this.#proposal = proposal;
      this.#parent = this.history.checkpoint.head;
      return proposal;
    }).finally(() => { this.#reviewing = undefined; });
    this.#reviewing = { wire, result };
    return result;
  }
}
// Object identity intentionally separates independently replayed histories,
// even when they share a session ID. Entries live only as long as the history.
const inboxes = new WeakMap<VerifiedPokerHistory, ProposalInbox>();

/**
 * Dedicated reliable WebRTC channel for signed proposals, votes and checkpoint batches. No host
 * snapshots, automatic signing or settlement authorization. Optional public
 * artifacts require an explicitly registered local verifier.
 * Emits `checkpoint` after local verification/persistence and `rejected` on
 * malformed, stale, incomplete or busy input. Send completion means queued only.
 */
export class PokerHistoryChannel extends EventTarget {
  #channel: RTCDataChannel;
  #history: VerifiedPokerHistory;
  #assembly?: Assembly;
  #timer?: ReturnType<typeof setTimeout>;
  #busy = false;
  #queue: { wire: string; bytes: number }[] = [];
  #queuedBytes = 0;
  #disposed = false;
  #inbox: ProposalInbox;
  #artifactVerifier?: (wire: string) => Promise<void>;

  /** Votes arriving on any channel for this local history share one collector. */
  get pendingProposal(): PokerHistoryProposal | undefined {
    return this.#disposed ? undefined : this.#inbox.pending;
  }

  async #reviewProposal(wire: string): Promise<PokerHistoryProposal> {
    if (this.#disposed) throw new Error('poker_channel:closed');
    const proposal = await this.#inbox.review(wire);
    if (this.#disposed) throw new Error('poker_channel:closed');
    return proposal;
  }

  /** Review locally before sending. The returned collector accepts local votes too. */
  async sendProposal(wire: string): Promise<PokerHistoryProposal> {
    const pending = this.pendingProposal;
    if (pending?.proposalJSON === wire) {
      this.sendBatch(JSON.stringify({ type: 'proposal', wireJSON: wire }));
      return pending;
    }
    if (this.#busy) throw new Error('poker_channel:busy');
    this.#busy = true;
    try {
      const proposal = await this.#reviewProposal(wire);
      this.sendBatch(JSON.stringify({ type: 'proposal', wireJSON: wire }));
      return proposal;
    } finally { this.#busy = false; this.#drain(); }
  }

  /** The recipient validates the signature against its pending proposal. */
  sendAcknowledgment(wire: string): string {
    if (typeof wire !== 'string' || new TextEncoder().encode(wire).length > 4096) {
      throw new Error('poker_channel:ack_size');
    }
    return this.sendBatch(JSON.stringify({ type: 'acknowledgment', wireJSON: wire }));
  }

  /** Transport receipt only: no vote or authorization. Always local checkpoint terms. */
  sendCheckpointReceipt(): string {
    const { sequence, head } = this.#history.checkpoint;
    return this.sendBatch(JSON.stringify({ type: 'checkpoint-receipt', wireJSON: JSON.stringify({ sessionId: this.#history.sessionId, sequence, head }) }));
  }

  /** Trusted local verifier integration. Registration never grants signing authority. */
  setArtifactVerifier(verify: (wire: string) => Promise<void>) {
    if (this.#disposed || this.#artifactVerifier || typeof verify !== 'function') throw new Error('poker_channel:artifact_registration');
    this.#artifactVerifier = verify;
  }
  sendArtifact(wire: string): string {
    if (!this.#artifactVerifier) throw new Error('poker_channel:artifact_unavailable');
    if (typeof wire !== 'string' || new TextEncoder().encode(wire).length > 32768) throw new Error('poker_channel:artifact_size');
    JSON.parse(wire);
    return this.sendBatch(JSON.stringify({ type: 'artifact', wireJSON: wire }));
  }

  constructor(channel: RTCDataChannel, history: VerifiedPokerHistory) {
    super();
    if (channel.label !== POKER_HISTORY_CHANNEL || !channel.ordered
      || channel.maxPacketLifeTime !== null || channel.maxRetransmits !== null) {
      throw new Error('poker_channel:dedicated_reliable_channel_required');
    }
    this.#channel = channel;
    this.#history = history;
    let inbox = inboxes.get(history);
    if (!inbox) { inbox = new ProposalInbox(history); inboxes.set(history, inbox); }
    this.#inbox = inbox;
    channel.addEventListener('message', this.#onMessage);
    channel.addEventListener('close', this.#onClose);
    channel.addEventListener('error', this.#onError);
  }

  #clearAssembly() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#assembly = undefined;
  }
  #reject(reason: unknown) {
    this.#clearAssembly();
    this.#queue = []; this.#queuedBytes = 0;
    if (!this.#disposed) this.dispatchEvent(new CustomEvent('rejected', {
      detail: reason instanceof Error ? reason : new Error(String(reason)),
    }));
  }
  #onClose = () => {
    if (this.#assembly) this.#reject(new Error('poker_channel:incomplete_on_close'));
    this.#finish(new Error('poker_channel:closed'));
  };
  #onError = () => this.#finish(new Error('poker_channel:error'));
  get closed(): boolean { return this.#disposed; }
  dispose() { this.#finish(new Error('poker_channel:disposed')); }
  #finish(reason: Error) {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#queue = []; this.#queuedBytes = 0;
    this.#clearAssembly();
    this.#channel.removeEventListener('message', this.#onMessage);
    this.#channel.removeEventListener('close', this.#onClose);
    this.#channel.removeEventListener('error', this.#onError);
    this.dispatchEvent(new CustomEvent('closed', { detail: reason }));
  }

  #onMessage = (event: MessageEvent) => {
    if (this.#disposed) return;
    try {
      const text: unknown = event.data;
      if (typeof text !== 'string' || text.length > MAX_FRAME_BYTES
        || new TextEncoder().encode(text).length > MAX_FRAME_BYTES) throw new Error('poker_channel:frame_size');
      const frame = JSON.parse(text) as Frame;
      const expected = ['version', 'id', 'index', 'count', 'chunk'];
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)
        || Object.keys(frame).length !== expected.length || !Object.keys(frame).every(key => expected.includes(key))
        || frame.version !== 1 || typeof frame.id !== 'string' || !/^[0-9a-f]{32}$/.test(frame.id)
        || !Number.isInteger(frame.count) || frame.count < 1 || frame.count > MAX_CHUNKS
        || !Number.isInteger(frame.index) || frame.index < 0 || frame.index >= frame.count
        || typeof frame.chunk !== 'string' || frame.chunk.length < 1 || frame.chunk.length > CHUNK_CHARS
        || (frame.index < frame.count - 1 && frame.chunk.length !== CHUNK_CHARS)) {
        throw new Error('poker_channel:frame');
      }
      if (!this.#assembly) {
        if (frame.index !== 0) throw new Error('poker_channel:fragment_order');
        this.#assembly = { id: frame.id, count: frame.count, chunks: [] };
        this.#timer = setTimeout(() => this.#reject(new Error('poker_channel:fragment_timeout')), ASSEMBLY_TIMEOUT_MS);
      }
      const assembly = this.#assembly;
      if (frame.id !== assembly.id || frame.count !== assembly.count || frame.index !== assembly.chunks.length) {
        throw new Error('poker_channel:fragment_order');
      }
      assembly.chunks.push(frame.chunk);
      if (assembly.chunks.length === assembly.count) {
        const wire = assembly.chunks.join('');
        this.#clearAssembly();
        const bytes = new TextEncoder().encode(wire).length;
        if (bytes > MAX_BATCH_BYTES) throw new Error('poker_channel:batch_size');
        if (this.#queue.length >= MAX_QUEUED_MESSAGES || this.#queuedBytes + bytes > MAX_QUEUED_BYTES) {
          const reason = new Error('poker_channel:receive_overflow');
          this.#reject(reason); this.#finish(reason); return;
        }
        this.#queue.push({ wire, bytes }); this.#queuedBytes += bytes;
        this.#drain();
      }
    } catch (error) { this.#reject(error); }
  };

  #drain() {
    if (this.#disposed || this.#busy) return;
    const next = this.#queue.shift();
    if (!next) return;
    this.#queuedBytes -= next.bytes;
    this.#busy = true;
    void this.#accept(next.wire);
  }

  async #accept(wire: string) {
    try {
      if (new TextEncoder().encode(wire).length > MAX_BATCH_BYTES) throw new Error('poker_channel:batch_size');
      const message: unknown = JSON.parse(wire);
      // Existing checkpoint arrays retain their v1 wire representation.
      if (message && typeof message === 'object' && !Array.isArray(message)) {
        const envelope = message as { type?: unknown; wireJSON?: unknown };
        if (Object.keys(message).length !== 2 || typeof envelope.wireJSON !== 'string'
          || !Object.keys(message).every(key => key === 'type' || key === 'wireJSON')) {
          throw new Error('poker_channel:envelope');
        }
        if (envelope.type === 'artifact') {
          try {
            if (!this.#artifactVerifier || new TextEncoder().encode(envelope.wireJSON).length > 32768) throw new Error('poker_channel:artifact_unavailable_or_size');
            const head = this.#history.checkpoint.head;
            await this.#artifactVerifier(envelope.wireJSON);
            if (this.#disposed) return;
            if (this.#history.checkpoint.head !== head) throw new Error('poker_channel:stale_artifact');
            this.dispatchEvent(new CustomEvent('artifact', { detail: envelope.wireJSON }));
          } catch (error) {
            this.#reject(error);
            this.#finish(new Error('poker_channel:artifact_failed'));
          }
        } else if (envelope.type === 'checkpoint-receipt') {
          if (envelope.wireJSON.length > 1024) throw new Error('poker_channel:receipt_size');
          const receipt = JSON.parse(envelope.wireJSON);
          const checkpoint = this.#history.checkpoint;
          if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
            || Object.keys(receipt).length !== 3 || !Object.keys(receipt).every(key => ['sessionId', 'sequence', 'head'].includes(key))
            || receipt.sessionId !== this.#history.sessionId || receipt.sequence !== checkpoint.sequence || receipt.head !== checkpoint.head) {
            throw new Error('poker_channel:receipt_terms');
          }
          if (!this.#disposed) this.dispatchEvent(new CustomEvent('checkpoint-receipt', { detail: receipt }));
        } else if (envelope.type === 'proposal') {
          const proposal = await this.#reviewProposal(envelope.wireJSON);
          if (!this.#disposed) this.dispatchEvent(new CustomEvent('proposal', { detail: proposal }));
        } else if (envelope.type === 'acknowledgment') {
          const proposal = this.pendingProposal;
          if (!proposal) throw new Error('poker_channel:no_proposal');
          await proposal.addAcknowledgment(envelope.wireJSON);
          if (!this.#disposed) this.dispatchEvent(new CustomEvent('acknowledgment', { detail: proposal }));
        } else throw new Error('poker_channel:message_type');
        return;
      }
      // Verifier enforces final UTF-8 size, signatures, local replay, and its
      // archive committer before publishing the checkpoint.
      const checkpoint = await this.#history.append(wire);
      if (!this.#disposed) this.dispatchEvent(new CustomEvent('checkpoint', { detail: checkpoint }));
    } catch (error) { this.#reject(error); }
    finally { this.#busy = false; this.#drain(); }
  }

  /** Queue one bounded batch; send completion is not peer acceptance. */
  sendBatch(wireJSON: string): string {
    if (this.#disposed || this.#channel.readyState !== 'open') throw new Error('poker_channel:closed');
    if (typeof wireJSON !== 'string' || wireJSON.length < 1 || wireJSON.length > MAX_BATCH_BYTES
      || new TextEncoder().encode(wireJSON).length > MAX_BATCH_BYTES) throw new Error('poker_channel:batch_size');
    JSON.parse(wireJSON);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const count = Math.ceil(wireJSON.length / CHUNK_CHARS);
    const frames = Array.from({ length: count }, (_, index) => JSON.stringify({
      version: 1, id, index, count, chunk: wireJSON.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS),
    } satisfies Frame));
    let size = 0;
    for (const frame of frames) {
      const bytes = new TextEncoder().encode(frame).length;
      if (bytes > MAX_FRAME_BYTES) throw new Error('poker_channel:frame_size');
      size += bytes;
    }
    if (this.#channel.bufferedAmount + size > MAX_BUFFERED_BYTES) throw new Error('poker_channel:backpressure');
    for (const frame of frames) this.#channel.send(frame);
    return id;
  }
}
