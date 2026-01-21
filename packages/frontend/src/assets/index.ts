/**
 * Public API for IPFS asset loading and caching
 */

// IPFS Loader
export {
  loadAsset,
  loadAssetUrl,
  preloadAssets,
  isAssetAvailable,
  shutdownHelia,
  type LoadOptions,
  type LoadResult,
  type LoadProgress,
} from './ipfs-loader';

// Cache
export {
  getFromCache,
  putInCache,
  isInCache,
  removeFromCache,
  getCacheStats,
  clearCache,
  getCachedCids,
} from './cache';

// Configuration
export {
  // Config getters/setters
  getConfig,
  setConfig,
  resetConfig,
  // Gateway management
  getEffectiveGateways,
  addGateway,
  removeGateway,
  setGatewayOrder,
  // Gateway testing
  testGateway,
  testAllGateways,
  // Constants
  DEFAULT_GATEWAYS,
  // Types
  type IPFSConfig,
} from './config';
