/**
 * Codec for encoding/decoding WebRTC connection offers to shareable join codes
 * Uses compression + base64 to minimize code length
 */

import type { ConnectionOffer } from './webrtc';

/**
 * Compress a string using the browser's CompressionStream API
 * Falls back to no compression if not available
 */
async function compress(data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(data);

  // Check if CompressionStream is available
  if (typeof CompressionStream === 'undefined') {
    return inputBytes;
  }

  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(inputBytes);
  writer.close();

  const compressedChunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    compressedChunks.push(value);
  }

  // Combine chunks
  const totalLength = compressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of compressedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompress a Uint8Array using the browser's DecompressionStream API
 * Falls back to treating as uncompressed if decompression fails
 */
async function decompress(data: Uint8Array): Promise<string> {
  const decoder = new TextDecoder();

  // Check if DecompressionStream is available
  if (typeof DecompressionStream === 'undefined') {
    return decoder.decode(data);
  }

  try {
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    // Create a new Uint8Array to ensure proper buffer type
    writer.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    writer.close();

    const decompressedChunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      decompressedChunks.push(value);
    }

    // Combine chunks
    const totalLength = decompressedChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of decompressedChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return decoder.decode(result);
  } catch {
    // If decompression fails, assume data is uncompressed
    return decoder.decode(data);
  }
}

/**
 * Convert Uint8Array to URL-safe base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Convert URL-safe base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Restore standard base64
  const standardBase64 = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Add padding if needed
  const padded = standardBase64 + '==='.slice(0, (4 - (standardBase64.length % 4)) % 4);

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Minify SDP by removing unnecessary whitespace and comments
 */
function minifySdp(sdp: string): string {
  return sdp
    .split('\r\n')
    .filter(line => line.trim() && !line.startsWith('a=extmap'))  // Remove some optional lines
    .join('\n');
}

/**
 * Restore SDP format from minified version
 */
function restoreSdp(minified: string): string {
  return minified
    .split('\n')
    .join('\r\n') + '\r\n';
}

/**
 * Encode a ConnectionOffer to a shareable join code
 */
export async function encodeOffer(offer: ConnectionOffer): Promise<string> {
  // Create a minimal representation
  const payload = {
    s: minifySdp(offer.sdp),
    i: offer.iceCandidates.map(c => ({
      c: c.candidate,
      m: c.sdpMid,
      l: c.sdpMLineIndex,
    })),
  };

  const json = JSON.stringify(payload);
  const compressed = await compress(json);
  return uint8ArrayToBase64(compressed);
}

/**
 * Decode a join code back to a ConnectionOffer
 */
export async function decodeOffer(code: string): Promise<ConnectionOffer> {
  try {
    const bytes = base64ToUint8Array(code.trim());
    const json = await decompress(bytes);
    const payload = JSON.parse(json);

    return {
      sdp: restoreSdp(payload.s),
      iceCandidates: payload.i.map((c: { c: string; m: string; l: number }) => ({
        candidate: c.c,
        sdpMid: c.m,
        sdpMLineIndex: c.l,
      })),
    };
  } catch (error) {
    throw new Error('Invalid join code: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

/**
 * Validate that a string looks like a valid join code
 */
export function isValidJoinCode(code: string): boolean {
  // URL-safe base64 pattern, minimum reasonable length
  const trimmed = code.trim();
  return /^[A-Za-z0-9_-]{50,}$/.test(trimmed);
}
