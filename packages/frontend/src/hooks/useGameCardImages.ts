/**
 * useGameCardImages Hook
 *
 * Loads card face images for a resolved deck and maps instance IDs
 * to object URLs for use in SceneState.cardImages.
 *
 * Handles multi-pack decks by using cardPackMap to look up the correct
 * pack for each card's image.
 */

import { useState, useEffect, useRef } from 'react';
import { getCardImageBlob } from '../assets/loader';
import type { OnePieceCard } from '../game/modules/onepiece/types';

/**
 * Strip instance suffix from a card ID.
 * "OP01-015#2" → "OP01-015", "OP01-001" → "OP01-001"
 */
export function baseCardId(instanceId: string): string {
  const hashIdx = instanceId.indexOf('#');
  return hashIdx >= 0 ? instanceId.slice(0, hashIdx) : instanceId;
}

/**
 * Group cards by base card ID, collecting all instance IDs.
 * Used to deduplicate image loads (4 copies of a card share 1 image).
 */
export function buildBaseToInstanceMap(
  cardIds: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of cardIds) {
    const base = baseCardId(id);
    const instances = map.get(base) ?? [];
    instances.push(id);
    map.set(base, instances);
  }
  return map;
}

/**
 * Core image loading logic (extracted for testability).
 * Loads one image per unique base card ID, then maps all instance IDs
 * to the resulting object URL.
 */
export async function loadGameCardImages(
  cardIds: string[],
  cardPackMap: Map<string, string>,
  loadBlob: (packId: string, cardId: string) => Promise<Blob | null>,
): Promise<Record<string, string>> {
  const baseToInstances = buildBaseToInstanceMap(cardIds);
  const result: Record<string, string> = {};

  for (const [base, instanceIds] of baseToInstances) {
    const packId = cardPackMap.get(base);
    if (!packId) continue;

    try {
      const blob = await loadBlob(packId, base);
      if (blob && blob.size > 100) {
        const url = URL.createObjectURL(blob);
        for (const id of instanceIds) {
          result[id] = url;
        }
      }
    } catch {
      // Skip cards with missing images
    }
  }

  return result;
}

/**
 * Load card face images for all cards in a resolved deck.
 *
 * @param cards - Resolved OnePieceCard array (with instance IDs)
 * @param cardPackMap - Maps base card ID → packId
 * @returns Record<instanceId, objectURL> for SceneState.cardImages
 */
export function useGameCardImages(
  cards: OnePieceCard[] | null,
  cardPackMap: Map<string, string>,
): Record<string, string> {
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!cards || cards.length === 0) {
      setImageMap({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const cardIds = cards.map((c) => c.id);
      const result = await loadGameCardImages(
        cardIds,
        cardPackMap,
        async (packId, cardId) => {
          if (cancelled) return null;
          const { blob } = await getCardImageBlob(packId, cardId, 'front');
          if (cancelled) return null;
          return blob;
        },
      );

      if (!cancelled) {
        // Track URLs for cleanup
        for (const url of Object.values(result)) {
          const base = Object.entries(result).find(([, u]) => u === url)?.[0];
          if (base) urlsRef.current.set(base, url);
        }
        setImageMap(result);
      }
    };

    load();

    return () => {
      cancelled = true;
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      urlsRef.current.clear();
    };
  }, [cards, cardPackMap]);

  return imageMap;
}
