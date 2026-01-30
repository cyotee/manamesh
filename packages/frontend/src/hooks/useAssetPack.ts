/**
 * useAssetPack Hook
 *
 * React hook for loading and managing asset packs.
 * Handles zip pack loading with progress tracking.
 */

import { useState, useEffect, useCallback } from 'react';
import { loadPack } from '../assets/loader';
import { loadZipPack } from '../assets/loader/zip-loader';
import type {
  AssetPackSource,
  IPFSZipSource,
  LoadedAssetPack,
} from '../assets/loader/types';
import { sourceToPackId } from '../assets/loader/types';

export interface UseAssetPackResult {
  /** The loaded pack (null until loaded) */
  pack: LoadedAssetPack | null;
  /** Pack ID for use with useCardImage */
  packId: string | null;
  /** Whether the pack is currently loading */
  isLoading: boolean;
  /** Loading progress (0-100) */
  progress: number;
  /** Error if loading failed */
  error: Error | null;
  /** Reload the pack */
  reload: () => void;
}

/**
 * Hook to load an asset pack from any source type.
 * Automatically detects IPFSZipSource and uses the zip loader.
 */
export function useAssetPack(
  source: AssetPackSource | IPFSZipSource | null
): UseAssetPackResult {
  const [pack, setPack] = useState<LoadedAssetPack | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  const packId = source ? sourceToPackId(source as AssetPackSource) : null;

  useEffect(() => {
    if (!source) {
      setPack(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setProgress(0);
      setError(null);

      try {
        let loadedPack: LoadedAssetPack;

        if (source.type === 'ipfs-zip') {
          loadedPack = await loadZipPack(
            source as IPFSZipSource,
            {},
            (loaded, total) => {
              if (!cancelled) {
                setProgress(Math.floor((loaded / total) * 100));
              }
            }
          );
        } else {
          loadedPack = await loadPack(source as AssetPackSource);
        }

        if (!cancelled) {
          setPack(loadedPack);
          setProgress(100);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          console.error('[useAssetPack] Failed to load pack:', err);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [
    source?.type,
    source && 'cid' in source ? source.cid : null,
    source && 'baseUrl' in source ? source.baseUrl : null,
    reloadCount,
  ]);

  const reload = useCallback(() => {
    setReloadCount((prev) => prev + 1);
  }, []);

  return { pack, packId, isLoading, progress, error, reload };
}
