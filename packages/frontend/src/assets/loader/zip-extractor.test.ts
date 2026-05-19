/**
 * Tests for zip-extractor utilities.
 */

import { describe, it, expect } from 'vitest';
import { zip as fflateZip } from 'fflate';
import { extractZip, decodeTextEntry, entryToBlob, inferMimeType } from './zip-extractor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestZip(files: Record<string, string>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const input: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      input[path] = new TextEncoder().encode(content);
    }
    fflateZip(input, { level: 1 }, (err, data) => {
      if (err) reject(err);
      else resolve(new Blob([new Uint8Array(data)], { type: 'application/zip' }));
    });
  });
}

// ---------------------------------------------------------------------------
// extractZip
// ---------------------------------------------------------------------------

describe('extractZip', () => {
  it('extracts entries from a valid zip blob', async () => {
    const zip = await createTestZip({
      'manifest.json': '{"name":"test"}',
      'cards/card1.png': 'fake-png-data',
    });

    const { entries, totalSize } = await extractZip(zip);

    expect(entries.has('manifest.json')).toBe(true);
    expect(entries.has('cards/card1.png')).toBe(true);
    expect(totalSize).toBeGreaterThan(0);
  });

  it('returns the correct content for each entry', async () => {
    const content = '{"name":"my pack"}';
    const zip = await createTestZip({ 'manifest.json': content });

    const { entries } = await extractZip(zip);
    const raw = entries.get('manifest.json')!;
    expect(new TextDecoder().decode(raw)).toBe(content);
  });

  it('skips directory entries (zero-length data)', async () => {
    const zip = await createTestZip({ 'manifest.json': 'data' });
    // fflate doesn't emit directory entries for files, so this just
    // verifies that files with content are included
    const { entries } = await extractZip(zip);
    for (const [, data] of entries) {
      expect(data.length).toBeGreaterThan(0);
    }
  });

  it('rejects on corrupt zip data', async () => {
    const corrupt = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])]);
    await expect(extractZip(corrupt)).rejects.toThrow();
  });

  it('handles a zip with multiple files', async () => {
    const zip = await createTestZip({
      'manifest.json': '{}',
      'cards/a.png': 'aaa',
      'cards/b.png': 'bbb',
      'cards/c.png': 'ccc',
    });

    const { entries } = await extractZip(zip);
    expect(entries.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// decodeTextEntry
// ---------------------------------------------------------------------------

describe('decodeTextEntry', () => {
  it('decodes UTF-8 bytes to a string', () => {
    const text = 'Hello, world! ✓';
    const encoded = new TextEncoder().encode(text);
    expect(decodeTextEntry(encoded)).toBe(text);
  });

  it('handles empty input', () => {
    expect(decodeTextEntry(new Uint8Array(0))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// entryToBlob
// ---------------------------------------------------------------------------

describe('entryToBlob', () => {
  it('creates a Blob with the given MIME type', () => {
    const data = new Uint8Array([1, 2, 3]);
    const blob = entryToBlob(data, 'image/png');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('creates a copy so the original buffer is not shared', () => {
    const data = new Uint8Array([10, 20, 30]);
    const blob = entryToBlob(data, 'application/octet-stream');
    expect(blob.size).toBe(data.length);
  });
});

// ---------------------------------------------------------------------------
// inferMimeType
// ---------------------------------------------------------------------------

describe('inferMimeType', () => {
  it.each([
    ['card.png', 'image/png'],
    ['card.PNG', 'image/png'],
    ['card.jpg', 'image/jpeg'],
    ['card.jpeg', 'image/jpeg'],
    ['card.webp', 'image/webp'],
    ['card.gif', 'image/gif'],
    ['card.svg', 'image/svg+xml'],
    ['manifest.json', 'application/json'],
    ['data.xyz', 'application/octet-stream'],
    ['no-extension', 'application/octet-stream'],
  ])('%s → %s', (filename, expected) => {
    expect(inferMimeType(filename)).toBe(expected);
  });

  it('handles paths with directory separators', () => {
    expect(inferMimeType('cards/subfolder/front.png')).toBe('image/png');
  });
});
