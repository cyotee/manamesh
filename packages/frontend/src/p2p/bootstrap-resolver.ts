/**
 * Bootstrap Resolver
 *
 * Resolves libp2p bootstrap nodes from multiple sources in priority order:
 * 1. localStorage cache (24hr TTL) — fastest, no network call
 * 2. ENS text record "manamesh.nodes.eth" → "bootstrap"
 * 3. Hardcoded Protocol Labs bootstrap nodes — always works
 *
 * This is game-agnostic — any game module can use MatchmakingService
 * which uses these bootstrap nodes.
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const ENS_NAME = 'manamesh.nodes.eth';
const CACHE_KEY = 'manamesh_bootstrap_nodes';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Hardcoded fallback — Protocol Labs bootstrap nodes, always available

export const HARDCODE_D_BOOTSTRAP_NODES: string[] = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

let cachedBootstrapNodes: string[] | null = null;

interface CacheEntry {
  nodes: string[];
  timestamp: number;
}

function getFromCache(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    if (!Array.isArray(entry.nodes) || entry.nodes.length === 0) return null;
    return entry.nodes;
  } catch {
    return null;
  }
}

function saveToCache(nodes: string[]): void {
  try {
    const entry: CacheEntry = { nodes, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage unavailable — ignore
  }
}

async function resolveFromEns(): Promise<string[]> {
  const alchemyKey = import.meta.env.VITE_ALCHEMY_KEY;

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: alchemyKey
      ? http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`)
      : http(),
  });

  const resolver = await publicClient.getResolver({ name: ENS_NAME });
  if (!resolver) {
    throw new Error(`ENS name ${ENS_NAME} has no resolver`);
  }

  const bootstrapText = await publicClient.getEnsText({
    name: ENS_NAME,
    key: 'bootstrap',
  });

  if (!bootstrapText) {
    throw new Error(`ENS name ${ENS_NAME} has no "bootstrap" text record`);
  }

  const nodes = JSON.parse(bootstrapText) as string[];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error(`ENS "bootstrap" text record is empty`);
  }

  return nodes;
}

/**
 * Get libp2p bootstrap nodes.
 *
 * Resolution order:
 * 1. In-memory cache (fastest)
 * 2. localStorage cache (24hr TTL)
 * 3. ENS text record "manamesh.nodes.eth"
 * 4. Hardcoded Protocol Labs nodes (always works)
 *
 * Returns a readonly array. Do not mutate.
 */
export async function resolveBootstrapNodes(): Promise<readonly string[]> {
  // 1. In-memory cache
  if (cachedBootstrapNodes) {
    return cachedBootstrapNodes;
  }

  // 2. localStorage cache
  const fromCache = getFromCache();
  if (fromCache) {
    cachedBootstrapNodes = fromCache;
    return cachedBootstrapNodes;
  }

  // 3. ENS
  try {
    const fromEns = await resolveFromEns();
    cachedBootstrapNodes = fromEns;
    saveToCache(fromEns);
    return cachedBootstrapNodes;
  } catch (err) {
    console.warn('[Bootstrap] ENS resolution failed, using hardcoded nodes:', err);
  }

  // 4. Hardcoded fallback
  cachedBootstrapNodes = [...HARDCODE_D_BOOTSTRAP_NODES];
  saveToCache(cachedBootstrapNodes);
  return cachedBootstrapNodes;
}

/**
 * Force a fresh resolution, bypassing all caches.
 * Call this from a "Refresh" button in settings UI.
 */
export async function refreshBootstrapNodes(): Promise<readonly string[]> {
  localStorage.removeItem(CACHE_KEY);
  cachedBootstrapNodes = null;
  return resolveBootstrapNodes();
}

/**
 * Get cached bootstrap nodes synchronously.
 * Returns null if resolveBootstrapNodes() has never been called.
 */
export function getCachedBootstrapNodes(): readonly string[] | null {
  if (cachedBootstrapNodes) return cachedBootstrapNodes;
  const fromCache = getFromCache();
  if (fromCache) return fromCache;
  return null;
}
