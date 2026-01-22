/**
 * IPFS asset loader using helia with gateway fallback
 * Integrates with IndexedDB cache for offline support
 * Gateway URLs are configurable via the config module
 */

import { createHelia, Helia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { CID } from 'multiformats/cid';
import { getFromCache, putInCache, isInCache } from './cache';
import { getConfig, getEffectiveGateways } from './config';

// Types
export interface LoadOptions {
  useCache?: boolean;
  preferGateway?: boolean;
  timeout?: number;
}

export interface LoadResult {
  blob: Blob;
  source: 'cache' | 'helia' | 'gateway';
}

export type LoadProgress = {
  status: 'loading' | 'cached' | 'complete' | 'error';
  source?: 'cache' | 'helia' | 'gateway';
  error?: Error;
};

// Singleton helia instance
let heliaInstance: Helia | null = null;
let heliaInitPromise: Promise<Helia> | null = null;
let heliaFailed = false;

/**
 * Initialize or get the helia instance
 * Returns null if initialization fails (fallback to gateway)
 */
async function getHelia(): Promise<Helia | null> {
  if (heliaFailed) {
    return null;
  }

  if (heliaInstance) {
    return heliaInstance;
  }

  if (heliaInitPromise) {
    return heliaInitPromise;
  }

  const config = getConfig();

  heliaInitPromise = (async () => {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Helia init timeout')), config.heliaInitTimeout);
      });

      const initPromise = createHelia();
      heliaInstance = await Promise.race([initPromise, timeoutPromise]);
      return heliaInstance;
    } catch (error) {
      console.warn('Failed to initialize helia, falling back to gateway:', error);
      heliaFailed = true;
      heliaInitPromise = null;
      return null;
    }
  })();

  return heliaInitPromise;
}

/**
 * Fetch content from helia by CID
 */
async function fetchFromHelia(cidString: string, timeout: number): Promise<Blob | null> {
  const helia = await getHelia();
  if (!helia) {
    return null;
  }

  try {
    const fs = unixfs(helia);
    const cid = CID.parse(cidString);

    const chunks: Uint8Array[] = [];
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Helia fetch timeout')), timeout);
    });

    const fetchPromise = (async () => {
      for await (const chunk of fs.cat(cid)) {
        chunks.push(chunk);
      }
      return new Blob(chunks);
    })();

    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    console.warn('Helia fetch failed:', error);
    return null;
  }
}

/**
 * Fetch content from IPFS gateway by CID
 * Uses configurable gateway list from config module
 *
 * Each gateway attempt uses a fresh AbortController to ensure
 * a timeout on one gateway doesn't prevent trying others.
 */
async function fetchFromGateway(
  cidString: string,
  timeout: number
): Promise<{ blob: Blob; gateway: string } | null> {
  const gateways = getEffectiveGateways();

  for (const gateway of gateways) {
    // Create fresh AbortController for each gateway attempt
    // This prevents a timeout on one gateway from blocking subsequent attempts
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${gateway}${cidString}`, {
        signal: controller.signal,
      });

      if (response.ok) {
        clearTimeout(timeoutId);
        const blob = await response.blob();
        return { blob, gateway };
      }
      // Response not ok, clear timeout and try next gateway
      clearTimeout(timeoutId);
    } catch (error) {
      // Clear timeout and try next gateway
      clearTimeout(timeoutId);
      continue;
    }
  }

  return null;
}

/**
 * Load an asset by CID
 * Checks cache first, then tries helia, then falls back to gateway
 */
export async function loadAsset(
  cid: string,
  options: LoadOptions = {}
): Promise<LoadResult> {
  const config = getConfig();
  const {
    useCache = true,
    preferGateway = config.preferGateway,
    timeout = config.gatewayTimeout,
  } = options;

  // Check cache first
  if (useCache) {
    const cached = await getFromCache(cid);
    if (cached) {
      return { blob: cached, source: 'cache' };
    }
  }

  let blob: Blob | null = null;
  let source: 'helia' | 'gateway' = 'gateway';

  if (preferGateway) {
    // Try gateway first
    const gatewayResult = await fetchFromGateway(cid, timeout);
    if (gatewayResult) {
      blob = gatewayResult.blob;
      source = 'gateway';
    } else {
      // Fallback to helia
      blob = await fetchFromHelia(cid, timeout);
      if (blob) source = 'helia';
    }
  } else {
    // Try helia first
    blob = await fetchFromHelia(cid, timeout);
    if (blob) {
      source = 'helia';
    } else {
      // Fallback to gateway
      const gatewayResult = await fetchFromGateway(cid, timeout);
      if (gatewayResult) {
        blob = gatewayResult.blob;
        source = 'gateway';
      }
    }
  }

  if (!blob) {
    throw new Error(`Failed to load asset: ${cid}`);
  }

  // Cache the result
  if (useCache) {
    await putInCache(cid, blob);
  }

  return { blob, source };
}

/**
 * Load an asset and return as object URL
 * Caller is responsible for revoking the URL when done
 */
export async function loadAssetUrl(
  cid: string,
  options: LoadOptions = {}
): Promise<{ url: string; source: LoadResult['source'] }> {
  const result = await loadAsset(cid, options);
  return {
    url: URL.createObjectURL(result.blob),
    source: result.source,
  };
}

/**
 * Preload multiple assets in parallel
 * Returns progress information for UI updates
 */
export async function preloadAssets(
  cids: string[],
  options: LoadOptions = {},
  onProgress?: (loaded: number, total: number, current: string) => void
): Promise<Map<string, LoadResult | Error>> {
  const results = new Map<string, LoadResult | Error>();
  let loaded = 0;
  const total = cids.length;

  // Process in batches to avoid overwhelming the network
  const BATCH_SIZE = 5;
  for (let i = 0; i < cids.length; i += BATCH_SIZE) {
    const batch = cids.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (cid) => {
      try {
        onProgress?.(loaded, total, cid);
        const result = await loadAsset(cid, options);
        results.set(cid, result);
      } catch (error) {
        results.set(cid, error instanceof Error ? error : new Error(String(error)));
      } finally {
        loaded++;
        onProgress?.(loaded, total, cid);
      }
    });

    await Promise.all(batchPromises);
  }

  return results;
}

/**
 * Check if an asset is available (cached or can be loaded)
 */
export async function isAssetAvailable(cid: string): Promise<boolean> {
  // Check cache first
  if (await isInCache(cid)) {
    return true;
  }

  // Try to fetch with a short timeout
  try {
    await loadAsset(cid, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shutdown helia instance
 * Call when the app is closing or no longer needs IPFS
 */
export async function shutdownHelia(): Promise<void> {
  if (heliaInstance) {
    await heliaInstance.stop();
    heliaInstance = null;
  }
  heliaInitPromise = null;
  heliaFailed = false;
}
