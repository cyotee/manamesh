/**
 * Tests for the SDP codec
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { encodeOffer, decodeOffer, isValidJoinCode } from './codec';
import type { ConnectionOffer } from './webrtc';

// Mock sample SDP data (simplified for testing)
const sampleSdp = `v=0
o=- 1234567890 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:efghijklmnopqrstuvwxyz12
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF
a=setup:actpass
a=mid:0
a=sctp-port:5000
`;

const sampleIceCandidates: RTCIceCandidateInit[] = [
  {
    candidate: 'candidate:1 1 UDP 2122252543 192.168.1.100 50000 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  },
  {
    candidate: 'candidate:2 1 UDP 1685987071 203.0.113.1 50001 typ srflx raddr 192.168.1.100 rport 50000',
    sdpMid: '0',
    sdpMLineIndex: 0,
  },
];

const sampleOffer: ConnectionOffer = {
  sdp: sampleSdp,
  iceCandidates: sampleIceCandidates,
};

// Force codec to use fallback (no compression) by removing CompressionStream
// This avoids gzip header issues in Node test environment
const originalCompressionStream = (globalThis as any).CompressionStream;
const originalDecompressionStream = (globalThis as any).DecompressionStream;

beforeAll(() => {
  // Remove compression APIs to force fallback path
  delete (globalThis as any).CompressionStream;
  delete (globalThis as any).DecompressionStream;
});

afterAll(() => {
  // Restore original if they existed
  if (originalCompressionStream) {
    (globalThis as any).CompressionStream = originalCompressionStream;
  }
  if (originalDecompressionStream) {
    (globalThis as any).DecompressionStream = originalDecompressionStream;
  }
});

describe('encodeOffer', () => {
  it('encodes an offer to a base64 string', async () => {
    const encoded = await encodeOffer(sampleOffer);

    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    // URL-safe base64 should only contain these characters
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces URL-safe base64 (no +, /, or = characters)', async () => {
    const encoded = await encodeOffer(sampleOffer);

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});

describe('decodeOffer', () => {
  it('decodes an encoded offer back to original structure', async () => {
    const encoded = await encodeOffer(sampleOffer);
    const decoded = await decodeOffer(encoded);

    // SDP should have same essential content (may have different line endings)
    expect(decoded.sdp).toContain('v=0');
    expect(decoded.sdp).toContain('a=ice-ufrag:abcd');
    expect(decoded.sdp).toContain('a=ice-pwd:efghijklmnopqrstuvwxyz12');

    // ICE candidates should match
    expect(decoded.iceCandidates).toHaveLength(2);
    expect(decoded.iceCandidates[0].candidate).toBe(sampleIceCandidates[0].candidate);
    expect(decoded.iceCandidates[0].sdpMid).toBe(sampleIceCandidates[0].sdpMid);
    expect(decoded.iceCandidates[0].sdpMLineIndex).toBe(sampleIceCandidates[0].sdpMLineIndex);
    expect(decoded.iceCandidates[1].candidate).toBe(sampleIceCandidates[1].candidate);
  });

  it('throws on invalid join code', async () => {
    await expect(decodeOffer('invalid-code-that-is-not-base64!')).rejects.toThrow('Invalid join code');
  });

  it('throws on empty string', async () => {
    await expect(decodeOffer('')).rejects.toThrow('Invalid join code');
  });

  it('handles whitespace-padded codes', async () => {
    const encoded = await encodeOffer(sampleOffer);
    const paddedCode = `  ${encoded}  \n`;
    const decoded = await decodeOffer(paddedCode);

    expect(decoded.sdp).toContain('v=0');
    expect(decoded.iceCandidates).toHaveLength(2);
  });
});

describe('encode/decode roundtrip', () => {
  it('maintains data integrity through encode/decode cycle', async () => {
    const originalOffer: ConnectionOffer = {
      sdp: sampleSdp,
      iceCandidates: [
        { candidate: 'candidate:1 1 UDP 123456 10.0.0.1 9999 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      ],
    };

    const encoded = await encodeOffer(originalOffer);
    const decoded = await decodeOffer(encoded);

    expect(decoded.iceCandidates[0].candidate).toBe(originalOffer.iceCandidates[0].candidate);
    expect(decoded.iceCandidates[0].sdpMid).toBe(originalOffer.iceCandidates[0].sdpMid);
    expect(decoded.iceCandidates[0].sdpMLineIndex).toBe(originalOffer.iceCandidates[0].sdpMLineIndex);
  });

  it('preserves multiple ICE candidates', async () => {
    const offer: ConnectionOffer = {
      sdp: sampleSdp,
      iceCandidates: [
        { candidate: 'candidate:1 1 UDP 1 1.1.1.1 1111 typ host', sdpMid: '0', sdpMLineIndex: 0 },
        { candidate: 'candidate:2 1 UDP 2 2.2.2.2 2222 typ srflx', sdpMid: '0', sdpMLineIndex: 0 },
        { candidate: 'candidate:3 1 TCP 3 3.3.3.3 3333 typ relay', sdpMid: '1', sdpMLineIndex: 1 },
      ],
    };

    const encoded = await encodeOffer(offer);
    const decoded = await decodeOffer(encoded);

    expect(decoded.iceCandidates).toHaveLength(3);
    expect(decoded.iceCandidates[0].candidate).toContain('1.1.1.1');
    expect(decoded.iceCandidates[1].candidate).toContain('2.2.2.2');
    expect(decoded.iceCandidates[2].candidate).toContain('3.3.3.3');
    expect(decoded.iceCandidates[2].sdpMid).toBe('1');
    expect(decoded.iceCandidates[2].sdpMLineIndex).toBe(1);
  });
});

describe('isValidJoinCode', () => {
  it('returns true for valid base64 strings of sufficient length', () => {
    // Generate a valid-looking code (minimum 50 chars of URL-safe base64)
    const validCode = 'A'.repeat(50);
    expect(isValidJoinCode(validCode)).toBe(true);

    const longerValidCode = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.repeat(2);
    expect(isValidJoinCode(longerValidCode)).toBe(true);
  });

  it('returns false for strings that are too short', () => {
    expect(isValidJoinCode('ABC123')).toBe(false);
    expect(isValidJoinCode('A'.repeat(49))).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidJoinCode('')).toBe(false);
  });

  it('returns false for strings with invalid characters', () => {
    const withPlus = 'A'.repeat(50) + '+';
    expect(isValidJoinCode(withPlus)).toBe(false);

    const withSlash = 'A'.repeat(50) + '/';
    expect(isValidJoinCode(withSlash)).toBe(false);

    const withEquals = 'A'.repeat(50) + '=';
    expect(isValidJoinCode(withEquals)).toBe(false);

    const withSpace = 'A'.repeat(25) + ' ' + 'A'.repeat(25);
    expect(isValidJoinCode(withSpace)).toBe(false);
  });

  it('handles codes with URL-safe base64 characters (- and _)', () => {
    const withDash = 'A'.repeat(25) + '-' + 'A'.repeat(25);
    expect(isValidJoinCode(withDash)).toBe(true);

    const withUnderscore = 'A'.repeat(25) + '_' + 'A'.repeat(25);
    expect(isValidJoinCode(withUnderscore)).toBe(true);
  });

  it('trims whitespace before validation', () => {
    const validCode = 'A'.repeat(50);
    expect(isValidJoinCode(`  ${validCode}  `)).toBe(true);
    expect(isValidJoinCode(`\n${validCode}\n`)).toBe(true);
  });
});

describe('code size', () => {
  it('produces codes under 1000 characters for typical offers', async () => {
    const encoded = await encodeOffer(sampleOffer);

    // Target is under 500, but without real compression in test env, we're more lenient
    // Real browser compression should produce much smaller codes
    expect(encoded.length).toBeLessThan(1000);
    console.log(`Encoded offer length: ${encoded.length} characters`);
  });
});
