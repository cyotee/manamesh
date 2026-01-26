/**
 * Asset Pack Loader Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadPack,
  getLoadedPack,
  getAllLoadedPacks,
  unloadPack,
  getCardImageBlob,
  getCardImageUrl,
  preloadPack,
  getCacheStatus,
  clearCache,
} from './loader';
import type { AssetPackSource, IPFSSource, HTTPSource } from './types';
import { sourceToPackId } from './types';

// Mock the dependencies
vi.mock('./fetcher', () => ({
  fetchJson: vi.fn(),
  fetchBlob: vi.fn(),
  fetchText: vi.fn(),
  isSourceReachable: vi.fn(),
}));

vi.mock('./cache', () => ({
  storePackMetadata: vi.fn().mockResolvedValue(undefined),
  getPackMetadata: vi.fn().mockResolvedValue(null),
  getAllPackMetadata: vi.fn().mockResolvedValue([]),
  getCardImage: vi.fn().mockResolvedValue(null),
  storeCardImage: vi.fn().mockResolvedValue(undefined),
  isCardImageCached: vi.fn().mockResolvedValue(false),
  getPackCacheStatus: vi.fn().mockResolvedValue({
    totalCards: 0,
    cachedCards: 0,
    sizeBytes: 0,
    isComplete: false,
  }),
  clearPackCache: vi.fn().mockResolvedValue(undefined),
  clearAllPackCaches: vi.fn().mockResolvedValue(undefined),
}));

import { fetchJson, fetchBlob } from './fetcher';
import {
  storePackMetadata,
  getPackMetadata,
  getCardImage,
  storeCardImage,
  isCardImageCached,
  getPackCacheStatus,
  clearPackCache,
} from './cache';

const mockFetchJson = fetchJson as ReturnType<typeof vi.fn>;
const mockFetchBlob = fetchBlob as ReturnType<typeof vi.fn>;
const mockGetCardImage = getCardImage as ReturnType<typeof vi.fn>;
const mockStoreCardImage = storeCardImage as ReturnType<typeof vi.fn>;
const mockIsCardImageCached = isCardImageCached as ReturnType<typeof vi.fn>;
const mockGetPackCacheStatus = getPackCacheStatus as ReturnType<typeof vi.fn>;
const mockClearPackCache = clearPackCache as ReturnType<typeof vi.fn>;

describe('Asset Pack Loader', () => {
  const testManifest = {
    name: 'Test Pack',
    version: '1.0.0',
    game: 'war',
    cards: [
      { id: 'card1', name: 'Card One', front: 'cards/card1/front.png' },
      {
        id: 'card2',
        name: 'Card Two',
        front: 'cards/card2/front.png',
        back: 'cards/card2/back.png',
      },
    ],
  };

  const ipfsSource: IPFSSource = {
    type: 'ipfs',
    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  };

  const httpSource: HTTPSource = {
    type: 'http',
    baseUrl: 'https://example.com/assets/test-pack',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear in-memory cache
    for (const pack of getAllLoadedPacks()) {
      unloadPack(pack.id);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadPack', () => {
    it('loads an asset pack from IPFS source', async () => {
      mockFetchJson.mockResolvedValue(testManifest);

      const pack = await loadPack(ipfsSource);

      expect(pack.id).toBe(sourceToPackId(ipfsSource));
      expect(pack.manifest.name).toBe('Test Pack');
      expect(pack.cards).toHaveLength(2);
      expect(pack.source).toBe(ipfsSource);
      expect(mockFetchJson).toHaveBeenCalledWith(
        ipfsSource,
        'manifest.json',
        expect.any(Object)
      );
    });

    it('loads an asset pack from HTTP source', async () => {
      mockFetchJson.mockResolvedValue(testManifest);

      const pack = await loadPack(httpSource);

      expect(pack.id).toBe(sourceToPackId(httpSource));
      expect(pack.manifest.name).toBe('Test Pack');
      expect(pack.cards).toHaveLength(2);
      expect(pack.source).toBe(httpSource);
    });

    it('returns cached pack if already loaded', async () => {
      mockFetchJson.mockResolvedValue(testManifest);

      const pack1 = await loadPack(ipfsSource);
      const pack2 = await loadPack(ipfsSource);

      expect(pack1).toBe(pack2);
      expect(mockFetchJson).toHaveBeenCalledTimes(1);
    });

    it('throws on invalid manifest', async () => {
      mockFetchJson.mockResolvedValue({ invalid: true });

      await expect(loadPack(ipfsSource)).rejects.toThrow('Invalid manifest');
    });

    it('resolves nested manifests', async () => {
      const rootManifest = {
        name: 'Root Pack',
        version: '1.0.0',
        game: 'war',
        sets: [{ name: 'Set A', path: 'sets/a' }],
      };

      const setAManifest = {
        name: 'Set A',
        version: '1.0.0',
        game: 'war',
        cards: [{ id: 'setA-card1', name: 'Set A Card', front: 'card1.png' }],
      };

      mockFetchJson
        .mockResolvedValueOnce(rootManifest)
        .mockResolvedValueOnce(setAManifest);

      const pack = await loadPack(ipfsSource);

      expect(pack.cards).toHaveLength(1);
      expect(pack.cards[0].id).toBe('setA-card1');
      expect(pack.cards[0].front).toBe('sets/a/card1.png');
    });
  });

  describe('getLoadedPack', () => {
    it('returns undefined for unloaded pack', () => {
      expect(getLoadedPack('nonexistent')).toBeUndefined();
    });

    it('returns loaded pack', async () => {
      mockFetchJson.mockResolvedValue(testManifest);

      const loaded = await loadPack(ipfsSource);
      const retrieved = getLoadedPack(loaded.id);

      expect(retrieved).toBe(loaded);
    });
  });

  describe('unloadPack', () => {
    it('removes pack from memory cache', async () => {
      mockFetchJson.mockResolvedValue(testManifest);

      const pack = await loadPack(ipfsSource);
      expect(getLoadedPack(pack.id)).toBeDefined();

      unloadPack(pack.id);
      expect(getLoadedPack(pack.id)).toBeUndefined();
    });
  });

  describe('getCardImageBlob', () => {
    it('returns cached image if available', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      const cachedBlob = new Blob(['cached'], { type: 'image/png' });
      mockGetCardImage.mockResolvedValue(cachedBlob);

      const packId = sourceToPackId(ipfsSource);
      const result = await getCardImageBlob(packId, 'card1', 'front');

      expect(result.blob).toBe(cachedBlob);
      expect(result.fromCache).toBe(true);
      expect(mockFetchBlob).not.toHaveBeenCalled();
    });

    it('fetches and caches image if not cached', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      const freshBlob = new Blob(['fresh'], { type: 'image/png' });
      mockGetCardImage.mockResolvedValue(null);
      mockFetchBlob.mockResolvedValue(freshBlob);

      const packId = sourceToPackId(ipfsSource);
      const result = await getCardImageBlob(packId, 'card1', 'front');

      expect(result.blob).toBe(freshBlob);
      expect(result.fromCache).toBe(false);
      expect(mockStoreCardImage).toHaveBeenCalledWith(
        packId,
        'card1',
        'front',
        freshBlob
      );
    });

    it('returns placeholder for missing card', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      mockGetCardImage.mockResolvedValue(null);

      const packId = sourceToPackId(ipfsSource);
      const result = await getCardImageBlob(packId, 'nonexistent', 'front');

      expect(result.fromCache).toBe(false);
      // Placeholder blob should be returned
      expect(result.blob.size).toBeGreaterThan(0);
    });

    it('returns placeholder for unloaded pack', async () => {
      mockGetCardImage.mockResolvedValue(null);

      const result = await getCardImageBlob('unknown-pack', 'card1', 'front');

      expect(result.fromCache).toBe(false);
    });

    it('returns placeholder for card without back image', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      mockGetCardImage.mockResolvedValue(null);

      const packId = sourceToPackId(ipfsSource);
      // card1 has no back image
      const result = await getCardImageBlob(packId, 'card1', 'back');

      expect(result.fromCache).toBe(false);
    });
  });

  describe('getCardImageUrl', () => {
    it('returns object URL for card image', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      const blob = new Blob(['test'], { type: 'image/png' });
      mockGetCardImage.mockResolvedValue(blob);

      const packId = sourceToPackId(ipfsSource);
      const url = await getCardImageUrl(packId, 'card1', 'front');

      expect(url).toMatch(/^blob:/);
      URL.revokeObjectURL(url);
    });
  });

  describe('preloadPack', () => {
    it('fetches all card images', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      mockGetCardImage.mockResolvedValue(null);
      mockIsCardImageCached.mockResolvedValue(false);
      mockFetchBlob.mockResolvedValue(new Blob(['img'], { type: 'image/png' }));

      const packId = sourceToPackId(ipfsSource);
      const progress: [number, number][] = [];

      await preloadPack(packId, (loaded, total) => {
        progress.push([loaded, total]);
      });

      // card1 has front only, card2 has front and back = 3 images
      expect(progress.length).toBeGreaterThan(0);
      const lastProgress = progress[progress.length - 1];
      expect(lastProgress[0]).toBe(lastProgress[1]); // loaded equals total at end
    });

    it('skips already cached images', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      mockGetCardImage.mockResolvedValue(null);
      mockIsCardImageCached.mockResolvedValue(true); // All cached
      mockFetchBlob.mockResolvedValue(new Blob(['img'], { type: 'image/png' }));

      const packId = sourceToPackId(ipfsSource);
      await preloadPack(packId);

      // Should not fetch any images since all are cached
      expect(mockFetchBlob).not.toHaveBeenCalled();
    });

    it('throws for unloaded pack', async () => {
      await expect(preloadPack('unknown-pack')).rejects.toThrow('not loaded');
    });
  });

  describe('getCacheStatus', () => {
    it('returns cache status for pack', async () => {
      mockFetchJson.mockResolvedValue(testManifest);
      await loadPack(ipfsSource);

      mockGetPackCacheStatus.mockResolvedValue({
        totalCards: 2,
        cachedCards: 1,
        sizeBytes: 50000,
        isComplete: false,
      });

      const packId = sourceToPackId(ipfsSource);
      const status = await getCacheStatus(packId);

      expect(status.totalCards).toBe(2);
      expect(status.cachedCards).toBe(1);
      expect(status.isComplete).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('clears cache for specific pack', async () => {
      const packId = 'test-pack-id';
      await clearCache(packId);

      expect(mockClearPackCache).toHaveBeenCalledWith(packId);
    });
  });
});

describe('sourceToPackId', () => {
  it('generates consistent ID for IPFS source', () => {
    const source: IPFSSource = {
      type: 'ipfs',
      cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    };

    const id1 = sourceToPackId(source);
    const id2 = sourceToPackId(source);

    expect(id1).toBe(id2);
    expect(id1).toContain('ipfs:');
    expect(id1).toContain(source.cid);
  });

  it('generates consistent ID for HTTP source', () => {
    const source: HTTPSource = {
      type: 'http',
      baseUrl: 'https://example.com/assets/',
    };

    const id1 = sourceToPackId(source);
    const id2 = sourceToPackId(source);

    expect(id1).toBe(id2);
    expect(id1).toContain('http:');
  });

  it('normalizes HTTP URLs', () => {
    const source1: HTTPSource = {
      type: 'http',
      baseUrl: 'https://example.com/assets/',
    };
    const source2: HTTPSource = {
      type: 'http',
      baseUrl: 'https://example.com/assets',
    };

    // Both should produce the same ID (trailing slash normalized)
    expect(sourceToPackId(source1)).toBe(sourceToPackId(source2));
  });
});
