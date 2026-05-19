/**
 * Shared in-memory registry for all loaded asset packs.
 *
 * All three loaders (loader, local-loader, zip-loader) write here so that
 * getLoadedPack / getAllLoadedPacks in loader.ts can see every loaded pack
 * regardless of which code path loaded it.
 */

import type { LoadedAssetPack } from './types';

const packRegistry = new Map<string, LoadedAssetPack>();

export function registerPack(pack: LoadedAssetPack): void {
  packRegistry.set(pack.id, pack);
}

export function unregisterPack(packId: string): void {
  packRegistry.delete(packId);
}

export function getRegisteredPack(packId: string): LoadedAssetPack | undefined {
  return packRegistry.get(packId);
}

export function getAllRegisteredPacks(): LoadedAssetPack[] {
  return Array.from(packRegistry.values());
}
