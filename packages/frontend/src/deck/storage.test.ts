/**
 * Deck Storage Tests
 *
 * Tests IndexedDB-based deck persistence.
 * Uses fake-indexeddb for test environment.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DeckList } from './types';

// Mock idb-keyval to use in-memory storage
const mockStore = new Map<string, any>();

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  get: async (key: string) => mockStore.get(key),
  set: async (key: string, value: any) => {
    mockStore.set(key, value);
  },
  del: async (key: string) => {
    mockStore.delete(key);
  },
  keys: async () => Array.from(mockStore.keys()),
  entries: async () => Array.from(mockStore.entries()),
}));

// Import after mocking
const { saveDeck, getDeck, deleteDeck, getAllDecks, duplicateDeck, createEmptyDeck, clearAllDecks } =
  await import('./storage');

function makeDeck(overrides: Partial<DeckList> = {}): DeckList {
  return {
    id: 'test-id',
    name: 'Test Deck',
    game: 'onepiece',
    packId: 'test-pack',
    leaderId: 'OP01-001',
    cards: { 'OP01-004': 4 },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('Deck Storage', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('saves and retrieves a deck', async () => {
    const deck = makeDeck();
    await saveDeck(deck);

    const retrieved = await getDeck('test-id');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Test Deck');
    expect(retrieved!.cards['OP01-004']).toBe(4);
  });

  it('updates updatedAt on save', async () => {
    const deck = makeDeck({ updatedAt: 0 });
    await saveDeck(deck);

    const retrieved = await getDeck('test-id');
    expect(retrieved!.updatedAt).toBeGreaterThan(0);
  });

  it('deletes a deck', async () => {
    await saveDeck(makeDeck());
    await deleteDeck('test-id');

    const retrieved = await getDeck('test-id');
    expect(retrieved).toBeUndefined();
  });

  it('gets all decks', async () => {
    await saveDeck(makeDeck({ id: 'deck-1', name: 'Deck 1' }));
    await saveDeck(makeDeck({ id: 'deck-2', name: 'Deck 2' }));

    const all = await getAllDecks();
    expect(all).toHaveLength(2);
  });

  it('duplicates a deck with new ID', async () => {
    await saveDeck(makeDeck({ id: 'original' }));

    const dup = await duplicateDeck('original', 'My Copy');
    expect(dup).toBeDefined();
    expect(dup!.id).not.toBe('original');
    expect(dup!.name).toBe('My Copy');
    expect(dup!.cards['OP01-004']).toBe(4);
  });

  it('duplicateDeck returns undefined for non-existent deck', async () => {
    const result = await duplicateDeck('nonexistent');
    expect(result).toBeUndefined();
  });

  it('creates an empty deck', () => {
    const deck = createEmptyDeck('pack-1', 'New');
    expect(deck.id).toBeTruthy();
    expect(deck.name).toBe('New');
    expect(deck.packId).toBe('pack-1');
    expect(deck.leaderId).toBe('');
    expect(Object.keys(deck.cards)).toHaveLength(0);
  });

  it('clears all decks', async () => {
    await saveDeck(makeDeck({ id: 'a' }));
    await saveDeck(makeDeck({ id: 'b' }));

    await clearAllDecks();
    const all = await getAllDecks();
    expect(all).toHaveLength(0);
  });
});
