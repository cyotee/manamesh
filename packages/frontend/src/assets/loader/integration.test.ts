/**
 * Integration Test for IPFS Asset Pack Loading
 *
 * Tests the full loading pipeline from IPFS gateway to parsed asset pack.
 * NOTE: Requires network access to IPFS gateways.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { STANDARD_CARDS_SOURCE, STANDARD_CARDS_CID } from '../packs/standard-cards';

// Skip these tests if not in integration test mode
const INTEGRATION = process.env.INTEGRATION_TEST === 'true';

// Set up mock localStorage before importing modules that use it
const localStorageData = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => localStorageData.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageData.set(key, value),
  removeItem: (key: string) => localStorageData.delete(key),
  clear: () => localStorageData.clear(),
  get length() { return localStorageData.size; },
  key: (i: number) => Array.from(localStorageData.keys())[i] ?? null,
};

// @ts-expect-error - mocking global
globalThis.localStorage = mockLocalStorage;

// Mock IndexedDB storage - use vi.hoisted to properly access in factory
const { mockStorage } = vi.hoisted(() => {
  const mockStorage = new Map<string, unknown>();
  return { mockStorage };
});

vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => ({})),
  get: vi.fn(async (key: string) => mockStorage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    mockStorage.set(key, value);
  }),
  del: vi.fn(async (key: string) => mockStorage.delete(key)),
  entries: vi.fn(async () => Array.from(mockStorage.entries())),
}));

// Import after mock setup
import { loadAsset } from '../ipfs-loader';
import { loadZipPack } from './zip-loader';

describe.skipIf(!INTEGRATION)('IPFS Asset Loading Integration', () => {
  // Longer timeout for network operations
  vi.setConfig({ testTimeout: 60000 });

  beforeEach(() => {
    mockStorage.clear();
  });

  describe('Raw IPFS Loading', () => {
    it('loads raw content from IPFS gateway', async () => {
      const result = await loadAsset(STANDARD_CARDS_CID, {
        preferGateway: true,
        gatewayTimeout: 30000,
      });

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.size).toBeGreaterThan(1000); // Should be a substantial file
      expect(result.source).toBe('gateway');

      // Verify it looks like a zip file (PK magic bytes)
      const buffer = await result.blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      expect(bytes[0]).toBe(0x50); // 'P'
      expect(bytes[1]).toBe(0x4b); // 'K'
    });
  });

  describe('Zip Pack Loading', () => {
    it('loads and extracts zip pack from IPFS', async () => {
      const progressUpdates: Array<{ loaded: number; total: number }> = [];

      const pack = await loadZipPack(
        STANDARD_CARDS_SOURCE,
        { gatewayTimeout: 30000 },
        (loaded, total) => {
          progressUpdates.push({ loaded, total });
        }
      );

      // Verify pack loaded correctly
      expect(pack).toBeDefined();
      expect(pack.manifest).toBeDefined();
      // The auto-detected manifest uses 'poker' as the game type
      expect(pack.manifest.game).toBe('poker');
      expect(pack.manifest.cards.length).toBeGreaterThan(50); // 52 cards + jokers

      // Verify progress was tracked
      expect(progressUpdates.length).toBeGreaterThan(0);
      const lastProgress = progressUpdates[progressUpdates.length - 1];
      expect(lastProgress.loaded).toBe(lastProgress.total);

      // Verify cards are present - auto-detection uses {RANK}{SUIT} format like "AS" for Ace of Spades
      const hasAceOfSpades = pack.manifest.cards.some(
        (c) => c.id === 'AS' || c.id === 'spades-A' || c.id === 'ace_of_spades'
      );
      expect(hasAceOfSpades).toBe(true);
    });

    it('validates pack structure and card data', async () => {
      const pack = await loadZipPack(STANDARD_CARDS_SOURCE, {
        gatewayTimeout: 30000,
      });

      // Verify pack structure
      expect(pack.id).toContain('ipfs-zip:');
      expect(pack.manifest.cards.length).toBe(54); // 52 cards + 2 jokers
      expect(pack.loadedAt).toBeGreaterThan(0);

      // Verify specific cards exist with correct structure
      const aceOfSpades = pack.manifest.cards.find((c) => c.id === 'spades-A');
      expect(aceOfSpades).toBeDefined();
      expect(aceOfSpades!.name).toBe('Ace of Spades');
      expect(aceOfSpades!.front).toContain('.png');

      // Verify all suits are present
      const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
      for (const suit of suits) {
        const suitCards = pack.manifest.cards.filter((c) => c.id.startsWith(suit));
        expect(suitCards.length).toBeGreaterThanOrEqual(13); // A-K
      }

      // Note: IndexedDB caching is tested separately in cache.test.ts
      // The zip loader logs confirm caching happens during extraction
    });
  });
});

// Unit test that doesn't require network - verifies the loading code structure
describe('IPFS Asset Loading Structure', () => {
  it('exports loadAsset function', async () => {
    expect(typeof loadAsset).toBe('function');
  });

  it('exports loadZipPack function', async () => {
    expect(typeof loadZipPack).toBe('function');
  });

  it('has valid standard cards configuration', () => {
    expect(STANDARD_CARDS_CID).toMatch(/^Qm[a-zA-Z0-9]+$/);
    expect(STANDARD_CARDS_SOURCE.type).toBe('ipfs-zip');
    expect(STANDARD_CARDS_SOURCE.cid).toBe(STANDARD_CARDS_CID);
  });
});
