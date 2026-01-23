/**
 * Unit tests for IndexedDB cache module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFromCache,
  putInCache,
  isInCache,
  removeFromCache,
  getCacheStats,
  clearCache,
  getCachedCids,
} from './cache';

// Mock idb-keyval
const mockStore = new Map<string, unknown>();
const mockMetaStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string, store?: unknown) => {
    const targetStore = store === 'meta' ? mockMetaStore : mockStore;
    return Promise.resolve(targetStore.get(key));
  }),
  set: vi.fn((key: string, value: unknown, store?: unknown) => {
    const targetStore = store === 'meta' ? mockMetaStore : mockStore;
    targetStore.set(key, value);
    return Promise.resolve();
  }),
  del: vi.fn((key: string, store?: unknown) => {
    const targetStore = store === 'meta' ? mockMetaStore : mockStore;
    targetStore.delete(key);
    return Promise.resolve();
  }),
  createStore: vi.fn((dbName: string) => {
    // Return different identifiers for different stores
    if (dbName.includes('meta')) return 'meta';
    return 'assets';
  }),
}));

describe('Cache Module', () => {
  beforeEach(() => {
    mockStore.clear();
    mockMetaStore.clear();
    vi.clearAllMocks();
  });

  describe('putInCache / getFromCache', () => {
    it('should store and retrieve a blob', async () => {
      const testCid = 'bafytest123';
      const testBlob = new Blob(['test content'], { type: 'text/plain' });

      await putInCache(testCid, testBlob);

      // Verify blob was stored
      expect(mockStore.has(testCid)).toBe(true);

      // Verify metadata was updated
      const metadata = mockMetaStore.get('cache-metadata');
      expect(metadata).toBeDefined();
    });

    it('should return null for non-existent CID', async () => {
      const result = await getFromCache('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('isInCache', () => {
    it('should return false for uncached CID', async () => {
      const result = await isInCache('uncached');
      expect(result).toBe(false);
    });

    it('should return true for cached CID after storing', async () => {
      // Setup metadata to indicate cached
      mockMetaStore.set('cache-metadata', {
        totalSize: 100,
        entries: [{ cid: 'cached123', size: 100, lastAccessed: Date.now() }],
      });

      const result = await isInCache('cached123');
      expect(result).toBe(true);
    });
  });

  describe('removeFromCache', () => {
    it('should remove a cached entry', async () => {
      const testCid = 'toremove';

      // Setup initial state
      mockStore.set(testCid, new Blob(['data']));
      mockMetaStore.set('cache-metadata', {
        totalSize: 50,
        entries: [{ cid: testCid, size: 50, lastAccessed: Date.now() }],
      });

      await removeFromCache(testCid);

      expect(mockStore.has(testCid)).toBe(false);
    });
  });

  describe('getCacheStats', () => {
    it('should return empty stats for empty cache', async () => {
      const stats = await getCacheStats();

      expect(stats.totalSize).toBe(0);
      expect(stats.entryCount).toBe(0);
      expect(stats.usagePercent).toBe(0);
      expect(stats.maxSize).toBe(100 * 1024 * 1024); // 100MB
    });

    it('should return correct stats when cache has entries', async () => {
      mockMetaStore.set('cache-metadata', {
        totalSize: 50 * 1024 * 1024, // 50MB
        entries: [
          { cid: 'cid1', size: 25 * 1024 * 1024, lastAccessed: Date.now() },
          { cid: 'cid2', size: 25 * 1024 * 1024, lastAccessed: Date.now() },
        ],
      });

      const stats = await getCacheStats();

      expect(stats.totalSize).toBe(50 * 1024 * 1024);
      expect(stats.entryCount).toBe(2);
      expect(stats.usagePercent).toBe(50);
    });
  });

  describe('clearCache', () => {
    it('should clear all entries', async () => {
      // Setup initial state
      mockStore.set('cid1', new Blob(['data1']));
      mockStore.set('cid2', new Blob(['data2']));
      mockMetaStore.set('cache-metadata', {
        totalSize: 100,
        entries: [
          { cid: 'cid1', size: 50, lastAccessed: Date.now() },
          { cid: 'cid2', size: 50, lastAccessed: Date.now() },
        ],
      });

      await clearCache();

      // Check metadata was reset
      const metadata = mockMetaStore.get('cache-metadata') as {
        totalSize: number;
        entries: unknown[];
      };
      expect(metadata.totalSize).toBe(0);
      expect(metadata.entries).toHaveLength(0);
    });
  });

  describe('getCachedCids', () => {
    it('should return empty array for empty cache', async () => {
      const cids = await getCachedCids();
      expect(cids).toEqual([]);
    });

    it('should return all cached CIDs', async () => {
      mockMetaStore.set('cache-metadata', {
        totalSize: 100,
        entries: [
          { cid: 'cid1', size: 50, lastAccessed: Date.now() },
          { cid: 'cid2', size: 50, lastAccessed: Date.now() },
        ],
      });

      const cids = await getCachedCids();

      expect(cids).toContain('cid1');
      expect(cids).toContain('cid2');
      expect(cids).toHaveLength(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when cache is full', async () => {
      // Setup cache near limit (99MB used)
      const oldEntry = {
        cid: 'old-entry',
        size: 99 * 1024 * 1024,
        lastAccessed: Date.now() - 10000, // 10 seconds ago
      };

      mockStore.set('old-entry', new Blob(['x'.repeat(1000)]));
      mockMetaStore.set('cache-metadata', {
        totalSize: 99 * 1024 * 1024,
        entries: [oldEntry],
      });

      // Try to add a 5MB blob (should trigger eviction)
      const newBlob = new Blob(['y'.repeat(5 * 1024 * 1024)]);
      await putInCache('new-entry', newBlob);

      // Assert: old entry should have been evicted
      expect(mockStore.has('old-entry')).toBe(false);

      // Assert: new entry should be stored
      expect(mockStore.has('new-entry')).toBe(true);

      // Assert: metadata should reflect the change
      const metadata = mockMetaStore.get('cache-metadata') as {
        totalSize: number;
        entries: { cid: string; size: number; lastAccessed: number }[];
      };

      // Old entry should not be in metadata
      expect(metadata.entries.find(e => e.cid === 'old-entry')).toBeUndefined();

      // New entry should be in metadata
      expect(metadata.entries.find(e => e.cid === 'new-entry')).toBeDefined();

      // Total size should be updated (only new entry size)
      expect(metadata.totalSize).toBe(newBlob.size);
    });

    it('should evict multiple entries if needed to fit new entry', async () => {
      // Setup cache with multiple small entries totaling 98MB
      const now = Date.now();
      const entries = [
        { cid: 'entry-1', size: 30 * 1024 * 1024, lastAccessed: now - 30000 }, // oldest
        { cid: 'entry-2', size: 30 * 1024 * 1024, lastAccessed: now - 20000 },
        { cid: 'entry-3', size: 38 * 1024 * 1024, lastAccessed: now - 10000 }, // newest
      ];

      entries.forEach(e => mockStore.set(e.cid, new Blob(['x'])));
      mockMetaStore.set('cache-metadata', {
        totalSize: 98 * 1024 * 1024,
        entries: [...entries],
      });

      // Try to add a 50MB blob (should evict entry-1 and entry-2)
      const newBlob = new Blob(['y'.repeat(50 * 1024 * 1024)]);
      await putInCache('big-entry', newBlob);

      // Assert: oldest entries should be evicted
      expect(mockStore.has('entry-1')).toBe(false);
      expect(mockStore.has('entry-2')).toBe(false);

      // Assert: newest old entry might still exist (depending on space)
      // entry-3 (38MB) + big-entry (50MB) = 88MB < 100MB limit
      expect(mockStore.has('entry-3')).toBe(true);

      // Assert: new entry should be stored
      expect(mockStore.has('big-entry')).toBe(true);

      const metadata = mockMetaStore.get('cache-metadata') as {
        totalSize: number;
        entries: { cid: string }[];
      };

      // Should have entry-3 and big-entry
      expect(metadata.entries).toHaveLength(2);
      expect(metadata.entries.find(e => e.cid === 'entry-3')).toBeDefined();
      expect(metadata.entries.find(e => e.cid === 'big-entry')).toBeDefined();
    });

    it('should preserve recently accessed entries during eviction', async () => {
      const now = Date.now();
      // Setup: old large entry (90MB, old access) and recent small entry (5MB, recent)
      const entries = [
        { cid: 'old-big', size: 90 * 1024 * 1024, lastAccessed: now - 60000 }, // oldest, should be evicted first
        { cid: 'recent-small', size: 5 * 1024 * 1024, lastAccessed: now - 1000 }, // recent
      ];

      entries.forEach(e => mockStore.set(e.cid, new Blob(['x'])));
      mockMetaStore.set('cache-metadata', {
        totalSize: 95 * 1024 * 1024,
        entries: [...entries],
      });

      // Add 10MB entry - should evict old-big (oldest) to make room
      const newBlob = new Blob(['y'.repeat(10 * 1024 * 1024)]);
      await putInCache('new-entry', newBlob);

      // Assert: old entry evicted, recent entry preserved
      expect(mockStore.has('old-big')).toBe(false);
      expect(mockStore.has('recent-small')).toBe(true);
      expect(mockStore.has('new-entry')).toBe(true);

      const metadata = mockMetaStore.get('cache-metadata') as {
        totalSize: number;
        entries: { cid: string }[];
      };

      // Cache should contain recent-small and new-entry
      expect(metadata.entries).toHaveLength(2);
      expect(metadata.entries.find(e => e.cid === 'recent-small')).toBeDefined();
      expect(metadata.entries.find(e => e.cid === 'new-entry')).toBeDefined();
    });

    it('should not evict anything if cache has room', async () => {
      // Setup cache with 50MB used
      const entry = {
        cid: 'existing',
        size: 50 * 1024 * 1024,
        lastAccessed: Date.now() - 10000,
      };

      mockStore.set('existing', new Blob(['x']));
      mockMetaStore.set('cache-metadata', {
        totalSize: 50 * 1024 * 1024,
        entries: [entry],
      });

      // Add 10MB entry - plenty of room, no eviction needed
      const newBlob = new Blob(['y'.repeat(10 * 1024 * 1024)]);
      await putInCache('new-entry', newBlob);

      // Assert: both entries should exist
      expect(mockStore.has('existing')).toBe(true);
      expect(mockStore.has('new-entry')).toBe(true);

      const metadata = mockMetaStore.get('cache-metadata') as {
        totalSize: number;
        entries: { cid: string }[];
      };

      expect(metadata.entries).toHaveLength(2);
    });
  });
});
