import { expect, it } from 'vitest';
import { decodeOffer, encodeOffer } from './codec';

it('round-trips an offer through native gzip streams', async () => {
  const offer = { sdp: 'v=0\r\ns=mesh\r\n', iceCandidates: [] };
  expect(typeof CompressionStream).toBe('function');
  const encoded = await encodeOffer(offer);
  expect(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')).charCodeAt(0)).toBe(0x1f);
  expect(await decodeOffer(encoded)).toEqual(offer);
});

it('accepts legacy uncompressed codes without unhandled stream rejections', async () => {
  const code = btoa(JSON.stringify({ s: 'v=0\ns=mesh', i: [] })).replace(/=/g, '');
  expect(await decodeOffer(code)).toEqual({ sdp: 'v=0\r\ns=mesh\r\n', iceCandidates: [] });
  // Let rejected stream writes reach the test runner's unhandled-rejection check.
  await new Promise(resolve => setTimeout(resolve, 0));
});
