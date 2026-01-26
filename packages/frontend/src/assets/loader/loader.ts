/**
 * Asset Pack Loader
 *
 * Main entry point for loading and managing asset packs.
 * Provides lazy loading of card images with automatic caching.
 */

import {
  parseManifest,
  resolveNestedManifests,
  type AssetPackManifest,
  type CardManifestEntry,
} from '../manifest';
import { fetchJson, fetchBlob } from './fetcher';
import {
  storePackMetadata,
  getPackMetadata,
  getAllPackMetadata,
  getCardImage,
  storeCardImage,
  isCardImageCached,
  getPackCacheStatus,
  clearPackCache,
  clearAllPackCaches,
} from './cache';
import type {
  AssetPackSource,
  LoadedAssetPack,
  LoadOptions,
  ProgressCallback,
  CacheStatus,
  CardImageResult,
  StoredPackMetadata,
} from './types';
import { sourceToPackId } from './types';

// In-memory cache of loaded packs
const loadedPacks = new Map<string, LoadedAssetPack>();

// Default placeholder image (1x1 transparent PNG)
const PLACEHOLDER_BLOB = new Blob(
  [
    Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      ),
      (c) => c.charCodeAt(0)
    ),
  ],
  { type: 'image/png' }
);

// ============================================================================
// Pack Loading
// ============================================================================

/**
 * Load an asset pack from IPFS or HTTP source.
 *
 * This loads the manifest and resolves all nested manifests into a flat
 * card list. Card images are NOT loaded at this point (lazy loading).
 *
 * @param source - IPFS CID or HTTP URL source
 * @param options - Load options
 * @returns Loaded asset pack with manifest and card list
 */
export async function loadPack(
  source: AssetPackSource,
  options: LoadOptions = {}
): Promise<LoadedAssetPack> {
  const packId = sourceToPackId(source);

  // Check if already loaded
  const existing = loadedPacks.get(packId);
  if (existing) {
    return existing;
  }

  // Fetch and parse manifest
  const manifestJson = await fetchJson(source, 'manifest.json', options);
  const parseResult = parseManifest(manifestJson);

  if (!parseResult.ok) {
    const errorMessages = parseResult.errors
      .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
      .join('; ');
    throw new Error(`Invalid manifest: ${errorMessages}`);
  }

  const manifest = parseResult.value;

  // Create loader function for nested manifests
  const loader = async (path: string): Promise<unknown> => {
    return fetchJson(source, path, options);
  };

  // Resolve all nested manifests into flat card list
  const cards = await resolveNestedManifests(manifest, loader);

  const loadedPack: LoadedAssetPack = {
    id: packId,
    manifest,
    cards,
    source,
    loadedAt: Date.now(),
  };

  // Store in memory cache
  loadedPacks.set(packId, loadedPack);

  // Store metadata in IndexedDB
  const metadata: StoredPackMetadata = {
    id: packId,
    name: manifest.name,
    game: manifest.game,
    version: manifest.version,
    source,
    cardCount: cards.length,
    cachedCardIds: [],
    loadedAt: loadedPack.loadedAt,
  };

  // Try to preserve existing cached card IDs
  const existingMetadata = await getPackMetadata(packId);
  if (existingMetadata) {
    metadata.cachedCardIds = existingMetadata.cachedCardIds;
  }

  await storePackMetadata(metadata);

  return loadedPack;
}

/**
 * Get a loaded pack by ID (from memory cache).
 */
export function getLoadedPack(packId: string): LoadedAssetPack | undefined {
  return loadedPacks.get(packId);
}

/**
 * Get all loaded packs.
 */
export function getAllLoadedPacks(): LoadedAssetPack[] {
  return Array.from(loadedPacks.values());
}

/**
 * Unload a pack from memory (does not clear cache).
 */
export function unloadPack(packId: string): void {
  loadedPacks.delete(packId);
}

// ============================================================================
// Card Image Access
// ============================================================================

/**
 * Get a card image by ID.
 *
 * This is the main API for accessing card images. It:
 * 1. Checks IndexedDB cache first
 * 2. If not cached, fetches from source and caches
 * 3. Returns a placeholder if the card doesn't exist
 *
 * @param packId - The asset pack ID
 * @param cardId - The card ID within the pack
 * @param side - 'front' or 'back'
 * @param options - Load options
 * @returns Card image result with blob and cache status
 */
export async function getCardImageBlob(
  packId: string,
  cardId: string,
  side: 'front' | 'back' = 'front',
  options: LoadOptions = {}
): Promise<CardImageResult> {
  // Check cache first
  const cached = await getCardImage(packId, cardId, side);
  if (cached) {
    return { blob: cached, fromCache: true };
  }

  // Need to fetch - get pack info
  const pack = loadedPacks.get(packId);
  if (!pack) {
    console.warn(`Pack ${packId} not loaded, returning placeholder`);
    return { blob: PLACEHOLDER_BLOB, fromCache: false };
  }

  // Find the card
  const card = pack.cards.find((c) => c.id === cardId);
  if (!card) {
    console.warn(`Card ${cardId} not found in pack ${packId}`);
    return { blob: PLACEHOLDER_BLOB, fromCache: false };
  }

  // Get the image path
  const imagePath = side === 'front' ? card.front : card.back;
  if (!imagePath) {
    // No back image for this card, return placeholder
    return { blob: PLACEHOLDER_BLOB, fromCache: false };
  }

  try {
    // Fetch the image
    const blob = await fetchBlob(pack.source, imagePath, options);

    // Cache if enabled
    if (options.useCache !== false) {
      await storeCardImage(packId, cardId, side, blob);
    }

    return { blob, fromCache: false };
  } catch (error) {
    console.warn(`Failed to fetch card image ${cardId}:${side}:`, error);
    return { blob: PLACEHOLDER_BLOB, fromCache: false };
  }
}

/**
 * Get a card image as an object URL.
 * Caller is responsible for revoking the URL when done.
 */
export async function getCardImageUrl(
  packId: string,
  cardId: string,
  side: 'front' | 'back' = 'front',
  options: LoadOptions = {}
): Promise<string> {
  const result = await getCardImageBlob(packId, cardId, side, options);
  return URL.createObjectURL(result.blob);
}

/**
 * Check if a card image is cached.
 */
export async function isCardCached(
  packId: string,
  cardId: string,
  side: 'front' | 'back' = 'front'
): Promise<boolean> {
  return isCardImageCached(packId, cardId, side);
}

// ============================================================================
// Preloading
// ============================================================================

/**
 * Preload all card images for offline play.
 *
 * This fetches and caches all card images in the pack.
 * Progress callbacks are provided for UI updates.
 *
 * @param packId - The asset pack ID
 * @param onProgress - Optional progress callback
 * @param options - Load options
 */
export async function preloadPack(
  packId: string,
  onProgress?: ProgressCallback,
  options: LoadOptions = {}
): Promise<void> {
  const pack = loadedPacks.get(packId);
  if (!pack) {
    throw new Error(`Pack ${packId} not loaded`);
  }

  // Build list of all images to fetch
  const imagesToFetch: { cardId: string; side: 'front' | 'back' }[] = [];

  for (const card of pack.cards) {
    imagesToFetch.push({ cardId: card.id, side: 'front' });
    if (card.back) {
      imagesToFetch.push({ cardId: card.id, side: 'back' });
    }
  }

  const total = imagesToFetch.length;
  let loaded = 0;

  // Process in batches to avoid overwhelming the network
  const BATCH_SIZE = 5;
  for (let i = 0; i < imagesToFetch.length; i += BATCH_SIZE) {
    const batch = imagesToFetch.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async ({ cardId, side }) => {
        // Skip if already cached
        const isCached = await isCardImageCached(packId, cardId, side);
        if (!isCached) {
          await getCardImageBlob(packId, cardId, side, options);
        }
        loaded++;
        onProgress?.(loaded, total);
      })
    );
  }
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Get cache status for an asset pack.
 */
export async function getCacheStatus(packId: string): Promise<CacheStatus> {
  const pack = loadedPacks.get(packId);
  const totalCards = pack?.cards.length ?? 0;
  return getPackCacheStatus(packId, totalCards);
}

/**
 * Clear cache for a specific pack or all packs.
 */
export async function clearCache(packId?: string): Promise<void> {
  if (packId) {
    await clearPackCache(packId);
  } else {
    await clearAllPackCaches();
  }
}

/**
 * Get list of all stored pack metadata.
 */
export async function getStoredPacks(): Promise<StoredPackMetadata[]> {
  return getAllPackMetadata();
}
