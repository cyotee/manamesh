/**
 * Deck Types Tests — enrichCard function
 */

import { describe, it, expect } from 'vitest';
import { enrichCard } from './types';
import type { CardManifestEntry } from '../assets/manifest/types';

function makeEntry(overrides: Partial<CardManifestEntry> = {}): CardManifestEntry {
  return {
    id: 'OP01-001',
    name: 'Monkey D. Luffy',
    front: 'cards/OP01-001/front.png',
    metadata: {
      colors: ['Red'],
      cardType: 'character',
      cost: 5,
      power: 6000,
      counter: 1000,
      rarity: 'SR',
      set: 'OP01',
      text: 'Rush',
      traits: ['Straw Hat Crew', 'Supernovas'],
      life: null,
    },
    ...overrides,
  };
}

describe('enrichCard', () => {
  it('extracts all metadata fields', () => {
    const card = enrichCard(makeEntry());
    expect(card.colors).toEqual(['red']);
    expect(card.cardType).toBe('character');
    expect(card.cost).toBe(5);
    expect(card.power).toBe(6000);
    expect(card.counter).toBe(1000);
    expect(card.rarity).toBe('SR');
    expect(card.set).toBe('OP01');
    expect(card.effectText).toBe('Rush');
    expect(card.traits).toEqual(['Straw Hat Crew', 'Supernovas']);
  });

  it('lowercases colors', () => {
    const card = enrichCard(
      makeEntry({ metadata: { colors: ['Red', 'GREEN'] } }),
    );
    expect(card.colors).toEqual(['red', 'green']);
  });

  it('lowercases card type', () => {
    const card = enrichCard(
      makeEntry({ metadata: { cardType: 'Leader' } }),
    );
    expect(card.cardType).toBe('leader');
  });

  it('handles missing metadata gracefully', () => {
    const card = enrichCard({ id: 'X', name: 'X', front: 'x.png' });
    expect(card.colors).toEqual([]);
    expect(card.cardType).toBe('unknown');
    expect(card.cost).toBeNull();
    expect(card.power).toBeNull();
    expect(card.counter).toBeNull();
    expect(card.rarity).toBe('C');
    expect(card.effectText).toBe('');
    expect(card.traits).toEqual([]);
    expect(card.life).toBeNull();
  });

  it('handles alternate metadata field names', () => {
    const card = enrichCard(
      makeEntry({
        metadata: {
          color: ['Blue'],
          card_type: 'event',
          effectText: 'Draw 2',
        },
      }),
    );
    expect(card.colors).toEqual(['blue']);
    expect(card.cardType).toBe('event');
    expect(card.effectText).toBe('Draw 2');
  });

  it('derives set from card ID if not in metadata', () => {
    const card = enrichCard(
      makeEntry({ id: 'OP03-042', metadata: {} }),
    );
    expect(card.set).toBe('OP03'); // strips trailing -042 from id
  });

  it('preserves base CardManifestEntry fields', () => {
    const card = enrichCard(makeEntry());
    expect(card.id).toBe('OP01-001');
    expect(card.name).toBe('Monkey D. Luffy');
    expect(card.front).toBe('cards/OP01-001/front.png');
  });
});
