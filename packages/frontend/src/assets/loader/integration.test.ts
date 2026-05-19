import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { setHeliaForTest, clearHeliaTestInstance } from '../ipfs-loader';

const MINIMAL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
  0x00, 0x00, 0x00, 0x85, 0x00, 0x01, 0x9B, 0x8E,
  0x1A, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
  0x44, 0xAE, 0x42, 0x60, 0x82,
]);

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

const { mockStorage } = vi.hoisted(() => {
  const mockStorage = new Map<string, unknown>();
  return { mockStorage };
});

vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => ({})),
  get: vi.fn(async (key: string) => mockStorage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { mockStorage.set(key, value); }),
  del: vi.fn(async (key: string) => { mockStorage.delete(key); }),
  entries: vi.fn(async () => Array.from(mockStorage.entries())),
}));

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    gateways: [],
    useCustomGatewaysFirst: true,
    includeDefaultGateways: true,
    gatewayTimeout: 120000,
    heliaInitTimeout: 10000,
    heliaFetchTimeout: 30000,
    preferGateway: false,
  })),
  setConfig: vi.fn(),
  resetConfig: vi.fn(),
  getEffectiveGateways: vi.fn(() => ['https://w3s.link/ipfs/']),
}));

async function buildTestZip(): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    name: 'Test Card Pack',
    version: '1.0.0',
    game: 'poker',
    cards: [
      { id: 'spades-A', name: 'Ace of Spades', front: 'cards/spades-A.png' },
      { id: 'hearts-K', name: 'King of Hearts', front: 'cards/hearts-K.png' },
      { id: 'clubs-2', name: 'Two of Clubs', front: 'cards/clubs-2.png' },
      { id: 'diamonds-J', name: 'Jack of Diamonds', front: 'cards/diamonds-J.png' },
    ],
  }));
  const cardsFolder = zip.folder('cards')!;
  for (const id of ['spades-A', 'hearts-K', 'clubs-2', 'diamonds-J']) {
    cardsFolder.file(`${id}.png`, MINIMAL_PNG);
  }
  return zip.generateAsync({ type: 'blob' }) as Promise<Blob>;
}

describe('IPFS Asset Loading Integration', () => {
  vi.setConfig({ testTimeout: 120000 });

  let testZipCID: string | null = null;

  beforeAll(async () => {
    const helia = await createHelia();
    const fs = unixfs(helia);

    const zipBlob = await buildTestZip();
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
    const cid = await fs.addBytes(zipBytes);
    testZipCID = cid.toString();

    setHeliaForTest(helia);
  }, 60000);

  afterAll(async () => {
    clearHeliaTestInstance();
  });

  describe('Zip Pack Loading', () => {
    it('loads and extracts zip pack from embedded IPFS', async () => {
      expect(testZipCID).toBeTruthy();

      const progressUpdates: Array<{ loaded: number; total: number }> = [];
      const { loadZipPack } = await import('./zip-loader');

      const pack = await loadZipPack(
        { type: 'ipfs-zip', cid: testZipCID! },
        {},
        (loaded, total) => { progressUpdates.push({ loaded, total }); }
      );

      expect(pack).toBeDefined();
      expect(pack.manifest).toBeDefined();
      expect(pack.manifest.name).toBe('Test Card Pack');
      expect(pack.manifest.version).toBe('1.0.0');
      expect(pack.manifest.game).toBe('poker');
      expect(pack.manifest.cards.length).toBe(4);

      expect(progressUpdates.length).toBeGreaterThan(0);
      const last = progressUpdates[progressUpdates.length - 1];
      expect(last.loaded).toBe(last.total);

      const aceOfSpades = pack.manifest.cards.find((c) => c.id === 'spades-A');
      expect(aceOfSpades).toBeDefined();
      expect(aceOfSpades!.name).toBe('Ace of Spades');
      expect(aceOfSpades!.front).toContain('.png');
    });

    it('validates pack structure', async () => {
      expect(testZipCID).toBeTruthy();

      const { loadZipPack } = await import('./zip-loader');

      const pack = await loadZipPack(
        { type: 'ipfs-zip', cid: testZipCID! },
        {}
      );

      expect(pack.id).toContain('ipfs-zip:');
      expect(pack.manifest.cards.length).toBe(4);
      expect(pack.loadedAt).toBeGreaterThan(0);

      const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
      for (const suit of suits) {
        const suitCards = pack.manifest.cards.filter((c) => c.id.startsWith(suit));
        expect(suitCards.length).toBeGreaterThanOrEqual(1);
      }

      for (const card of pack.manifest.cards) {
        expect(card.front).toBeDefined();
        expect(card.front).toMatch(/\.png$/);
      }
    });
  });
});

describe('IPFS Asset Loading Structure', () => {
  it('exports loadAsset function', async () => {
    const { loadAsset: actualLoadAsset } = await import('../ipfs-loader');
    expect(typeof actualLoadAsset).toBe('function');
  });

  it('exports loadZipPack function', async () => {
    const { loadZipPack } = await import('./zip-loader');
    expect(typeof loadZipPack).toBe('function');
  });
});