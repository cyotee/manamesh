/**
 * Deck Storage — IndexedDB persistence for deck lists.
 *
 * Uses idb-keyval for simple key-value storage of DeckList objects.
 */

import { createStore, get, set, del, keys, entries } from 'idb-keyval';
import type { DeckList } from './types';

const DECK_STORE = createStore('manamesh-decks', 'decks');

/** Save a deck list (create or update). */
export async function saveDeck(deck: DeckList): Promise<void> {
  deck.updatedAt = Date.now();
  await set(deck.id, deck, DECK_STORE);
}

/** Get a deck by ID. */
export async function getDeck(id: string): Promise<DeckList | undefined> {
  return get<DeckList>(id, DECK_STORE);
}

/** Delete a deck by ID. */
export async function deleteDeck(id: string): Promise<void> {
  await del(id, DECK_STORE);
}

/** Get all saved decks. */
export async function getAllDecks(): Promise<DeckList[]> {
  const allEntries = await entries<string, DeckList>(DECK_STORE);
  return allEntries.map(([, deck]) => deck);
}

/** Get all deck IDs. */
export async function getDeckIds(): Promise<string[]> {
  const allKeys = await keys<string>(DECK_STORE);
  return allKeys;
}

/** Duplicate a deck with a new ID and name. */
export async function duplicateDeck(
  id: string,
  newName?: string,
): Promise<DeckList | undefined> {
  const original = await getDeck(id);
  if (!original) return undefined;

  const duplicate: DeckList = {
    ...original,
    id: crypto.randomUUID(),
    name: newName ?? `${original.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveDeck(duplicate);
  return duplicate;
}

/** Clear all decks. */
export async function clearAllDecks(): Promise<void> {
  const allKeys = await keys(DECK_STORE);
  for (const key of allKeys) {
    await del(key, DECK_STORE);
  }
}

/** Create a new empty deck. */
export function createEmptyDeck(packId: string, name?: string): DeckList {
  return {
    id: crypto.randomUUID(),
    name: name ?? 'New Deck',
    game: 'onepiece',
    packId,
    leaderId: '',
    cards: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
