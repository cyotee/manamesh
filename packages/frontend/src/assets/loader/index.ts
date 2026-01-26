/**
 * Asset Pack Loader Module
 *
 * Exports the public API for loading and managing asset packs.
 */

// Types
export type {
  IPFSSource,
  HTTPSource,
  AssetPackSource,
  LoadedAssetPack,
  CacheStatus,
  ProgressCallback,
  LoadOptions,
  CardImageResult,
  StoredPackMetadata,
} from './types';
export { sourceToPackId, makeCardImageKey, parseCardImageKey } from './types';

// Loader functions
export {
  // Pack loading
  loadPack,
  getLoadedPack,
  getAllLoadedPacks,
  unloadPack,
  // Card image access
  getCardImageBlob,
  getCardImageUrl,
  isCardCached,
  // Preloading
  preloadPack,
  // Cache management
  getCacheStatus,
  clearCache,
  getStoredPacks,
} from './loader';

// Fetcher utilities
export { fetchText, fetchJson, fetchBlob, isSourceReachable } from './fetcher';
