/**
 * useDeckStorage Hook
 *
 * React hook wrapping IndexedDB deck CRUD operations.
 * Provides async operations with loading states.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DeckList } from '../deck/types';
import {
  saveDeck,
  getDeck,
  deleteDeck,
  getAllDecks,
  duplicateDeck,
  createEmptyDeck,
} from '../deck/storage';

export interface UseDeckStorageResult {
  /** All saved decks */
  decks: DeckList[];
  /** Whether the initial load is in progress */
  isLoading: boolean;
  /** Save a deck (create or update) */
  save: (deck: DeckList) => Promise<void>;
  /** Delete a deck by ID */
  remove: (id: string) => Promise<void>;
  /** Duplicate a deck */
  duplicate: (id: string, newName?: string) => Promise<DeckList | undefined>;
  /** Create a new empty deck */
  create: (packId: string, name?: string) => DeckList;
  /** Refresh the deck list from IndexedDB */
  refresh: () => Promise<void>;
}

export function useDeckStorage(): UseDeckStorageResult {
  const [decks, setDecks] = useState<DeckList[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await getAllDecks();
    // Sort by updatedAt descending (most recent first)
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    setDecks(all);
  }, []);

  // Initial load
  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const save = useCallback(
    async (deck: DeckList) => {
      await saveDeck(deck);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteDeck(id);
      await refresh();
    },
    [refresh],
  );

  const dup = useCallback(
    async (id: string, newName?: string) => {
      const result = await duplicateDeck(id, newName);
      await refresh();
      return result;
    },
    [refresh],
  );

  const create = useCallback((packId: string, name?: string) => {
    return createEmptyDeck(packId, name);
  }, []);

  return {
    decks,
    isLoading,
    save,
    remove,
    duplicate: dup,
    create,
    refresh,
  };
}
