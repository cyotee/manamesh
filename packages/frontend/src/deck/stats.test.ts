/**
 * Deck Statistics Tests
 */

import { describe, it, expect } from 'vitest';
import { calculateDeckStats } from './stats';
import type { DeckList, EnrichedCard } from './types';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    id: 'OP01-001',
    name: 'Test Card',
    front: 'cards/test/front.png',
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

function makeDeck(cards: Record<string, number>): DeckList {
  return {
    id: 'test-deck',
    name: 'Test',
    game: 'onepiece',
    packId: 'test',
    leaderId: '',
    cards,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('calculateDeckStats', () => {
  it('computes empty stats for empty deck', () => {
    const stats = calculateDeckStats(makeDeck({}), new Map());
    expect(stats.totalCards).toBe(0);
    expect(stats.avgCost).toBe(0);
  });

  it('computes total cards', () => {
    const c1 = makeCard({ id: 'C1', cost: 2 });
    const c2 = makeCard({ id: 'C2', cost: 4 });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 4, C2: 3 }), lookup);
    expect(stats.totalCards).toBe(7);
  });

  it('computes cost curve', () => {
    const c1 = makeCard({ id: 'C1', cost: 2 });
    const c2 = makeCard({ id: 'C2', cost: 5 });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 3, C2: 2 }), lookup);
    expect(stats.costCurve[2]).toBe(3);
    expect(stats.costCurve[5]).toBe(2);
  });

  it('buckets cost 10+ together', () => {
    const c1 = makeCard({ id: 'C1', cost: 10 });
    const c2 = makeCard({ id: 'C2', cost: 12 });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 1, C2: 1 }), lookup);
    expect(stats.costCurve[10]).toBe(2);
  });

  it('computes average cost', () => {
    const c1 = makeCard({ id: 'C1', cost: 2 });
    const c2 = makeCard({ id: 'C2', cost: 6 });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 2, C2: 2 }), lookup);
    // (2*2 + 6*2) / 4 = 16/4 = 4
    expect(stats.avgCost).toBe(4);
  });

  it('computes color distribution', () => {
    const c1 = makeCard({ id: 'C1', colors: ['red'] });
    const c2 = makeCard({ id: 'C2', colors: ['green', 'red'] });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 2, C2: 3 }), lookup);
    expect(stats.colorDistribution['red']).toBe(5); // 2 + 3
    expect(stats.colorDistribution['green']).toBe(3);
  });

  it('computes type breakdown', () => {
    const c1 = makeCard({ id: 'C1', cardType: 'character' });
    const c2 = makeCard({ id: 'C2', cardType: 'event' });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 3, C2: 2 }), lookup);
    expect(stats.typeBreakdown['character']).toBe(3);
    expect(stats.typeBreakdown['event']).toBe(2);
  });

  it('computes counter distribution', () => {
    const c1 = makeCard({ id: 'C1', counter: 1000 });
    const c2 = makeCard({ id: 'C2', counter: null });
    const c3 = makeCard({ id: 'C3', counter: 2000 });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
      ['C3', c3],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 2, C2: 1, C3: 1 }), lookup);
    expect(stats.counterDistribution.withCounter).toBe(3);
    expect(stats.counterDistribution.withoutCounter).toBe(1);
    // avg = (1000*2 + 2000*1) / 3 = 4000/3 ≈ 1333.33
    expect(stats.counterDistribution.avgCounter).toBeCloseTo(1333.33, 0);
  });

  it('computes power distribution for characters only', () => {
    const c1 = makeCard({ id: 'C1', cardType: 'character', power: 5000 });
    const c2 = makeCard({ id: 'C2', cardType: 'event', power: 0 });
    const c3 = makeCard({ id: 'C3', cardType: 'character', power: 7000 });
    const lookup = new Map<string, EnrichedCard>([
      ['C1', c1],
      ['C2', c2],
      ['C3', c3],
    ]);

    const stats = calculateDeckStats(makeDeck({ C1: 2, C2: 1, C3: 1 }), lookup);
    expect(stats.powerDistribution[5000]).toBe(2);
    expect(stats.powerDistribution[7000]).toBe(1);
    // Events should not appear in power distribution
    expect(stats.powerDistribution[0]).toBeUndefined();
  });

  it('ignores cards not in lookup', () => {
    const c1 = makeCard({ id: 'C1' });
    const lookup = new Map<string, EnrichedCard>([['C1', c1]]);

    const stats = calculateDeckStats(
      makeDeck({ C1: 2, MISSING: 3 }),
      lookup,
    );
    expect(stats.totalCards).toBe(2);
  });
});
