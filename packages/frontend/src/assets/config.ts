/**
 * Configuration for IPFS asset loading
 * Allows users to customize gateway URLs and other settings
 */

// Storage key for persisted config
const CONFIG_STORAGE_KEY = 'manamesh-ipfs-config';

// Default gateway URLs (used as fallback if user config is empty)
// Ordered by reliability for large files
// Note: cloudflare-ipfs.com removed due to CORS issues
export const DEFAULT_GATEWAYS = [
  'https://w3s.link/ipfs/',           // web3.storage - good for large files
  'https://nftstorage.link/ipfs/',    // nft.storage - reliable
  'https://gateway.pinata.cloud/ipfs/', // Pinata - good availability
  'https://ipfs.io/ipfs/',            // Protocol Labs - can be slow
  'https://dweb.link/ipfs/',          // Protocol Labs alt
] as const;

// Configuration interface
export interface IPFSConfig {
  /** Custom gateway URLs (in priority order) */
  gateways: string[];
  /** Whether to use custom gateways before defaults */
  useCustomGatewaysFirst: boolean;
  /** Whether to include default gateways as fallback */
  includeDefaultGateways: boolean;
  /** Timeout in ms for gateway requests */
  gatewayTimeout: number;
  /** Timeout in ms for helia initialization */
  heliaInitTimeout: number;
  /** Timeout in ms for helia fetch operations */
  heliaFetchTimeout: number;
  /** Whether to prefer gateway over helia (useful if helia is slow) */
  preferGateway: boolean;
}

// Default configuration
const DEFAULT_CONFIG: IPFSConfig = {
  gateways: [],
  useCustomGatewaysFirst: true,
  includeDefaultGateways: true,
  gatewayTimeout: 120000, // 2 minutes - needed for large files (13MB+)
  heliaInitTimeout: 10000,
  heliaFetchTimeout: 30000,
  preferGateway: true, // Prefer gateway by default (Helia has issues with some content types)
};

// In-memory config cache
let cachedConfig: IPFSConfig | null = null;

/**
 * Load config from localStorage
 */
function loadFromStorage(): Partial<IPFSConfig> {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to load IPFS config from storage:', error);
  }
  return {};
}

/**
 * Save config to localStorage
 */
function saveToStorage(config: IPFSConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('Failed to save IPFS config to storage:', error);
  }
}

/**
 * Get the current IPFS configuration
 */
export function getConfig(): IPFSConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const stored = loadFromStorage();
  cachedConfig = { ...DEFAULT_CONFIG, ...stored };
  return cachedConfig;
}

/**
 * Update the IPFS configuration
 */
export function setConfig(updates: Partial<IPFSConfig>): IPFSConfig {
  const current = getConfig();
  cachedConfig = { ...current, ...updates };
  saveToStorage(cachedConfig);
  return cachedConfig;
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): IPFSConfig {
  cachedConfig = { ...DEFAULT_CONFIG };
  saveToStorage(cachedConfig);
  return cachedConfig;
}

/**
 * Get the effective list of gateway URLs to use
 * Combines custom and default gateways based on config
 */
export function getEffectiveGateways(): string[] {
  const config = getConfig();
  const gateways: string[] = [];

  if (config.useCustomGatewaysFirst) {
    // Custom gateways first, then defaults
    gateways.push(...config.gateways);
    if (config.includeDefaultGateways) {
      // Add defaults that aren't already in the list
      for (const defaultGw of DEFAULT_GATEWAYS) {
        if (!gateways.includes(defaultGw)) {
          gateways.push(defaultGw);
        }
      }
    }
  } else {
    // Defaults first, then custom
    if (config.includeDefaultGateways) {
      gateways.push(...DEFAULT_GATEWAYS);
    }
    // Add custom gateways that aren't already in the list
    for (const customGw of config.gateways) {
      if (!gateways.includes(customGw)) {
        gateways.push(customGw);
      }
    }
  }

  // If no gateways at all, use defaults
  if (gateways.length === 0) {
    return [...DEFAULT_GATEWAYS];
  }

  return gateways;
}

/**
 * Add a custom gateway URL
 * @param url - Gateway URL (should end with /ipfs/ or will be normalized)
 * @param position - Optional position to insert at (default: end)
 */
export function addGateway(url: string, position?: number): IPFSConfig {
  const config = getConfig();

  // Normalize URL to end with /ipfs/
  let normalizedUrl = url.trim();
  if (!normalizedUrl.endsWith('/')) {
    normalizedUrl += '/';
  }
  if (!normalizedUrl.endsWith('/ipfs/')) {
    normalizedUrl += 'ipfs/';
  }

  // Don't add duplicates
  if (config.gateways.includes(normalizedUrl)) {
    return config;
  }

  const newGateways = [...config.gateways];
  if (position !== undefined && position >= 0 && position <= newGateways.length) {
    newGateways.splice(position, 0, normalizedUrl);
  } else {
    newGateways.push(normalizedUrl);
  }

  return setConfig({ gateways: newGateways });
}

/**
 * Remove a custom gateway URL
 */
export function removeGateway(url: string): IPFSConfig {
  const config = getConfig();
  const newGateways = config.gateways.filter(gw => gw !== url);
  return setConfig({ gateways: newGateways });
}

/**
 * Reorder custom gateways
 */
export function setGatewayOrder(gateways: string[]): IPFSConfig {
  return setConfig({ gateways });
}

/**
 * Test if a gateway URL is reachable
 * Uses a known CID (IPFS logo) to test connectivity
 */
export async function testGateway(
  gatewayUrl: string,
  timeout: number = 5000
): Promise<{ success: boolean; latency?: number; error?: string }> {
  // Test CID - IPFS logo (small PNG)
  const testCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const startTime = Date.now();

  try {
    // Normalize URL
    let url = gatewayUrl.trim();
    if (!url.endsWith('/')) url += '/';
    if (!url.endsWith('/ipfs/')) url += 'ipfs/';

    const response = await fetch(`${url}${testCid}`, {
      method: 'HEAD', // Just check headers, don't download
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    if (response.ok) {
      return { success: true, latency };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Test all configured gateways and return results
 */
export async function testAllGateways(
  timeout: number = 5000
): Promise<Map<string, { success: boolean; latency?: number; error?: string }>> {
  const gateways = getEffectiveGateways();
  const results = new Map<string, { success: boolean; latency?: number; error?: string }>();

  await Promise.all(
    gateways.map(async (gateway) => {
      const result = await testGateway(gateway, timeout);
      results.set(gateway, result);
    })
  );

  return results;
}
