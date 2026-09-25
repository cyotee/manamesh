/** Bounded serialization for one isolated worker. No retry or phase authority. */
export class PokerWorkerQueue {
  #waiting: { run: () => Promise<Uint8Array>; resolve: (value: Uint8Array) => void; reject: (reason: Error) => void }[] = [];
  #active?: { reject: (reason: Error) => void };
  #closed = false;
  constructor(private onOverflow: () => void) {}
  enqueue(run: () => Promise<Uint8Array>): Promise<Uint8Array> {
    if (this.#closed) return Promise.reject(new Error('poker_shuffle:closed'));
    if (this.#waiting.length >= 8) {
      const error = new Error('poker_shuffle:queue_overflow');
      this.close(error); this.onOverflow();
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.#waiting.push({ run, resolve, reject });
      this.#drain();
    });
  }
  #drain() {
    if (this.#closed || this.#active) return;
    const job = this.#waiting.shift();
    if (!job) return;
    this.#active = job;
    void Promise.resolve().then(() => {
      if (this.#closed) throw new Error('poker_shuffle:closed');
      return job.run();
    }).then(value => {
      if (!this.#closed) job.resolve(value);
    }, error => { job.reject(error); }).finally(() => {
      this.#active = undefined;
      // Resolving the caller first lets it update local phase/cache metadata
      // before the next command is dispatched to the worker.
      this.#drain();
    });
  }
  close(reason = new Error('poker_shuffle:closed')) {
    if (this.#closed) return;
    this.#closed = true;
    this.#active?.reject(reason);
    this.#waiting.splice(0).forEach(job => job.reject(reason));
  }
}
