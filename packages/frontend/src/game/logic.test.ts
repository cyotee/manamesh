import { describe, it, expect } from 'vitest';
import {
  Card,
  GState,
  createInitialState,
  createTestDeck,
  drawCard,
  playCard,
  discardCard,
  shuffleDeck,
  isGameOver,
} from './logic';

// Helper to create a deterministic deck for testing (not shuffled)
function createUnshuffledState(cards: Card[], numPlayers: number): GState {
  const hands: Record<string, Card[]> = {};
  const field: Record<string, Card[]> = {};

  for (let i = 0; i < numPlayers; i++) {
    hands[i.toString()] = [];
    field[i.toString()] = [];
  }

  return {
    deck: cards.slice(),
    hands,
    field,
    discard: [],
    winner: null,
    maxHandSize: 7,
    cardsToWin: 5,
  };
}

describe('createTestDeck', () => {
  it('creates a deck with specified number of cards', () => {
    const deck = createTestDeck(10);
    expect(deck).toHaveLength(10);
    expect(deck[0]).toEqual({ id: 'card-1', name: 'Card 1' });
    expect(deck[9]).toEqual({ id: 'card-10', name: 'Card 10' });
  });

  it('defaults to 20 cards', () => {
    const deck = createTestDeck();
    expect(deck).toHaveLength(20);
  });
});

describe('shuffleDeck', () => {
  it('returns a deck of the same length', () => {
    const deck = createTestDeck(10);
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(10);
  });

  it('does not modify the original deck', () => {
    const deck = createTestDeck(5);
    const original = deck.slice();
    shuffleDeck(deck);
    expect(deck).toEqual(original);
  });

  it('contains all original cards', () => {
    const deck = createTestDeck(10);
    const shuffled = shuffleDeck(deck);
    const originalIds = deck.map(c => c.id).sort();
    const shuffledIds = shuffled.map(c => c.id).sort();
    expect(shuffledIds).toEqual(originalIds);
  });
});

describe('createInitialState', () => {
  it('creates state with shuffled deck and empty hands', () => {
    const deck = createTestDeck(10);
    const state = createInitialState(deck, 2);

    expect(state.deck).toHaveLength(10);
    expect(state.hands['0']).toEqual([]);
    expect(state.hands['1']).toEqual([]);
    expect(state.field['0']).toEqual([]);
    expect(state.field['1']).toEqual([]);
    expect(state.discard).toEqual([]);
    expect(state.winner).toBeNull();
  });

  it('creates correct number of player hands', () => {
    const deck = createTestDeck(10);
    const state = createInitialState(deck, 4);

    expect(Object.keys(state.hands)).toHaveLength(4);
    expect(Object.keys(state.field)).toHaveLength(4);
  });
});

describe('drawCard', () => {
  it('draws the top card into the player hand', () => {
    const cards: Card[] = [
      { id: 'X', name: 'Card X' },
      { id: 'Y', name: 'Card Y' },
      { id: 'Z', name: 'Card Z' },
    ];
    const G = createUnshuffledState(cards, 2);
    const result = drawCard(G, '0');

    expect(result.state.deck).toHaveLength(2);
    expect(result.state.hands['0']).toHaveLength(1);
    expect(result.state.hands['0'][0].id).toBe('X');
    expect(result.drawnCard?.id).toBe('X');
  });

  it('returns null when deck is empty', () => {
    const G = createUnshuffledState([], 2);
    const result = drawCard(G, '1');

    expect(result.state.deck).toEqual([]);
    expect(result.state.hands['1']).toEqual([]);
    expect(result.drawnCard).toBeNull();
  });

  it('does not modify original state', () => {
    const cards: Card[] = [{ id: 'A', name: 'Card A' }];
    const G = createUnshuffledState(cards, 2);
    const originalDeckLength = G.deck.length;

    drawCard(G, '0');

    expect(G.deck.length).toBe(originalDeckLength);
  });
});

describe('playCard', () => {
  it('moves a card from hand to field', () => {
    const G = createUnshuffledState([], 2);
    G.hands['0'] = [
      { id: 'A', name: 'Card A' },
      { id: 'B', name: 'Card B' },
    ];

    const result = playCard(G, '0', 'A');

    expect(result.success).toBe(true);
    expect(result.state.hands['0']).toHaveLength(1);
    expect(result.state.hands['0'][0].id).toBe('B');
    expect(result.state.field['0']).toHaveLength(1);
    expect(result.state.field['0'][0].id).toBe('A');
  });

  it('fails when card not in hand', () => {
    const G = createUnshuffledState([], 2);
    G.hands['0'] = [{ id: 'A', name: 'Card A' }];

    const result = playCard(G, '0', 'NONEXISTENT');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Card not in hand');
    expect(result.state).toBe(G); // Returns original state unchanged
  });

  it('triggers win condition when cardsToWin reached', () => {
    const G = createUnshuffledState([], 2);
    G.cardsToWin = 2;
    G.field['0'] = [{ id: 'X', name: 'Card X' }];
    G.hands['0'] = [{ id: 'Y', name: 'Card Y' }];

    const result = playCard(G, '0', 'Y');

    expect(result.success).toBe(true);
    expect(result.state.field['0']).toHaveLength(2);
    expect(result.state.winner).toBe('0');
  });

  it('does not modify original state', () => {
    const G = createUnshuffledState([], 2);
    G.hands['0'] = [{ id: 'A', name: 'Card A' }];
    const originalHandLength = G.hands['0'].length;

    playCard(G, '0', 'A');

    expect(G.hands['0'].length).toBe(originalHandLength);
  });
});

describe('discardCard', () => {
  it('moves a card from hand to discard pile', () => {
    const G = createUnshuffledState([], 2);
    G.hands['0'] = [
      { id: 'A', name: 'Card A' },
      { id: 'B', name: 'Card B' },
    ];

    const result = discardCard(G, '0', 'A');

    expect(result.success).toBe(true);
    expect(result.state.hands['0']).toHaveLength(1);
    expect(result.state.discard).toHaveLength(1);
    expect(result.state.discard[0].id).toBe('A');
  });

  it('fails when card not in hand', () => {
    const G = createUnshuffledState([], 2);
    G.hands['0'] = [{ id: 'A', name: 'Card A' }];

    const result = discardCard(G, '0', 'NONEXISTENT');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Card not in hand');
  });
});

describe('isGameOver', () => {
  it('returns true when there is a winner', () => {
    const G = createUnshuffledState([], 2);
    G.winner = '0';

    expect(isGameOver(G)).toBe(true);
  });

  it('returns true when deck is empty', () => {
    const G = createUnshuffledState([], 2);

    expect(isGameOver(G)).toBe(true);
  });

  it('returns false when game is ongoing', () => {
    const cards = createTestDeck(5);
    const G = createUnshuffledState(cards, 2);

    expect(isGameOver(G)).toBe(false);
  });
});
