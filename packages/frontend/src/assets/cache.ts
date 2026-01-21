/**
 * IndexedDB-based asset cache using idb-keyval
 * Stores IPFS assets with LRU eviction for ~100MB quota management
 */

import { get, set, del, keys, createStore, UseStore } from 'idb-keyval';

// Constants
const CACHE_DB_NAME = 'manamesh-asset-cache';
const CACHE_STORE_NAME = 'assets';
const METADATA_STORE_NAME = 'metadata';
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const METADATA_KEY = 'cache-metadata';

// Types
export interface CacheEntry {
  cid: string;
  blob: Blob;
  size: number;
  lastAccessed: number;
}

interface CacheMetadata {
  totalSize: number;
  entries: { cid: string; size: number; lastAccessed: number }[];
}

// Create separate stores for assets and metadata
let assetStore: UseStore;
let metadataStore: UseStore;

function initStores() {
  if (!assetStore) {
    assetStore = createStore(CACHE_DB_NAME, CACHE_STORE_NAME);
  }
  if (!metadataStore) {
    metadataStore = createStore(`${CACHE_DB_NAME}-meta`, METADATA_STORE_NAME);
  }
}

async function getMetadata(): Promise<CacheMetadata> {
  initStores();
  const metadata = await get<CacheMetadata>(METADATA_KEY, metadataStore);
  return metadata || { totalSize: 0, entries: [] };
}

async function setMetadata(metadata: CacheMetadata): Promise<void> {
  initStores();
  await set(METADATA_KEY, metadata, metadataStore);
}

/**
 * Get an asset from cache by CID
 * Updates last accessed time for LRU tracking
 */
export async function getFromCache(cid: string): Promise<Blob | null> {
  initStores();

  const blob = await get<Blob>(cid, assetStore);
  if (!blob) {
    return null;
  }

  // Update last accessed time
  const metadata = await getMetadata();
  const entry = metadata.entries.find(e => e.cid === cid);
  if (entry) {
    entry.lastAccessed = Date.now();
    await setMetadata(metadata);
  }

  return blob;
}

/**
 * Store an asset in cache by CID
 * Performs LRU eviction if cache exceeds quota
 */
export async function putInCache(cid: string, blob: Blob): Promise<void> {
  initStores();

  const size = blob.size;
  const metadata = await getMetadata();

  // Check if already cached (idempotent)
  const existing = metadata.entries.find(e => e.cid === cid);
  if (existing) {
    existing.lastAccessed = Date.now();
    await setMetadata(metadata);
    return;
  }

  // Evict if necessary to make room
  let currentSize = metadata.totalSize;
  while (currentSize + size > MAX_CACHE_SIZE_BYTES && metadata.entries.length > 0) {
    // Sort by last accessed (oldest first) and remove
    metadata.entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    const oldest = metadata.entries.shift();
    if (oldest) {
      await del(oldest.cid, assetStore);
      currentSize -= oldest.size;
    }
  }

  // Store the new asset
  await set(cid, blob, assetStore);

  // Update metadata
  metadata.entries.push({
    cid,
    size,
    lastAccessed: Date.now(),
  });
  metadata.totalSize = currentSize + size;
  await setMetadata(metadata);
}

/**
 * Check if a CID is cached without retrieving it
 */
export async function isInCache(cid: string): Promise<boolean> {
  initStores();
  const metadata = await getMetadata();
  return metadata.entries.some(e => e.cid === cid);
}

/**
 * Remove an asset from cache by CID
 */
export async function removeFromCache(cid: string): Promise<void> {
  initStores();

  await del(cid, assetStore);

  const metadata = await getMetadata();
  const index = metadata.entries.findIndex(e => e.cid === cid);
  if (index !== -1) {
    const entry = metadata.entries[index];
    metadata.totalSize -= entry.size;
    metadata.entries.splice(index, 1);
    await setMetadata(metadata);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalSize: number;
  maxSize: number;
  entryCount: number;
  usagePercent: number;
}> {
  const metadata = await getMetadata();
  return {
    totalSize: metadata.totalSize,
    maxSize: MAX_CACHE_SIZE_BYTES,
    entryCount: metadata.entries.length,
    usagePercent: (metadata.totalSize / MAX_CACHE_SIZE_BYTES) * 100,
  };
}

/**
 * Clear the entire cache
 */
export async function clearCache(): Promise<void> {
  initStores();

  const metadata = await getMetadata();
  for (const entry of metadata.entries) {
    await del(entry.cid, assetStore);
  }
  await setMetadata({ totalSize: 0, entries: [] });
}

/**
 * Get all cached CIDs
 */
export async function getCachedCids(): Promise<string[]> {
  const metadata = await getMetadata();
  return metadata.entries.map(e => e.cid);
}
