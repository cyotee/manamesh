/**
 * useGameCardImages — Pure Logic Tests
 *
 * Tests the exported helper functions (baseCardId, buildBaseToInstanceMap,
 * loadGameCardImages) without requiring React rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { baseCardId, buildBaseToInstanceMap, loadGameCardImages } from './useGameCardImages';

// Mock URL.createObjectURL for loadGameCardImages
let urlCounter = 0;
beforeEach(() => {
  urlCounter = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${urlCounter++}`);
  globalThis.URL.revokeObjectURL = vi.fn();
});

// ---------------------------------------------------------------------------
// baseCardId
// ---------------------------------------------------------------------------

describe('baseCardId', () => {
  it('strips instance suffix', () => {
    expect(baseCardId('OP01-015#2')).toBe('OP01-015');
    expect(baseCardId('OP01-010#0')).toBe('OP01-010');
  });

  it('returns original ID when no suffix', () => {
    expect(baseCardId('OP01-001')).toBe('OP01-001');
  });

  it('handles edge case of # at end', () => {
    expect(baseCardId('OP01-001#')).toBe('OP01-001');
  });

  it('strips player-tagged instance suffix', () => {
    expect(baseCardId('OP01-015#p0.0')).toBe('OP01-015');
    expect(baseCardId('OP01-015#p1.3')).toBe('OP01-015');
  });

  it('strips leader player tag', () => {
    expect(baseCardId('OP01-001#p0')).toBe('OP01-001');
    expect(baseCardId('OP01-001#p1')).toBe('OP01-001');
  });
});

// ---------------------------------------------------------------------------
// buildBaseToInstanceMap
// ---------------------------------------------------------------------------

describe('buildBaseToInstanceMap', () => {
  it('groups instances by base ID', () => {
    const map = buildBaseToInstanceMap([
      'OP01-010#0',
      'OP01-010#1',
      'OP01-010#2',
      'OP01-010#3',
    ]);
    expect(map.get('OP01-010')).toEqual([
      'OP01-010#0',
      'OP01-010#1',
      'OP01-010#2',
      'OP01-010#3',
    ]);
    expect(map.size).toBe(1);
  });

  it('keeps base IDs without suffix as-is', () => {
    const map = buildBaseToInstanceMap(['OP01-001', 'OP01-010#0']);
    expect(map.get('OP01-001')).toEqual(['OP01-001']);
    expect(map.get('OP01-010')).toEqual(['OP01-010#0']);
    expect(map.size).toBe(2);
  });

  it('returns empty map for empty input', () => {
    expect(buildBaseToInstanceMap([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadGameCardImages
// ---------------------------------------------------------------------------

describe('loadGameCardImages', () => {
  function makeLoadBlob(blobMap: Map<string, Blob>) {
    return async (packId: string, cardId: string): Promise<Blob | null> => {
      return blobMap.get(`${packId}:${cardId}`) ?? null;
    };
  }

  const bigBlob = new Blob(['x'.repeat(200)], { type: 'image/png' });
  const tinyBlob = new Blob(['x'], { type: 'image/png' }); // placeholder

  it('returns empty record for empty input', async () => {
    const result = await loadGameCardImages([], new Map(), async () => null);
    expect(result).toEqual({});
  });

  it('loads images and maps instance IDs to URLs', async () => {
    const blobs = new Map([['pack-1:OP01-010', bigBlob]]);
    const packMap = new Map([['OP01-010', 'pack-1']]);

    const result = await loadGameCardImages(
      ['OP01-010#0', 'OP01-010#1', 'OP01-010#2', 'OP01-010#3'],
      packMap,
      makeLoadBlob(blobs),
    );

    // All 4 instances share one URL
    expect(Object.keys(result).length).toBe(4);
    const urls = new Set(Object.values(result));
    expect(urls.size).toBe(1);

    // URL.createObjectURL called only once (deduplicated)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('handles cards without instance suffix', async () => {
    const blobs = new Map([['pack-1:OP01-001', bigBlob]]);
    const packMap = new Map([['OP01-001', 'pack-1']]);

    const result = await loadGameCardImages(
      ['OP01-001'],
      packMap,
      makeLoadBlob(blobs),
    );

    expect(result['OP01-001']).toMatch(/^blob:/);
  });

  it('uses correct packId for multi-pack cards', async () => {
    const loadBlob = vi.fn(async (packId: string, cardId: string) => bigBlob);
    const packMap = new Map([
      ['OP01-001', 'pack-1'],
      ['OP02-001', 'pack-2'],
    ]);

    await loadGameCardImages(
      ['OP01-001', 'OP02-001'],
      packMap,
      loadBlob,
    );

    expect(loadBlob).toHaveBeenCalledWith('pack-1', 'OP01-001');
    expect(loadBlob).toHaveBeenCalledWith('pack-2', 'OP02-001');
  });

  it('skips cards with no pack mapping', async () => {
    const loadBlob = vi.fn(async () => bigBlob);
    const packMap = new Map([['OP01-001', 'pack-1']]);

    const result = await loadGameCardImages(
      ['OP01-001', 'UNKNOWN-001'],
      packMap,
      loadBlob,
    );

    expect(result['OP01-001']).toBeDefined();
    expect(result['UNKNOWN-001']).toBeUndefined();
    expect(loadBlob).toHaveBeenCalledTimes(1); // only called for OP01-001
  });

  it('skips placeholder blobs (< 100 bytes)', async () => {
    const blobs = new Map([['pack-1:OP01-001', tinyBlob]]);
    const packMap = new Map([['OP01-001', 'pack-1']]);

    const result = await loadGameCardImages(
      ['OP01-001'],
      packMap,
      makeLoadBlob(blobs),
    );

    expect(result['OP01-001']).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('handles load errors gracefully', async () => {
    const loadBlob = vi.fn(async () => {
      throw new Error('IndexedDB error');
    });
    const packMap = new Map([['OP01-001', 'pack-1']]);

    const result = await loadGameCardImages(
      ['OP01-001'],
      packMap,
      loadBlob,
    );

    expect(result['OP01-001']).toBeUndefined();
  });

  it('handles null return from loadBlob', async () => {
    const loadBlob = vi.fn(async () => null);
    const packMap = new Map([['OP01-001', 'pack-1']]);

    const result = await loadGameCardImages(
      ['OP01-001'],
      packMap,
      loadBlob,
    );

    expect(result['OP01-001']).toBeUndefined();
  });
});
