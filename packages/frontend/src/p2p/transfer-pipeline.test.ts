import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CardManifestEntry } from '../assets/manifest/types';

// vi.hoisted runs before vi.mock hoisting — safe for shared state
const { imageStore, metadataStore, storeCardImageSpy, storePackMetadataSpy } = vi.hoisted(() => {
  const imageStore = new Map<string, Blob>();
  const metadataStore = new Map<string, unknown>();
  const storeCardImageSpy = vi.fn(async (packId: string, cardId: string, side: string, blob: Blob) => {
    imageStore.set(`${packId}:${cardId}:${side}`, blob);
  });
  const storePackMetadataSpy = vi.fn(async (meta: unknown) => {
    metadataStore.set((meta as any).id, meta);
  });
  return { imageStore, metadataStore, storeCardImageSpy, storePackMetadataSpy };
});

// Mock the cache module
vi.mock('../assets/loader/cache', () => ({
  getCardImage: vi.fn(async (packId: string, cardId: string, side: string) => {
    return imageStore.get(`${packId}:${cardId}:${side}`) ?? null;
  }),
  storeCardImage: storeCardImageSpy,
  storePackMetadata: storePackMetadataSpy,
  getPackZip: vi.fn(async () => null),
  storePackZip: vi.fn(async () => {}),
}));

// Import after mock setup
import { buildCardsOnlyBlob, unpackCardsOnlyBlob } from './transfer-pipeline';

// Helper to create a test image blob
function makeImageBlob(content: string): Blob {
  return new Blob([content], { type: 'image/png' });
}

const testCards: CardManifestEntry[] = [
  { id: 'card-1', name: 'Test Card 1', front: 'images/card1.png' },
  { id: 'card-2', name: 'Test Card 2', front: 'images/card2.png', back: 'images/card2-back.png' },
  { id: 'card-3', name: 'Test Card 3', front: 'images/card3.png' },
];

describe('buildCardsOnlyBlob', () => {
  beforeEach(() => {
    imageStore.clear();
    metadataStore.clear();
    storeCardImageSpy.mockClear();
    storePackMetadataSpy.mockClear();

    // Seed image cache
    imageStore.set('pack-1:card-1:front', makeImageBlob('IMG_CARD1_FRONT'));
    imageStore.set('pack-1:card-2:front', makeImageBlob('IMG_CARD2_FRONT'));
    imageStore.set('pack-1:card-2:back', makeImageBlob('IMG_CARD2_BACK'));
    imageStore.set('pack-1:card-3:front', makeImageBlob('IMG_CARD3_FRONT'));
  });

  it('builds blob from specified card IDs', async () => {
    const result = await buildCardsOnlyBlob(
      'pack-1',
      ['card-1', 'card-2'],
      testCards,
    );

    expect(result).not.toBeNull();
    expect(result!.cardCount).toBe(2);
    expect(result!.blob.size).toBeGreaterThan(0);
    expect(result!.header.cards).toHaveLength(2);
    expect(result!.header.cards[0].id).toBe('card-1');
    expect(result!.header.cards[1].id).toBe('card-2');
  });

  it('includes back images when present', async () => {
    const result = await buildCardsOnlyBlob(
      'pack-1',
      ['card-2'],
      testCards,
    );

    expect(result!.header.cards[0].backSize).not.toBeNull();
    expect(result!.header.cards[0].frontSize).toBeGreaterThan(0);
  });

  it('skips cards without cached images', async () => {
    const result = await buildCardsOnlyBlob(
      'pack-1',
      ['card-1', 'card-MISSING'],
      testCards,
    );

    expect(result!.cardCount).toBe(1);
    expect(result!.header.cards[0].id).toBe('card-1');
  });

  it('returns null when no cards have images', async () => {
    const result = await buildCardsOnlyBlob(
      'pack-1',
      ['card-MISSING'],
      testCards,
    );

    expect(result).toBeNull();
  });

  it('calls progress callback', async () => {
    const progress = vi.fn();
    await buildCardsOnlyBlob('pack-1', ['card-1', 'card-3'], testCards, progress);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(progress).toHaveBeenCalledWith(2, 2);
  });
});

describe('unpackCardsOnlyBlob', () => {
  beforeEach(() => {
    imageStore.clear();
    metadataStore.clear();
    storeCardImageSpy.mockClear();
    storePackMetadataSpy.mockClear();

    // Seed sender-side images
    imageStore.set('pack-1:card-1:front', makeImageBlob('IMG_CARD1_FRONT'));
    imageStore.set('pack-1:card-2:front', makeImageBlob('IMG_CARD2_FRONT'));
    imageStore.set('pack-1:card-2:back', makeImageBlob('IMG_CARD2_BACK'));
  });

  it('round-trips build → unpack correctly', async () => {
    // Build blob from sender
    const built = await buildCardsOnlyBlob(
      'pack-1',
      ['card-1', 'card-2'],
      testCards,
    );
    expect(built).not.toBeNull();

    storeCardImageSpy.mockClear();
    storePackMetadataSpy.mockClear();

    // Unpack on receiver side with different pack ID
    const { cardsStored, header } = await unpackCardsOnlyBlob(
      built!.blob,
      'p2p:received-pack',
    );

    expect(cardsStored).toBe(2);
    expect(header.cards).toHaveLength(2);

    // card-1: front only, card-2: front + back = 3 calls total
    expect(storeCardImageSpy).toHaveBeenCalledTimes(3);

    // Verify pack metadata was stored
    expect(storePackMetadataSpy).toHaveBeenCalledOnce();
    const meta = storePackMetadataSpy.mock.calls[0][0] as any;
    expect(meta.id).toBe('p2p:received-pack');
    expect(meta.cardCount).toBe(2);
    expect(meta.source.type).toBe('p2p');
  });

  it('calls progress callback during unpack', async () => {
    const built = await buildCardsOnlyBlob('pack-1', ['card-1', 'card-2'], testCards);

    storeCardImageSpy.mockClear();
    storePackMetadataSpy.mockClear();

    const progress = vi.fn();
    await unpackCardsOnlyBlob(built!.blob, 'target-pack', progress);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(progress).toHaveBeenCalledWith(2, 2);
  });

  it('preserves card metadata in stored pack', async () => {
    const built = await buildCardsOnlyBlob('pack-1', ['card-1'], testCards);

    storeCardImageSpy.mockClear();
    storePackMetadataSpy.mockClear();

    await unpackCardsOnlyBlob(built!.blob, 'target-pack');

    const meta = storePackMetadataSpy.mock.calls[0][0] as any;
    expect(meta.cards).toHaveLength(1);
    expect(meta.cards[0].id).toBe('card-1');
    expect(meta.cards[0].name).toBe('Test Card 1');
  });
});
