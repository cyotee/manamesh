/**
 * Asset Fetcher
 *
 * Handles fetching assets from IPFS or HTTP sources.
 * Wraps the base IPFS loader with asset pack-aware functionality.
 */

import { loadAsset } from '../ipfs-loader';
import { getConfig } from '../config';
import type { AssetPackSource, IPFSSource, HTTPSource, LoadOptions } from './types';

/**
 * Fetch a file as text from an asset pack source.
 * Used for loading manifests.
 */
export async function fetchText(
  source: AssetPackSource,
  path: string,
  options: LoadOptions = {}
): Promise<string> {
  const blob = await fetchBlob(source, path, options);
  return blob.text();
}

/**
 * Fetch a file as JSON from an asset pack source.
 */
export async function fetchJson(
  source: AssetPackSource,
  path: string,
  options: LoadOptions = {}
): Promise<unknown> {
  const text = await fetchText(source, path, options);
  return JSON.parse(text);
}

/**
 * Fetch a file as Blob from an asset pack source.
 */
export async function fetchBlob(
  source: AssetPackSource,
  path: string,
  options: LoadOptions = {}
): Promise<Blob> {
  if (source.type === 'ipfs') {
    return fetchFromIPFS(source, path, options);
  } else {
    return fetchFromHTTP(source, path, options);
  }
}

/**
 * Fetch a file from IPFS.
 */
async function fetchFromIPFS(
  source: IPFSSource,
  path: string,
  options: LoadOptions = {}
): Promise<Blob> {
  const config = getConfig();

  // For IPFS, the path is appended to the CID
  // e.g., CID/manifest.json or CID/cards/card1/front.png
  const fullCid = path ? `${source.cid}/${path}` : source.cid;

  const result = await loadAsset(fullCid, {
    useCache: options.useCache ?? true,
    preferGateway: options.preferGateway ?? config.preferGateway,
    gatewayTimeout: options.timeout ?? config.gatewayTimeout,
    heliaTimeout: options.timeout ?? config.heliaFetchTimeout,
  });

  return result.blob;
}

/**
 * Fetch a file from HTTP.
 */
async function fetchFromHTTP(
  source: HTTPSource,
  path: string,
  options: LoadOptions = {}
): Promise<Blob> {
  const config = getConfig();
  const timeout = options.timeout ?? config.gatewayTimeout;

  // Construct full URL
  const baseUrl = source.baseUrl.replace(/\/+$/, '');
  const cleanPath = path.replace(/^\/+/, '');
  const fullUrl = cleanPath ? `${baseUrl}/${cleanPath}` : baseUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(fullUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.blob();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timeout fetching ${fullUrl}`);
    }
    throw error;
  }
}

/**
 * Check if a source is reachable by attempting to fetch the manifest.
 */
export async function isSourceReachable(
  source: AssetPackSource,
  timeout: number = 5000
): Promise<boolean> {
  try {
    await fetchJson(source, 'manifest.json', { timeout });
    return true;
  } catch {
    return false;
  }
}
