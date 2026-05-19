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
  /** @deprecated Use heliaTimeout and gatewayTimeout instead */
  timeout?: number;
  /** Timeout in ms for helia fetch operations (default: config.heliaFetchTimeout) */
  heliaTimeout?: number;
  /** Timeout in ms for gateway fetch operations (default: config.gatewayTimeout) */
  gatewayTimeout?: number;
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
let heliaInitPromise: Promise<Helia | null> | null = null;
let heliaFailed = false;

// Test Helia instance - used for testing to inject a pre-configured Helia
let testHeliaInstance: Helia | null = null;

/**
 * Set a Helia instance to use for testing
 * This overrides the normal singleton initialization
 * @internal For testing only
 */
export function setHeliaForTest(helia: Helia): void {
  testHeliaInstance = helia;
}

/**
 * Clear any test Helia instance
 * @internal For testing only
 */
export function clearHeliaTestInstance(): void {
  testHeliaInstance = null;
}

/**
 * Initialize or get the helia instance
 * Returns null if initialization fails (fallback to gateway)
 */
async function getHelia(): Promise<Helia | null> {
  if (heliaFailed) {
    return null;
  }

  if (testHeliaInstance) {
    return testHeliaInstance;
  }

  if (heliaInstance) {
    return heliaInstance;
  }

  if (heliaInitPromise) {
    return heliaInitPromise;
  }

  const config = getConfig();

  heliaInitPromise = (async () => {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Helia init timeout')), config.heliaInitTimeout);
    });

    try {
      const initPromise = createHelia();
      heliaInstance = await Promise.race([initPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      return heliaInstance;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('Failed to initialize helia, falling back to gateway:', error);
      heliaFailed = true;
      heliaInitPromise = null;
      return null;
    }
  })();

  return heliaInitPromise;
}

/**
 * Fetch content from helia by CID (optionally with a sub-path for UnixFS files).
 * cidString may be a bare CID or "CID/sub/path" — the slash is split before parsing.
 * @internal Exported for testing only.
 */
export async function fetchFromHelia(cidString: string, timeout: number): Promise<Blob | null> {
  const helia = await getHelia();
  if (!helia) {
    return null;
  }

  // Split a path suffix from the CID string so CID.parse receives only the bare CID.
  // Gateway URLs tolerate "CID/path" directly, but CID.parse does not.
  const slashIndex = cidString.indexOf('/');
  const bareCidString = slashIndex === -1 ? cidString : cidString.slice(0, slashIndex);
  const subPath = slashIndex === -1 ? undefined : cidString.slice(slashIndex + 1);

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Helia fetch timeout')), timeout);
  });

  try {
    const cid = CID.parse(bareCidString);
    let result: Blob;

    if (subPath) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = unixfs(helia as any);
      const fetchPromise = (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of fs.cat(cid, { path: subPath })) {
          chunks.push(chunk);
        }
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        return new Blob([combined]);
      })();
      result = await Promise.race([fetchPromise, timeoutPromise]);
    } else {
      // Use new Uint8Array(block) to guarantee a plain ArrayBuffer type for the Blob constructor.
      const block = await Promise.race([helia.blockstore.get(cid), timeoutPromise]);
      result = new Blob([new Uint8Array(block)]);
    }

    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
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

  // Filter out localhost gateways which may be offline
  const filteredGateways = gateways.filter(gw => !gw.includes('localhost') && !gw.includes('127.0.0.1'));

  console.log('[IPFS] All configured gateways:', gateways);
  console.log('[IPFS] Using gateways (excluding localhost):', filteredGateways);

  const gatewaysToUse = filteredGateways.length > 0 ? filteredGateways : gateways;

  for (const gateway of gatewaysToUse) {
    // Create fresh AbortController for each gateway attempt
    // This prevents a timeout on one gateway from blocking subsequent attempts
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const url = `${gateway}${cidString}`;
      console.log('[IPFS] Fetching from gateway:', url, 'timeout:', timeout);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/octet-stream, application/zip, */*',
        },
        // Follow redirects (default, but explicit)
        redirect: 'follow',
      });

      console.log('[IPFS] Gateway response:', gateway, response.status, response.statusText);

      if (response.ok) {
        clearTimeout(timeoutId);
        const blob = await response.blob();
        console.log('[IPFS] Successfully loaded from gateway:', gateway, 'size:', blob.size);
        return { blob, gateway };
      }
      // Response not ok, clear timeout and try next gateway
      clearTimeout(timeoutId);
    } catch (error) {
      // Clear timeout and try next gateway
      clearTimeout(timeoutId);
      console.warn('[IPFS] Gateway fetch failed:', gateway, error);
      continue;
    }
  }

  console.error('[IPFS] All gateways failed for CID:', cidString);
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
  console.log('[loadAsset] Starting load for CID:', cid);
  console.log('[loadAsset] Config:', JSON.stringify(config));
  console.log('[loadAsset] Options:', JSON.stringify(options));
  const {
    useCache = true,
    preferGateway = config.preferGateway,
    timeout,
    heliaTimeout = timeout ?? config.heliaFetchTimeout,
    gatewayTimeout = timeout ?? config.gatewayTimeout,
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

  console.log('[loadAsset] preferGateway:', preferGateway, 'gatewayTimeout:', gatewayTimeout, 'heliaTimeout:', heliaTimeout);

  if (preferGateway) {
    // Try gateway first
    console.log('[loadAsset] Taking GATEWAY-FIRST path');
    const gatewayResult = await fetchFromGateway(cid, gatewayTimeout);
    if (gatewayResult) {
      blob = gatewayResult.blob;
      source = 'gateway';
    } else {
      // Fallback to helia
      blob = await fetchFromHelia(cid, heliaTimeout);
      if (blob) source = 'helia';
    }
  } else {
    // Try helia first
    console.log('[loadAsset] Taking HELIA-FIRST path');
    blob = await fetchFromHelia(cid, heliaTimeout);
    if (blob) {
      source = 'helia';
    } else {
      // Fallback to gateway
      const gatewayResult = await fetchFromGateway(cid, gatewayTimeout);
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

  // Try to fetch with short timeouts
  try {
    await loadAsset(cid, { heliaTimeout: 5000, gatewayTimeout: 5000 });
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
