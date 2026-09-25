import { expect, it, vi } from 'vitest';
import { PokerWorkerQueue } from './poker-worker-queue';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
it('serializes concurrent commands and allows caller metadata to settle before the next command', async () => {
  const queue = new PokerWorkerQueue(vi.fn()); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let metadata = false;
  const first = queue.enqueue(async () => { await gate; return new Uint8Array([1]); }).then(value => { metadata = true; return value; });
  const next = vi.fn(async () => { expect(metadata).toBe(true); return new Uint8Array([2]); });
  const second = queue.enqueue(next);
  await tick(); expect(next).not.toHaveBeenCalled();
  release(); expect([...await first]).toEqual([1]); expect([...await second]).toEqual([2]);
  queue.close();
});
it('preserves individual proof errors without replaying a failed command', async () => {
  const queue = new PokerWorkerQueue(vi.fn());
  const bad = vi.fn(async () => { throw new Error('invalid_proof'); });
  const failed = queue.enqueue(bad); const good = queue.enqueue(async () => new Uint8Array([3]));
  await expect(failed).rejects.toThrow('invalid_proof');
  expect([...await good]).toEqual([3]); expect(bad).toHaveBeenCalledTimes(1); queue.close();
});
it('bounds pending commands and rejects active and queued callers on overflow', async () => {
  const overflow = vi.fn(); const queue = new PokerWorkerQueue(overflow);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const run = vi.fn(async () => new Uint8Array());
  const active = queue.enqueue(async () => { await gate; return new Uint8Array(); });
  await tick();
  const pending = Array.from({ length: 8 }, () => queue.enqueue(run));
  const results = Promise.allSettled([active, ...pending]);
  await expect(queue.enqueue(run)).rejects.toThrow('queue_overflow');
  expect((await results).every(result => result.status === 'rejected')).toBe(true);
  expect(overflow).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled();
  release(); await tick(); expect(run).not.toHaveBeenCalled();
  await expect(queue.enqueue(run)).rejects.toThrow('closed');
});
it('does not dispatch a queued command after disposal', async () => {
  const queue = new PokerWorkerQueue(vi.fn()); const run = vi.fn(async () => new Uint8Array());
  const pending = queue.enqueue(run); queue.close();
  await expect(pending).rejects.toThrow('closed'); await tick(); expect(run).not.toHaveBeenCalled();
});
