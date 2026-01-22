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

describe('Edge cases', () => {
  describe('empty deck handling', () => {
    it('allows multiple draw attempts on empty deck without error', () => {
      const G = createUnshuffledState([], 2);

      const result1 = drawCard(G, '0');
      const result2 = drawCard(result1.state, '0');
      const result3 = drawCard(result2.state, '0');

      expect(result1.drawnCard).toBeNull();
      expect(result2.drawnCard).toBeNull();
      expect(result3.drawnCard).toBeNull();
      expect(result3.state.hands['0']).toEqual([]);
    });

    it('game over triggers when deck runs out mid-game', () => {
      const cards: Card[] = [{ id: 'last', name: 'Last Card' }];
      const G = createUnshuffledState(cards, 2);

      const result = drawCard(G, '0');
      expect(result.drawnCard?.id).toBe('last');
      expect(isGameOver(result.state)).toBe(true);
    });
  });

  describe('full hand handling', () => {
    it('allows drawing beyond maxHandSize (no hard limit enforced)', () => {
      const cards = createTestDeck(10);
      const G = createUnshuffledState(cards, 2);
      G.maxHandSize = 3;

      // Draw 5 cards (beyond maxHandSize)
      let state = G;
      for (let i = 0; i < 5; i++) {
        const result = drawCard(state, '0');
        state = result.state;
      }

      expect(state.hands['0']).toHaveLength(5);
      expect(state.deck).toHaveLength(5);
    });
  });

  describe('win conditions', () => {
    it('player wins immediately when cardsToWin is 1', () => {
      const G = createUnshuffledState([], 2);
      G.cardsToWin = 1;
      G.hands['0'] = [{ id: 'winning', name: 'Winning Card' }];

      const result = playCard(G, '0', 'winning');

      expect(result.success).toBe(true);
      expect(result.state.winner).toBe('0');
    });

    it('only first player to reach cardsToWin wins', () => {
      const G = createUnshuffledState([], 2);
      G.cardsToWin = 2;
      G.field['0'] = [{ id: 'A', name: 'Card A' }];
      G.field['1'] = [{ id: 'B', name: 'Card B' }];
      G.hands['0'] = [{ id: 'C', name: 'Card C' }];
      G.hands['1'] = [{ id: 'D', name: 'Card D' }];

      // Player 0 plays first
      const result = playCard(G, '0', 'C');

      expect(result.state.winner).toBe('0');
    });

    it('subsequent plays after winner update winner (known behavior - game should prevent this)', () => {
      const G = createUnshuffledState([], 2);
      G.cardsToWin = 1;
      G.hands['0'] = [{ id: 'A', name: 'Card A' }];
      G.hands['1'] = [{ id: 'B', name: 'Card B' }];

      // Player 0 wins
      const state1 = playCard(G, '0', 'A').state;
      expect(state1.winner).toBe('0');

      // Player 1 plays after - NOTE: current logic allows this to overwrite winner
      // In a real game, the game flow should prevent plays after a winner is declared
      const state2 = playCard(state1, '1', 'B').state;
      expect(state2.winner).toBe('1'); // Documents current behavior
    });
  });

  describe('invalid move handling', () => {
    it('play fails gracefully for non-existent player', () => {
      const G = createUnshuffledState([], 2);

      const result = playCard(G, 'nonexistent', 'any');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Card not in hand');
    });

    it('discard fails gracefully for non-existent player', () => {
      const G = createUnshuffledState([], 2);

      const result = discardCard(G, 'nonexistent', 'any');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Card not in hand');
    });

    it('draw handles non-existent player gracefully', () => {
      const cards = createTestDeck(5);
      const G = createUnshuffledState(cards, 2);

      const result = drawCard(G, 'nonexistent');

      // Creates empty array for nonexistent player
      expect(result.drawnCard).not.toBeNull();
      expect(result.state.hands['nonexistent']).toHaveLength(1);
    });

    it('playing same card twice fails', () => {
      const G = createUnshuffledState([], 2);
      G.hands['0'] = [{ id: 'A', name: 'Card A' }];

      const result1 = playCard(G, '0', 'A');
      expect(result1.success).toBe(true);

      // Try to play same card again
      const result2 = playCard(result1.state, '0', 'A');
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Card not in hand');
    });
  });

  describe('multiple players', () => {
    it('handles 4-player game correctly', () => {
      const cards = createTestDeck(20);
      const G = createUnshuffledState(cards, 4);

      // Each player draws 2 cards
      let state = G;
      for (let round = 0; round < 2; round++) {
        for (let player = 0; player < 4; player++) {
          const result = drawCard(state, player.toString());
          state = result.state;
        }
      }

      expect(state.hands['0']).toHaveLength(2);
      expect(state.hands['1']).toHaveLength(2);
      expect(state.hands['2']).toHaveLength(2);
      expect(state.hands['3']).toHaveLength(2);
      expect(state.deck).toHaveLength(12); // 20 - 8 drawn
    });
  });
});
