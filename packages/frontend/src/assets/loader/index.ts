/**
 * Asset Pack Loader Module
 *
 * Exports the public API for loading and managing asset packs.
 */

// Types
export type {
  IPFSSource,
  HTTPSource,
  IPFSZipSource,
  LocalSource,
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

// Zip loader
export {
  loadZipPack,
  getZipLoadedPack,
  unloadZipPack,
  getAllZipLoadedPacks,
} from './zip-loader';

// Zip extractor utilities
export {
  extractZip,
  decodeTextEntry,
  entryToBlob,
  inferMimeType,
} from './zip-extractor';

// Local loader (directory/zip upload)
export {
  loadLocalZip,
  loadLocalDirectory,
  reloadLocalPack,
} from './local-loader';
