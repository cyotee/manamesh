/**
 * useCardImage Hook
 *
 * React hook for loading card images from the asset pack cache.
 * Manages object URL creation/revocation and provides loading states.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCardImageBlob } from '../assets/loader';
import type { LoadOptions } from '../assets/loader/types';

export interface UseCardImageResult {
  /** Object URL for the card image (null while loading or on error) */
  url: string | null;
  /** Whether the image is currently loading */
  isLoading: boolean;
  /** Error if loading failed */
  error: Error | null;
  /** Whether the image was served from cache */
  fromCache: boolean;
  /** Retry loading the image */
  retry: () => void;
}

/**
 * Hook to load a single card image from the asset pack cache.
 *
 * Handles:
 * - Automatic object URL creation and revocation
 * - Loading state management
 * - Cache-first fetching
 * - Cleanup on unmount
 *
 * @param packId - Asset pack ID (from sourceToPackId)
 * @param cardId - Card ID within the pack (e.g., 'clubs-A')
 * @param side - 'front' or 'back'
 * @param options - Optional load options
 */
export function useCardImage(
  packId: string | null,
  cardId: string | null,
  side: 'front' | 'back' = 'front',
  options?: LoadOptions
): UseCardImageResult {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Track current URL for cleanup
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!packId || !cardId) {
      setUrl(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await getCardImageBlob(packId, cardId, side, options);

        if (cancelled) return;

        // Revoke previous URL
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
        }

        // Check if we got a real image (not the 1x1 placeholder)
        if (result.blob.size > 100) {
          const newUrl = URL.createObjectURL(result.blob);
          urlRef.current = newUrl;
          setUrl(newUrl);
          setFromCache(result.fromCache);
        } else {
          // Placeholder blob returned -- treat as not available
          setUrl(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setUrl(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [packId, cardId, side, retryCount]);
  // Intentionally exclude options to avoid re-fetching on every render

  const retry = useCallback(() => {
    setRetryCount((prev) => prev + 1);
  }, []);

  return { url, isLoading, error, fromCache, retry };
}

/**
 * Hook to load multiple card images at once.
 * Returns a map of cardId -> url.
 */
export function useCardImages(
  packId: string | null,
  cardIds: string[],
  side: 'front' | 'back' = 'front'
): Map<string, string | null> {
  const [urls, setUrls] = useState<Map<string, string | null>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!packId || cardIds.length === 0) {
      setUrls(new Map());
      return;
    }

    let cancelled = false;

    const loadAll = async () => {
      const newUrls = new Map<string, string | null>();

      for (const cardId of cardIds) {
        if (cancelled) break;

        try {
          const result = await getCardImageBlob(packId, cardId, side);

          if (result.blob.size > 100) {
            // Revoke old URL for this card
            const oldUrl = urlsRef.current.get(cardId);
            if (oldUrl) URL.revokeObjectURL(oldUrl);

            const newUrl = URL.createObjectURL(result.blob);
            urlsRef.current.set(cardId, newUrl);
            newUrls.set(cardId, newUrl);
          } else {
            newUrls.set(cardId, null);
          }
        } catch {
          newUrls.set(cardId, null);
        }
      }

      if (!cancelled) {
        setUrls(newUrls);
      }
    };

    loadAll();

    return () => {
      cancelled = true;
      for (const u of urlsRef.current.values()) {
        URL.revokeObjectURL(u);
      }
      urlsRef.current.clear();
    };
  }, [packId, cardIds.join(','), side]);

  return urls;
}
