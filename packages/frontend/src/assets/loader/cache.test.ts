/**
 * Asset Pack Cache Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  storePackMetadata,
  getPackMetadata,
  getAllPackMetadata,
  deletePackMetadata,
  storeCardImage,
  getCardImage,
  isCardImageCached,
  deleteCardImage,
  getPackCacheStatus,
  clearPackCache,
  clearAllPackCaches,
  getTotalCacheSize,
} from './cache';
import type { StoredPackMetadata } from './types';

// Use globalThis to share mock stores (safe for hoisting)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__idbKeyvalMockStores = new Map<string, Map<string, unknown>>();

// Mock idb-keyval
vi.mock('idb-keyval', () => {
  const getStore = (dbName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stores = (globalThis as any).__idbKeyvalMockStores as Map<string, Map<string, unknown>>;
    if (!stores.has(dbName)) {
      stores.set(dbName, new Map());
    }
    return stores.get(dbName)!;
  };

  return {
    createStore: vi.fn((dbName: string) => ({ dbName })),
    get: vi.fn(async (key: string, store?: { dbName: string }) => {
      const dbName = store?.dbName || 'default';
      return getStore(dbName).get(key);
    }),
    set: vi.fn(async (key: string, value: unknown, store?: { dbName: string }) => {
      const dbName = store?.dbName || 'default';
      getStore(dbName).set(key, value);
    }),
    del: vi.fn(async (key: string, store?: { dbName: string }) => {
      const dbName = store?.dbName || 'default';
      getStore(dbName).delete(key);
    }),
    entries: vi.fn(async (store?: { dbName: string }) => {
      const dbName = store?.dbName || 'default';
      return Array.from(getStore(dbName).entries());
    }),
  };
});

// Helper to clear mock stores between tests
function clearMockStores() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__idbKeyvalMockStores?.clear();
}

describe('Asset Pack Cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockStores();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Pack Metadata', () => {
    const testMetadata: StoredPackMetadata = {
      id: 'test-pack',
      name: 'Test Pack',
      game: 'war',
      version: '1.0.0',
      source: { type: 'ipfs', cid: 'test-cid' },
      cardCount: 10,
      cachedCardIds: [],
      loadedAt: Date.now(),
    };

    it('stores and retrieves pack metadata', async () => {
      await storePackMetadata(testMetadata);
      const retrieved = await getPackMetadata(testMetadata.id);

      expect(retrieved).toEqual(testMetadata);
    });

    it('returns null for nonexistent pack', async () => {
      const result = await getPackMetadata('nonexistent');
      expect(result).toBeNull();
    });

    it('gets all pack metadata', async () => {
      const metadata1 = { ...testMetadata, id: 'pack1' };
      const metadata2 = { ...testMetadata, id: 'pack2' };

      await storePackMetadata(metadata1);
      await storePackMetadata(metadata2);

      const all = await getAllPackMetadata();
      expect(all).toHaveLength(2);
    });

    it('deletes pack metadata', async () => {
      await storePackMetadata(testMetadata);
      await deletePackMetadata(testMetadata.id);

      const result = await getPackMetadata(testMetadata.id);
      expect(result).toBeNull();
    });
  });

  describe('Card Images', () => {
    const packId = 'test-pack';
    const cardId = 'card1';
    const testBlob = new Blob(['test image data'], { type: 'image/png' });

    beforeEach(async () => {
      // Set up pack metadata for the tests
      await storePackMetadata({
        id: packId,
        name: 'Test Pack',
        game: 'war',
        version: '1.0.0',
        source: { type: 'ipfs', cid: 'test-cid' },
        cardCount: 10,
        cachedCardIds: [],
        loadedAt: Date.now(),
      });
    });

    it('stores and retrieves card image', async () => {
      await storeCardImage(packId, cardId, 'front', testBlob);
      const retrieved = await getCardImage(packId, cardId, 'front');

      expect(retrieved).toBeInstanceOf(Blob);
      expect(retrieved?.size).toBe(testBlob.size);
    });

    it('returns null for nonexistent card image', async () => {
      const result = await getCardImage(packId, 'nonexistent', 'front');
      expect(result).toBeNull();
    });

    it('checks if card image is cached', async () => {
      expect(await isCardImageCached(packId, cardId, 'front')).toBe(false);

      await storeCardImage(packId, cardId, 'front', testBlob);

      expect(await isCardImageCached(packId, cardId, 'front')).toBe(true);
    });

    it('deletes card image', async () => {
      await storeCardImage(packId, cardId, 'front', testBlob);
      await deleteCardImage(packId, cardId, 'front');

      const result = await getCardImage(packId, cardId, 'front');
      expect(result).toBeNull();
    });

    it('updates pack metadata when storing card image', async () => {
      await storeCardImage(packId, cardId, 'front', testBlob);

      const metadata = await getPackMetadata(packId);
      expect(metadata?.cachedCardIds).toContain(`${cardId}:front`);
    });

    it('updates pack metadata when deleting card image', async () => {
      await storeCardImage(packId, cardId, 'front', testBlob);
      await deleteCardImage(packId, cardId, 'front');

      const metadata = await getPackMetadata(packId);
      expect(metadata?.cachedCardIds).not.toContain(`${cardId}:front`);
    });
  });

  describe('Pack-Level Operations', () => {
    const packId = 'test-pack';

    beforeEach(async () => {
      await storePackMetadata({
        id: packId,
        name: 'Test Pack',
        game: 'war',
        version: '1.0.0',
        source: { type: 'ipfs', cid: 'test-cid' },
        cardCount: 10,
        cachedCardIds: ['card1:front', 'card2:front', 'card2:back'],
        loadedAt: Date.now(),
      });
    });

    it('gets cache status', async () => {
      const status = await getPackCacheStatus(packId, 10);

      expect(status.totalCards).toBe(10);
      expect(status.cachedCards).toBe(2); // card1 and card2
      expect(status.isComplete).toBe(false);
    });

    it('reports complete when all cards cached', async () => {
      await storePackMetadata({
        id: packId,
        name: 'Test Pack',
        game: 'war',
        version: '1.0.0',
        source: { type: 'ipfs', cid: 'test-cid' },
        cardCount: 2,
        cachedCardIds: ['card1:front', 'card2:front'],
        loadedAt: Date.now(),
      });

      const status = await getPackCacheStatus(packId, 2);
      expect(status.isComplete).toBe(true);
    });

    it('clears pack cache', async () => {
      await clearPackCache(packId);

      const metadata = await getPackMetadata(packId);
      expect(metadata).toBeNull();
    });

    it('clears all pack caches', async () => {
      await storePackMetadata({
        id: 'pack2',
        name: 'Pack 2',
        game: 'war',
        version: '1.0.0',
        source: { type: 'ipfs', cid: 'test-cid-2' },
        cardCount: 5,
        cachedCardIds: [],
        loadedAt: Date.now(),
      });

      await clearAllPackCaches();

      const all = await getAllPackMetadata();
      expect(all).toHaveLength(0);
    });

    it('gets total cache size', async () => {
      const size = await getTotalCacheSize();

      expect(size.packs).toBe(1);
      expect(size.images).toBe(3);
      expect(size.estimatedBytes).toBeGreaterThan(0);
    });
  });
});
