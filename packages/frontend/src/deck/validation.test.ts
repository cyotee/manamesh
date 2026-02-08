/**
 * Deck Validation Tests
 *
 * Tests tournament rule validation for One Piece TCG decks.
 */

import { describe, it, expect } from 'vitest';
import { validateDeck, canAddCard } from './validation';
import type { DeckList, EnrichedCard } from './types';

// --- Helpers ---

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    id: 'OP01-001',
    name: 'Test Card',
    front: 'cards/OP01-001/front.png',
    colors: ['red'],
    cardType: 'character',
    cost: 3,
    power: 5000,
    counter: 1000,
    rarity: 'C',
    set: 'OP01',
    effectText: '',
    traits: [],
    life: null,
    ...overrides,
  };
}

function makeLeader(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return makeCard({
    id: 'OP01-LEAD',
    name: 'Test Leader',
    cardType: 'leader',
    colors: ['red'],
    life: 5,
    cost: null,
    power: 5000,
    counter: null,
    ...overrides,
  });
}

function makeDeck(overrides: Partial<DeckList> = {}): DeckList {
  return {
    id: 'test-deck',
    name: 'Test Deck',
    game: 'onepiece',
    packId: 'test-pack',
    leaderId: 'OP01-LEAD',
    cards: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeLookup(...cards: EnrichedCard[]): Map<string, EnrichedCard> {
  return new Map(cards.map((c) => [c.id, c]));
}

// Create a valid 50-card deck (all red characters)
function makeValidDeck(): { deck: DeckList; lookup: Map<string, EnrichedCard> } {
  const leader = makeLeader();
  const cards: Record<string, number> = {};
  const enrichedCards: EnrichedCard[] = [leader];

  // Create 13 unique cards with 4 copies each = 52 cards; we only use 50
  for (let i = 1; i <= 13; i++) {
    const id = `OP01-${String(i).padStart(3, '0')}`;
    cards[id] = i <= 12 ? 4 : 2; // 12*4 + 1*2 = 50
    enrichedCards.push(makeCard({ id, name: `Card ${i}` }));
  }

  return {
    deck: makeDeck({ cards }),
    lookup: makeLookup(...enrichedCards),
  };
}

// --- Tests ---

describe('validateDeck', () => {
  it('validates a valid 50-card deck', () => {
    const { deck, lookup } = makeValidDeck();
    const result = validateDeck(deck, lookup);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.totalCards).toBe(50);
    expect(result.hasLeader).toBe(true);
  });

  it('fails when no leader is set', () => {
    const { deck, lookup } = makeValidDeck();
    deck.leaderId = '';
    const result = validateDeck(deck, lookup);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.type === 'no-leader')).toBe(true);
  });

  it('fails when leader is not found in lookup', () => {
    const { deck, lookup } = makeValidDeck();
    deck.leaderId = 'UNKNOWN';
    const result = validateDeck(deck, lookup);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.type === 'no-leader')).toBe(true);
  });

  it('fails when leader card is not a leader type', () => {
    const leader = makeCard({ id: 'OP01-LEAD', cardType: 'character' });
    const lookup = makeLookup(leader);
    const deck = makeDeck({ leaderId: 'OP01-LEAD', cards: {} });
    const result = validateDeck(deck, lookup);
    expect(result.errors.some((e) => e.type === 'no-leader')).toBe(true);
  });

  it('fails when deck has fewer than 50 cards', () => {
    const leader = makeLeader();
    const c1 = makeCard({ id: 'OP01-001' });
    const deck = makeDeck({ cards: { 'OP01-001': 2 } });
    const result = validateDeck(deck, makeLookup(leader, c1));
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.type === 'wrong-deck-size')).toBe(true);
  });

  it('fails when deck has more than 50 cards', () => {
    const { deck, lookup } = makeValidDeck();
    // Add one extra card
    deck.cards['OP01-013'] = 3; // Was 2, now 3 => total 51
    const result = validateDeck(deck, lookup);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.type === 'wrong-deck-size')).toBe(true);
  });

  it('fails when a card exceeds 4 copies', () => {
    const leader = makeLeader();
    const c1 = makeCard({ id: 'OP01-001' });
    const deck = makeDeck({ cards: { 'OP01-001': 5 } });
    const result = validateDeck(deck, makeLookup(leader, c1));
    expect(result.errors.some((e) => e.type === 'over-copy-limit')).toBe(true);
  });

  it('fails when a card does not match leader color', () => {
    const leader = makeLeader({ colors: ['red'] });
    const greenCard = makeCard({ id: 'OP01-001', colors: ['green'] });
    const deck = makeDeck({ cards: { 'OP01-001': 4 } });
    const result = validateDeck(deck, makeLookup(leader, greenCard));
    expect(result.errors.some((e) => e.type === 'color-mismatch')).toBe(true);
  });

  it('passes when a multi-color card shares at least one leader color', () => {
    const leader = makeLeader({ colors: ['red', 'green'] });
    const card = makeCard({ id: 'OP01-001', colors: ['green', 'blue'] });
    const lookup = makeLookup(leader, card);
    const deck = makeDeck({ cards: { 'OP01-001': 4 } });
    const result = validateDeck(deck, lookup);
    // Should not have color mismatch (will have wrong-deck-size though)
    expect(result.errors.some((e) => e.type === 'color-mismatch')).toBe(false);
  });

  it('warns when counter count is low', () => {
    const leader = makeLeader();
    const cards: Record<string, number> = {};
    const enrichedCards: EnrichedCard[] = [leader];

    // Create 50 cards with no counter
    for (let i = 1; i <= 13; i++) {
      const id = `OP01-${String(i).padStart(3, '0')}`;
      cards[id] = i <= 12 ? 4 : 2;
      enrichedCards.push(makeCard({ id, counter: null }));
    }

    const deck = makeDeck({ cards });
    const result = validateDeck(deck, makeLookup(...enrichedCards));
    expect(result.warnings.some((w) => w.type === 'low-counter-count')).toBe(true);
  });
});

describe('canAddCard', () => {
  it('returns null when card can be added', () => {
    const leader = makeLeader({ colors: ['red'] });
    const card = makeCard({ colors: ['red'] });
    const deck = makeDeck({ cards: {} });
    expect(canAddCard(deck, card.id, card, leader)).toBeNull();
  });

  it('rejects when copy limit is reached', () => {
    const card = makeCard();
    const deck = makeDeck({ cards: { [card.id]: 4 } });
    expect(canAddCard(deck, card.id, card, null)).not.toBeNull();
  });

  it('rejects when card color does not match leader', () => {
    const leader = makeLeader({ colors: ['red'] });
    const card = makeCard({ colors: ['blue'] });
    const deck = makeDeck({ cards: {} });
    expect(canAddCard(deck, card.id, card, leader)).not.toBeNull();
  });

  it('rejects leader cards as regular deck cards', () => {
    const card = makeCard({ cardType: 'leader' });
    const deck = makeDeck({ cards: {} });
    expect(canAddCard(deck, card.id, card, null)).not.toBeNull();
  });
});
