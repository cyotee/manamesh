/**
 * Asset Pack Cache
 *
 * Three separate IndexedDB stores for clean data separation:
 * - Pack metadata (name, game, card entries, etc.)
 * - Card images (individual front/back blobs)
 * - Pack zip archives (full zip blobs for offline reconstruction)
 */

import { get, set, del, createStore, UseStore } from 'idb-keyval';
import type {
  StoredPackMetadata,
  CacheStatus,
  AssetPackSource,
} from './types';
import { makeCardImageKey, sourceToPackId } from './types';

// Database names — each data type gets its own IndexedDB database
const PACK_DB_NAME = 'manamesh-asset-packs';
const PACK_STORE_NAME = 'packs';
const CARD_IMAGE_DB_NAME = 'manamesh-card-images';
const CARD_IMAGE_STORE_NAME = 'images';
const PACK_ZIP_DB_NAME = 'manamesh-pack-zips';
const PACK_ZIP_STORE_NAME = 'zips';

// Store instances
let packStore: UseStore;
let cardImageStore: UseStore;
let packZipStore: UseStore;

function initStores() {
  if (!packStore) {
    packStore = createStore(PACK_DB_NAME, PACK_STORE_NAME);
  }
  if (!cardImageStore) {
    cardImageStore = createStore(CARD_IMAGE_DB_NAME, CARD_IMAGE_STORE_NAME);
  }
  if (!packZipStore) {
    packZipStore = createStore(PACK_ZIP_DB_NAME, PACK_ZIP_STORE_NAME);
  }
}

// ============================================================================
// Pack Metadata
// ============================================================================

/**
 * Store pack metadata.
 */
export async function storePackMetadata(
  metadata: StoredPackMetadata
): Promise<void> {
  initStores();
  await set(metadata.id, metadata, packStore);
}

/**
 * Get pack metadata by ID.
 */
export async function getPackMetadata(
  packId: string
): Promise<StoredPackMetadata | null> {
  initStores();
  const metadata = await get<StoredPackMetadata>(packId, packStore);
  return metadata || null;
}

/**
 * Get all stored pack metadata.
 */
export async function getAllPackMetadata(): Promise<StoredPackMetadata[]> {
  initStores();
  const { entries } = await import('idb-keyval');
  const allEntries = await entries<string, StoredPackMetadata>(packStore);
  return allEntries.map(([, value]) => value);
}

/**
 * Delete pack metadata.
 */
export async function deletePackMetadata(packId: string): Promise<void> {
  initStores();
  await del(packId, packStore);
}

// ============================================================================
// Card Images
// ============================================================================

/**
 * Store a card image.
 */
export async function storeCardImage(
  packId: string,
  cardId: string,
  side: 'front' | 'back',
  blob: Blob
): Promise<void> {
  initStores();
  const key = makeCardImageKey(packId, cardId, side);
  await set(key, blob, cardImageStore);

  // Update pack metadata cached card list
  const metadata = await getPackMetadata(packId);
  if (metadata) {
    const cardKey = `${cardId}:${side}`;
    if (!metadata.cachedCardIds.includes(cardKey)) {
      metadata.cachedCardIds.push(cardKey);
      await storePackMetadata(metadata);
    }
  }
}

/**
 * Get a card image from cache.
 */
export async function getCardImage(
  packId: string,
  cardId: string,
  side: 'front' | 'back'
): Promise<Blob | null> {
  initStores();
  const key = makeCardImageKey(packId, cardId, side);
  const blob = await get<Blob>(key, cardImageStore);
  return blob || null;
}

/**
 * Check if a card image is cached.
 */
export async function isCardImageCached(
  packId: string,
  cardId: string,
  side: 'front' | 'back'
): Promise<boolean> {
  initStores();
  const key = makeCardImageKey(packId, cardId, side);
  const blob = await get<Blob>(key, cardImageStore);
  return blob !== undefined;
}

/**
 * Delete a specific card image.
 */
export async function deleteCardImage(
  packId: string,
  cardId: string,
  side: 'front' | 'back'
): Promise<void> {
  initStores();
  const key = makeCardImageKey(packId, cardId, side);
  await del(key, cardImageStore);

  // Update pack metadata
  const metadata = await getPackMetadata(packId);
  if (metadata) {
    const cardKey = `${cardId}:${side}`;
    const index = metadata.cachedCardIds.indexOf(cardKey);
    if (index !== -1) {
      metadata.cachedCardIds.splice(index, 1);
      await storePackMetadata(metadata);
    }
  }
}

// ============================================================================
// Pack Zip Archives
// ============================================================================

/**
 * Store a zip blob for an asset pack.
 * Stored in a dedicated database separate from pack metadata.
 */
export async function storePackZip(
  packId: string,
  zipBlob: Blob
): Promise<void> {
  initStores();
  await set(packId, zipBlob, packZipStore);
}

/**
 * Get a stored zip blob for an asset pack.
 */
export async function getPackZip(
  packId: string
): Promise<Blob | null> {
  initStores();
  const blob = await get<Blob>(packId, packZipStore);
  return blob || null;
}

/**
 * Delete a stored zip blob.
 */
export async function deletePackZip(packId: string): Promise<void> {
  initStores();
  await del(packId, packZipStore);
}

// ============================================================================
// Pack-Level Operations
// ============================================================================

/**
 * Get cache status for an asset pack.
 */
export async function getPackCacheStatus(
  packId: string,
  totalCards: number
): Promise<CacheStatus> {
  initStores();
  const metadata = await getPackMetadata(packId);

  if (!metadata) {
    return {
      totalCards,
      cachedCards: 0,
      sizeBytes: 0,
      isComplete: false,
    };
  }

  // Count unique cards (each card has front, optionally back)
  const uniqueCardIds = new Set(
    metadata.cachedCardIds.map((key) => key.split(':')[0])
  );

  // Estimate size by counting cached images
  // We'd need to iterate through images to get actual size, so this is an estimate
  const cachedCards = uniqueCardIds.size;
  const cachedImages = metadata.cachedCardIds.length;

  // Rough estimate: average card image is ~50KB
  const estimatedSizeBytes = cachedImages * 50 * 1024;

  return {
    totalCards,
    cachedCards,
    sizeBytes: estimatedSizeBytes,
    isComplete: cachedCards >= totalCards,
  };
}

/**
 * Clear all cached data for an asset pack (metadata, images, and zip).
 */
export async function clearPackCache(packId: string): Promise<void> {
  initStores();

  const metadata = await getPackMetadata(packId);
  if (metadata) {
    // Delete all cached card images
    for (const cardKey of metadata.cachedCardIds) {
      const [cardId, side] = cardKey.split(':');
      const key = makeCardImageKey(packId, cardId, side as 'front' | 'back');
      await del(key, cardImageStore);
    }

    // Delete pack metadata
    await deletePackMetadata(packId);
  }

  // Delete stored zip archive
  await deletePackZip(packId);
}

/**
 * Clear all asset pack caches.
 */
export async function clearAllPackCaches(): Promise<void> {
  initStores();

  const allPacks = await getAllPackMetadata();
  for (const pack of allPacks) {
    await clearPackCache(pack.id);
  }
}

/**
 * Get total cache size across all packs (estimated).
 */
export async function getTotalCacheSize(): Promise<{
  packs: number;
  images: number;
  estimatedBytes: number;
}> {
  const allPacks = await getAllPackMetadata();

  let totalImages = 0;
  for (const pack of allPacks) {
    totalImages += pack.cachedCardIds.length;
  }

  return {
    packs: allPacks.length,
    images: totalImages,
    estimatedBytes: totalImages * 50 * 1024, // ~50KB per image estimate
  };
}
