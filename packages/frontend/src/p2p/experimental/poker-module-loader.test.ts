import { afterEach, expect, it, vi } from 'vitest';
import { loadPokerVerificationModule } from './poker-module-loader';
afterEach(() => vi.unstubAllGlobals());
it('uses a fixed asset path and rejects bytes that do not match the pin', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 1, 2])));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  await expect(loadPokerVerificationModule(signal)).rejects.toThrow('module:hash');
  expect(fetcher).toHaveBeenCalledWith('/poker-protected.wasm', { signal, redirect: 'error' });
});
it('cancels an oversized response before retaining it', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  await expect(loadPokerVerificationModule(new AbortController().signal)).rejects.toThrow('module:size');
  expect(cancel).toHaveBeenCalledOnce();
});
it('fails when the configured module is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await expect(loadPokerVerificationModule(new AbortController().signal)).rejects.toThrow('module:unavailable');
});
