import { sha256Hex } from '@cyotee/boardgameio-crypto';

/** Fresh shuffle entropy, independent of encryption keys. Keep until reveal. */
export function createOnePieceShuffleSeed(): { seedHex: string; commitHashHex: string } {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const seedHex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { seedHex, commitHashHex: sha256Hex(new TextEncoder().encode(seedHex)) };
}
