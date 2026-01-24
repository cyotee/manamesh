/**
 * Tests for the Deck Plugin
 *
 * Tests all deck operations: shuffle, draw, deal, peek, search, moveCard, moveTop, count
 * Tests both shared decks (Poker-style) and per-player decks (War-style)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Ctx } from 'boardgame.io';
import {
  DeckPlugin,
  DeckPluginGameState,
  DeckPluginApi,
  DeckPluginData,
  parseZoneId,
  buildZoneId,
  getZoneCards,
  setZoneCards,
  fisherYatesShuffle,
} from './deck';
import type { CoreCard } from '../modules/types';

// =============================================================================
// Test Utilities
// =============================================================================

/** Simple test card */
interface TestCard extends CoreCard {
  value: number;
}

function createTestCard(id: string, value: number): TestCard {
  return { id, name: `Card ${value}`, value };
}

function createTestDeck(size: number): TestCard[] {
  return Array.from({ length: size }, (_, i) =>
    createTestCard(`card-${i + 1}`, i + 1)
  );
}

function createEmptyGameState(): DeckPluginGameState<TestCard> {
  return { zones: {} };
}

function createGameStateWithSharedDeck(
  deckSize: number
): DeckPluginGameState<TestCard> {
  return {
    zones: {
      deck: { shared: createTestDeck(deckSize) },
      hand: {},
      discard: { shared: [] },
    },
  };
}

function createGameStateWithPlayerDecks(
  deckSize: number,
  playerIds: string[]
): DeckPluginGameState<TestCard> {
  const state: DeckPluginGameState<TestCard> = {
    zones: {
      deck: {},
      hand: {},
      won: {},
    },
  };

  playerIds.forEach((playerId) => {
    state.zones.deck[playerId] = createTestDeck(deckSize);
    state.zones.hand[playerId] = [];
    state.zones.won[playerId] = [];
  });

  return state;
}

function createMockCtx(): Ctx {
  return {
    numPlayers: 2,
    turn: 1,
    currentPlayer: '0',
    playOrder: ['0', '1'],
    playOrderPos: 0,
    phase: 'default',
    activePlayers: null,
  } as Ctx;
}

function getPluginApi<TCard extends CoreCard = TestCard>(
  G: DeckPluginGameState<TCard>,
  data?: DeckPluginData
): DeckPluginApi<TCard> {
  const pluginData = data ?? DeckPlugin.setup() as DeckPluginData;
  const ctx = createMockCtx();
  return DeckPlugin.api({ G, ctx, data: pluginData }) as DeckPluginApi<TCard>;
}

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('Helper Functions', () => {
  describe('parseZoneId', () => {
    it('should parse shared zone ID', () => {
      const result = parseZoneId('deck');
      expect(result).toEqual({ zone: 'deck' });
    });

    it('should parse player zone ID', () => {
      const result = parseZoneId('hand:0');
      expect(result).toEqual({ zone: 'hand', playerId: '0' });
    });

    it('should handle zone names with multiple colons', () => {
      const result = parseZoneId('special:zone:player1');
      expect(result).toEqual({ zone: 'special', playerId: 'zone:player1' });
    });
  });

  describe('buildZoneId', () => {
    it('should build shared zone ID', () => {
      const result = buildZoneId('deck');
      expect(result).toBe('deck');
    });

    it('should build player zone ID', () => {
      const result = buildZoneId('hand', '0');
      expect(result).toBe('hand:0');
    });
  });

  describe('getZoneCards / setZoneCards', () => {
    it('should get cards from shared zone', () => {
      const G = createGameStateWithSharedDeck(5);
      const cards = getZoneCards(G, 'deck');
      expect(cards).toHaveLength(5);
    });

    it('should get cards from player zone', () => {
      const G = createGameStateWithPlayerDecks(5, ['0', '1']);
      const cards = getZoneCards(G, 'deck:0');
      expect(cards).toHaveLength(5);
    });

    it('should return undefined for non-existent zone', () => {
      const G = createEmptyGameState();
      const cards = getZoneCards(G, 'nonexistent');
      expect(cards).toBeUndefined();
    });

    it('should set cards in shared zone', () => {
      const G = createEmptyGameState();
      const cards = createTestDeck(3);
      setZoneCards(G, 'deck', cards);
      expect(G.zones.deck.shared).toEqual(cards);
    });

    it('should set cards in player zone', () => {
      const G = createEmptyGameState();
      const cards = createTestDeck(3);
      setZoneCards(G, 'hand:0', cards);
      expect(G.zones.hand['0']).toEqual(cards);
    });
  });

  describe('fisherYatesShuffle', () => {
    it('should return array of same length', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = fisherYatesShuffle(original);
      expect(shuffled).toHaveLength(original.length);
    });

    it('should not modify original array', () => {
      const original = [1, 2, 3, 4, 5];
      const copy = [...original];
      fisherYatesShuffle(original);
      expect(original).toEqual(copy);
    });

    it('should contain same elements', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = fisherYatesShuffle(original);
      expect(shuffled.sort()).toEqual(original.sort());
    });

    it('should actually shuffle (statistical test)', () => {
      // Shuffle many times and check that order varies
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const shuffled = fisherYatesShuffle(original);
        results.add(shuffled.join(','));
      }

      // With 10 elements, we should get many different orderings
      expect(results.size).toBeGreaterThan(50);
    });
  });
});

// =============================================================================
// Plugin Setup Tests
// =============================================================================

describe('DeckPlugin Setup', () => {
  it('should have correct name', () => {
    expect(DeckPlugin.name).toBe('deck');
  });

  it('should initialize with zero shuffle count', () => {
    const data = DeckPlugin.setup() as DeckPluginData;
    expect(data.shuffleCount).toBe(0);
  });
});

// =============================================================================
// Shuffle Operation Tests
// =============================================================================

describe('shuffle', () => {
  it('should shuffle shared deck', () => {
    const G = createGameStateWithSharedDeck(10);
    const originalOrder = G.zones.deck.shared.map((c) => c.id).join(',');

    const api = getPluginApi(G);
    api.shuffle('deck');

    const newOrder = G.zones.deck.shared.map((c) => c.id).join(',');

    // Cards should still be present
    expect(G.zones.deck.shared).toHaveLength(10);

    // Order should likely be different (very small chance it's the same)
    // We'll run shuffle multiple times to ensure it changes
    let changed = originalOrder !== newOrder;
    for (let i = 0; i < 10 && !changed; i++) {
      api.shuffle('deck');
      const order = G.zones.deck.shared.map((c) => c.id).join(',');
      changed = order !== originalOrder;
    }
    expect(changed).toBe(true);
  });

  it('should shuffle player-specific deck', () => {
    const G = createGameStateWithPlayerDecks(10, ['0', '1']);
    const originalOrder = G.zones.deck['0'].map((c) => c.id).join(',');

    const api = getPluginApi(G);
    api.shuffle('deck:0');

    // Only player 0's deck should be shuffled
    expect(G.zones.deck['0']).toHaveLength(10);

    // Player 1's deck should be unchanged
    const player1Order = G.zones.deck['1'].map((c) => c.id).join(',');
    expect(player1Order).toBe(createTestDeck(10).map((c) => c.id).join(','));
  });

  it('should handle non-existent zone gracefully', () => {
    const G = createEmptyGameState();
    const api = getPluginApi(G);

    // Should not throw
    expect(() => api.shuffle('nonexistent')).not.toThrow();
  });
});

// =============================================================================
// Draw Operation Tests
// =============================================================================

describe('draw', () => {
  it('should draw one card by default', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const result = api.draw('deck');

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].id).toBe('card-1');
    expect(result.success).toBe(true);
    expect(result.shortfall).toBe(0);
    expect(G.zones.deck.shared).toHaveLength(4);
  });

  it('should draw multiple cards', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const result = api.draw('deck', 3);

    expect(result.cards).toHaveLength(3);
    expect(result.cards.map((c) => c.id)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(result.success).toBe(true);
    expect(G.zones.deck.shared).toHaveLength(2);
  });

  it('should return partial result if not enough cards', () => {
    const G = createGameStateWithSharedDeck(2);
    const api = getPluginApi(G);

    const result = api.draw('deck', 5);

    expect(result.cards).toHaveLength(2);
    expect(result.success).toBe(false);
    expect(result.shortfall).toBe(3);
    expect(G.zones.deck.shared).toHaveLength(0);
  });

  it('should return empty result from empty deck', () => {
    const G = createGameStateWithSharedDeck(0);
    G.zones.deck.shared = [];
    const api = getPluginApi(G);

    const result = api.draw('deck', 1);

    expect(result.cards).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.shortfall).toBe(1);
  });

  it('should draw from player-specific zone', () => {
    const G = createGameStateWithPlayerDecks(5, ['0', '1']);
    const api = getPluginApi(G);

    const result = api.draw('deck:0', 2);

    expect(result.cards).toHaveLength(2);
    expect(G.zones.deck['0']).toHaveLength(3);
    // Player 1's deck unchanged
    expect(G.zones.deck['1']).toHaveLength(5);
  });
});

// =============================================================================
// Deal Operation Tests
// =============================================================================

describe('deal', () => {
  it('should deal cards to multiple players', () => {
    const G = createGameStateWithSharedDeck(10);
    G.zones.hand = { '0': [], '1': [] };
    const api = getPluginApi(G);

    const result = api.deal('deck', 'hand', 3, ['0', '1']);

    expect(result.success).toBe(true);
    expect(result.shortfall).toBe(0);
    expect(result.dealt['0']).toHaveLength(3);
    expect(result.dealt['1']).toHaveLength(3);
    expect(G.zones.deck.shared).toHaveLength(4);
    expect(G.zones.hand['0']).toHaveLength(3);
    expect(G.zones.hand['1']).toHaveLength(3);
  });

  it('should deal round-robin style', () => {
    const G = createGameStateWithSharedDeck(6);
    G.zones.hand = { '0': [], '1': [] };
    const api = getPluginApi(G);

    const result = api.deal('deck', 'hand', 3, ['0', '1']);

    // Player 0 should get cards 1, 3, 5
    expect(result.dealt['0'].map((c) => c.value)).toEqual([1, 3, 5]);
    // Player 1 should get cards 2, 4, 6
    expect(result.dealt['1'].map((c) => c.value)).toEqual([2, 4, 6]);
  });

  it('should handle partial deal when deck runs out', () => {
    const G = createGameStateWithSharedDeck(4);
    G.zones.hand = { '0': [], '1': [] };
    const api = getPluginApi(G);

    const result = api.deal('deck', 'hand', 3, ['0', '1']);

    expect(result.success).toBe(false);
    expect(result.shortfall).toBe(2); // Needed 6, only had 4
    expect(result.dealt['0']).toHaveLength(2);
    expect(result.dealt['1']).toHaveLength(2);
  });

  it('should create destination zones if they do not exist', () => {
    const G = createGameStateWithSharedDeck(4);
    // No hand zones defined
    const api = getPluginApi(G);

    const result = api.deal('deck', 'hand', 2, ['0', '1']);

    expect(result.success).toBe(true);
    expect(G.zones.hand['0']).toHaveLength(2);
    expect(G.zones.hand['1']).toHaveLength(2);
  });
});

// =============================================================================
// Peek Operation Tests
// =============================================================================

describe('peek', () => {
  it('should peek at top card without removing it', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const cards = api.peek('deck');

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('card-1');
    // Deck should be unchanged
    expect(G.zones.deck.shared).toHaveLength(5);
    expect(G.zones.deck.shared[0].id).toBe('card-1');
  });

  it('should peek at multiple cards', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const cards = api.peek('deck', 3);

    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.id)).toEqual(['card-1', 'card-2', 'card-3']);
    // Deck unchanged
    expect(G.zones.deck.shared).toHaveLength(5);
  });

  it('should return available cards if fewer than requested', () => {
    const G = createGameStateWithSharedDeck(2);
    const api = getPluginApi(G);

    const cards = api.peek('deck', 5);

    expect(cards).toHaveLength(2);
  });

  it('should return empty array for non-existent zone', () => {
    const G = createEmptyGameState();
    const api = getPluginApi(G);

    const cards = api.peek('nonexistent');

    expect(cards).toEqual([]);
  });
});

// =============================================================================
// Search Operation Tests
// =============================================================================

describe('search', () => {
  it('should find cards matching predicate', () => {
    const G = createGameStateWithSharedDeck(10);
    const api = getPluginApi(G);

    const result = api.search('deck', (card) => card.value > 7);

    expect(result.cards).toHaveLength(3);
    expect(result.cards.map((c) => c.value)).toEqual([8, 9, 10]);
    expect(result.indices).toEqual([7, 8, 9]);
  });

  it('should return empty result when no matches', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const result = api.search('deck', (card) => card.value > 100);

    expect(result.cards).toHaveLength(0);
    expect(result.indices).toHaveLength(0);
  });

  it('should search by card name', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const result = api.search('deck', (card) => card.name === 'Card 3');

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].value).toBe(3);
  });

  it('should not modify the zone', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    api.search('deck', (card) => card.value === 3);

    expect(G.zones.deck.shared).toHaveLength(5);
  });
});

// =============================================================================
// MoveCard Operation Tests
// =============================================================================

describe('moveCard', () => {
  it('should move card between zones', () => {
    const G = createGameStateWithSharedDeck(5);
    G.zones.discard = { shared: [] };
    const api = getPluginApi(G);

    const result = api.moveCard('card-3', 'deck', 'discard');

    expect(result.success).toBe(true);
    expect(G.zones.deck.shared).toHaveLength(4);
    expect(G.zones.deck.shared.find((c) => c.id === 'card-3')).toBeUndefined();
    expect(G.zones.discard.shared).toHaveLength(1);
    expect(G.zones.discard.shared[0].id).toBe('card-3');
  });

  it('should move card to specific index', () => {
    const G = createGameStateWithSharedDeck(5);
    G.zones.hand = { '0': createTestDeck(3) };
    const api = getPluginApi(G);

    const result = api.moveCard('card-1', 'deck', 'hand:0', 1);

    expect(result.success).toBe(true);
    expect(G.zones.hand['0']).toHaveLength(4);
    expect(G.zones.hand['0'][1].id).toBe('card-1');
  });

  it('should fail for non-existent card', () => {
    const G = createGameStateWithSharedDeck(5);
    G.zones.discard = { shared: [] };
    const api = getPluginApi(G);

    const result = api.moveCard('nonexistent', 'deck', 'discard');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Card not found');
  });

  it('should fail for non-existent source zone', () => {
    const G = createEmptyGameState();
    const api = getPluginApi(G);

    const result = api.moveCard('card-1', 'nonexistent', 'discard');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Source zone not found');
  });

  it('should create destination zone if it does not exist', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    const result = api.moveCard('card-1', 'deck', 'newzone');

    expect(result.success).toBe(true);
    expect(G.zones.newzone.shared).toHaveLength(1);
  });
});

// =============================================================================
// MoveTop Operation Tests
// =============================================================================

describe('moveTop', () => {
  it('should move top card to another zone', () => {
    const G = createGameStateWithSharedDeck(5);
    G.zones.discard = { shared: [] };
    const api = getPluginApi(G);

    const result = api.moveTop('deck', 'discard');

    expect(result.success).toBe(true);
    expect(G.zones.deck.shared).toHaveLength(4);
    expect(G.zones.discard.shared).toHaveLength(1);
    expect(G.zones.discard.shared[0].id).toBe('card-1');
  });

  it('should move multiple top cards', () => {
    const G = createGameStateWithSharedDeck(5);
    G.zones.discard = { shared: [] };
    const api = getPluginApi(G);

    const result = api.moveTop('deck', 'discard', 3);

    expect(result.success).toBe(true);
    expect(G.zones.deck.shared).toHaveLength(2);
    expect(G.zones.discard.shared).toHaveLength(3);
    expect(G.zones.discard.shared.map((c) => c.id)).toEqual([
      'card-1',
      'card-2',
      'card-3',
    ]);
  });

  it('should return partial success if not enough cards', () => {
    const G = createGameStateWithSharedDeck(2);
    G.zones.discard = { shared: [] };
    const api = getPluginApi(G);

    const result = api.moveTop('deck', 'discard', 5);

    expect(result.success).toBe(false);
    expect(G.zones.deck.shared).toHaveLength(0);
    expect(G.zones.discard.shared).toHaveLength(2);
  });
});

// =============================================================================
// Count Operation Tests
// =============================================================================

describe('count', () => {
  it('should count cards in zone', () => {
    const G = createGameStateWithSharedDeck(5);
    const api = getPluginApi(G);

    expect(api.count('deck')).toBe(5);
  });

  it('should return 0 for empty zone', () => {
    const G = createGameStateWithSharedDeck(0);
    G.zones.deck.shared = [];
    const api = getPluginApi(G);

    expect(api.count('deck')).toBe(0);
  });

  it('should return 0 for non-existent zone', () => {
    const G = createEmptyGameState();
    const api = getPluginApi(G);

    expect(api.count('nonexistent')).toBe(0);
  });

  it('should count player-specific zone', () => {
    const G = createGameStateWithPlayerDecks(5, ['0', '1']);
    const api = getPluginApi(G);

    expect(api.count('deck:0')).toBe(5);
    expect(api.count('deck:1')).toBe(5);
  });
});

// =============================================================================
// Plugin Flush Tests
// =============================================================================

describe('DeckPlugin Flush', () => {
  it('should track shuffle count', () => {
    const G = createGameStateWithSharedDeck(10);
    const data = DeckPlugin.setup() as DeckPluginData;
    const ctx = createMockCtx();

    const api = DeckPlugin.api({ G, ctx, data }) as DeckPluginApi & {
      _pendingShuffles?: number;
    };

    api.shuffle('deck');
    api.shuffle('deck');

    const newData = DeckPlugin.flush({ G, ctx, data, api }) as DeckPluginData;

    expect(newData.shuffleCount).toBe(2);
  });
});

// =============================================================================
// Integration Tests - War Game Style
// =============================================================================

describe('War Game Integration', () => {
  it('should support War game workflow', () => {
    // Setup: Each player has their own deck
    const G = createGameStateWithPlayerDecks(26, ['0', '1']);
    G.zones.played = { '0': [], '1': [] };
    G.zones.won = { '0': [], '1': [] };

    const api = getPluginApi(G);

    // Shuffle each player's deck
    api.shuffle('deck:0');
    api.shuffle('deck:1');

    // Each player draws (plays) top card
    const p0Card = api.draw('deck:0', 1);
    const p1Card = api.draw('deck:1', 1);

    // Move drawn cards to played zone (in real game, this would be done differently)
    if (p0Card.cards.length > 0) {
      G.zones.played['0'].push(p0Card.cards[0]);
    }
    if (p1Card.cards.length > 0) {
      G.zones.played['1'].push(p1Card.cards[0]);
    }

    expect(G.zones.deck['0']).toHaveLength(25);
    expect(G.zones.deck['1']).toHaveLength(25);
    expect(G.zones.played['0']).toHaveLength(1);
    expect(G.zones.played['1']).toHaveLength(1);
  });
});

// =============================================================================
// Integration Tests - Poker Game Style
// =============================================================================

describe('Poker Game Integration', () => {
  it('should support Poker game workflow', () => {
    // Setup: Single shared deck
    const G: DeckPluginGameState<TestCard> = {
      zones: {
        deck: { shared: createTestDeck(52) },
        hand: {},
        community: { shared: [] },
        discard: { shared: [] },
      },
    };

    const api = getPluginApi(G);

    // Shuffle the deck
    api.shuffle('deck');

    // Deal 2 cards to each of 4 players
    const result = api.deal('deck', 'hand', 2, ['0', '1', '2', '3']);

    expect(result.success).toBe(true);
    expect(G.zones.deck.shared).toHaveLength(44);
    expect(G.zones.hand['0']).toHaveLength(2);
    expect(G.zones.hand['1']).toHaveLength(2);
    expect(G.zones.hand['2']).toHaveLength(2);
    expect(G.zones.hand['3']).toHaveLength(2);

    // Deal flop (3 community cards)
    api.moveTop('deck', 'community', 3);
    expect(G.zones.community.shared).toHaveLength(3);
    expect(G.zones.deck.shared).toHaveLength(41);

    // Deal turn
    api.moveTop('deck', 'community', 1);
    expect(G.zones.community.shared).toHaveLength(4);

    // Deal river
    api.moveTop('deck', 'community', 1);
    expect(G.zones.community.shared).toHaveLength(5);
    expect(G.zones.deck.shared).toHaveLength(39);
  });
});
