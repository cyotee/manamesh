import { toHex } from 'viem';
import { MODULE_SHA256 } from './poker-shuffle-admission';

/** Fixed same-origin asset only. Invitations never choose executable code. */
export async function loadPokerVerificationModule(signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch('/poker-protected.wasm', { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('poker_module:unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Error('poker_module:size');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const hash = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer))).slice(2);
  if (signal.aborted) throw new Error('poker_module:aborted');
  if (hash !== MODULE_SHA256) throw new Error('poker_module:hash');
  return bytes;
}
