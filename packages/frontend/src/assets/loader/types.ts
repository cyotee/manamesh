/**
 * Asset Pack Loader Types
 *
 * Types for loading and managing asset packs from IPFS or HTTP sources.
 */

import type { AssetPackManifest, CardManifestEntry } from '../manifest/types';

/**
 * Source for loading an asset pack from IPFS.
 */
export interface IPFSSource {
  type: 'ipfs';
  /** IPFS CID of the asset pack root directory */
  cid: string;
}

/**
 * Source for loading an asset pack from HTTP.
 */
export interface HTTPSource {
  type: 'http';
  /** Base URL of the asset pack (directory containing manifest.json) */
  baseUrl: string;
}

/**
 * Combined source type for asset packs.
 */
export type AssetPackSource = IPFSSource | HTTPSource;

/**
 * A loaded asset pack with its manifest and source info.
 */
export interface LoadedAssetPack {
  /** Unique identifier for this pack (derived from source) */
  id: string;
  /** Parsed manifest */
  manifest: AssetPackManifest;
  /** All resolved cards (flattened from nested manifests) */
  cards: CardManifestEntry[];
  /** Source the pack was loaded from */
  source: AssetPackSource;
  /** Timestamp when the pack was loaded */
  loadedAt: number;
}

/**
 * Cache status for an asset pack.
 */
export interface CacheStatus {
  /** Total number of card images in the pack */
  totalCards: number;
  /** Number of card images currently cached */
  cachedCards: number;
  /** Total size of cached images in bytes */
  sizeBytes: number;
  /** Whether all images are cached */
  isComplete: boolean;
}

/**
 * Progress callback for bulk operations.
 */
export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Options for loading asset packs.
 */
export interface LoadOptions {
  /** Whether to cache images as they're fetched (default: true) */
  useCache?: boolean;
  /** Whether to prefer HTTP gateways over Helia for IPFS (default: config) */
  preferGateway?: boolean;
  /** Timeout for fetch operations in ms */
  timeout?: number;
}

/**
 * Result of fetching a card image.
 */
export interface CardImageResult {
  /** The image blob */
  blob: Blob;
  /** Whether it was served from cache */
  fromCache: boolean;
}

/**
 * Stored pack metadata in IndexedDB.
 */
export interface StoredPackMetadata {
  /** Pack ID */
  id: string;
  /** Pack name from manifest */
  name: string;
  /** Game type */
  game: string;
  /** Version */
  version: string;
  /** Source info */
  source: AssetPackSource;
  /** Number of cards */
  cardCount: number;
  /** Cached card IDs for cache status tracking */
  cachedCardIds: string[];
  /** Timestamp when loaded */
  loadedAt: number;
}

/**
 * Key format for card image storage.
 * Format: "pack:{packId}:card:{cardId}:{side}"
 */
export function makeCardImageKey(
  packId: string,
  cardId: string,
  side: 'front' | 'back'
): string {
  return `pack:${packId}:card:${cardId}:${side}`;
}

/**
 * Parse a card image key back to its components.
 */
export function parseCardImageKey(
  key: string
): { packId: string; cardId: string; side: 'front' | 'back' } | null {
  const match = key.match(/^pack:([^:]+):card:([^:]+):(front|back)$/);
  if (!match) return null;
  return {
    packId: match[1],
    cardId: match[2],
    side: match[3] as 'front' | 'back',
  };
}

/**
 * Generate a pack ID from a source.
 */
export function sourceToPackId(source: AssetPackSource): string {
  if (source.type === 'ipfs') {
    return `ipfs:${source.cid}`;
  } else {
    // Use base64 encoding of URL for HTTP sources
    // Remove trailing slash and hash to normalize
    const normalized = source.baseUrl.replace(/\/+$/, '');
    return `http:${btoa(normalized).replace(/[/+=]/g, '_')}`;
  }
}
