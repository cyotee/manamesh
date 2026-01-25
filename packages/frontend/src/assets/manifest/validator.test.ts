import { describe, expect, it } from 'vitest';
import {
  checkDuplicateIds,
  validateCardEntry,
  validateManifest,
  validateSetReference,
} from './validator';

describe('validateManifest', () => {
  it('validates a minimal valid manifest', () => {
    const manifest = {
      name: 'Test Pack',
      version: '1.0.0',
      game: 'poker',
    };

    const errors = validateManifest(manifest);
    expect(errors).toEqual([]);
  });

  it('validates a manifest with cards', () => {
    const manifest = {
      name: 'Test Pack',
      version: '1.0.0',
      game: 'war',
      cards: [
        { id: 'ace-spades', name: 'Ace of Spades', front: 'cards/AS.png' },
        {
          id: 'king-hearts',
          name: 'King of Hearts',
          front: 'cards/KH.png',
          back: 'cards/back.png',
        },
      ],
    };

    const errors = validateManifest(manifest);
    expect(errors).toEqual([]);
  });

  it('validates a manifest with sets', () => {
    const manifest = {
      name: 'MTG Collection',
      version: '1.0.0',
      game: 'mtg',
      sets: [
        { name: 'Alpha', path: 'sets/alpha' },
        { name: 'Beta', path: 'sets/beta' },
      ],
    };

    const errors = validateManifest(manifest);
    expect(errors).toEqual([]);
  });

  it('rejects non-object values', () => {
    expect(validateManifest(null)).toHaveLength(1);
    expect(validateManifest(undefined)).toHaveLength(1);
    expect(validateManifest('string')).toHaveLength(1);
    expect(validateManifest(123)).toHaveLength(1);
    expect(validateManifest([])).toHaveLength(1);
  });

  it('reports missing required fields', () => {
    const errors = validateManifest({});
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.path)).toEqual(['name', 'version', 'game']);
    expect(errors.every((e) => e.code === 'MISSING_FIELD')).toBe(true);
  });

  it('reports empty string values', () => {
    const manifest = {
      name: '',
      version: '1.0.0',
      game: 'poker',
    };

    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('name');
    expect(errors[0].code).toBe('EMPTY_VALUE');
  });

  it('reports wrong types for required fields', () => {
    const manifest = {
      name: 123,
      version: { major: 1 },
      game: ['poker'],
    };

    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.code === 'INVALID_TYPE')).toBe(true);
  });

  it('reports cards not being an array', () => {
    const manifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: 'not an array',
    };

    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('cards');
    expect(errors[0].code).toBe('INVALID_TYPE');
  });

  it('reports sets not being an array', () => {
    const manifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      sets: { alpha: 'sets/alpha' },
    };

    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('sets');
    expect(errors[0].code).toBe('INVALID_TYPE');
  });

  it('validates card entries in cards array', () => {
    const manifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: [{ id: 'valid', name: 'Valid Card', front: 'card.png' }, {}],
    };

    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.path.startsWith('cards[1]'))).toBe(true);
  });

  it('detects duplicate card IDs', () => {
    const manifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: [
        { id: 'ace', name: 'Ace 1', front: 'a1.png' },
        { id: 'king', name: 'King', front: 'k.png' },
        { id: 'ace', name: 'Ace 2', front: 'a2.png' },
      ],
    };

    const errors = validateManifest(manifest);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('DUPLICATE_ID');
    expect(errors[0].path).toBe('cards[2].id');
  });
});

describe('validateCardEntry', () => {
  it('validates a minimal valid card', () => {
    const card = {
      id: 'ace-spades',
      name: 'Ace of Spades',
      front: 'cards/AS.png',
    };

    const errors = validateCardEntry(card, 0);
    expect(errors).toEqual([]);
  });

  it('validates a card with all fields', () => {
    const card = {
      id: 'ace-spades',
      name: 'Ace of Spades',
      front: 'cards/AS.png',
      back: 'cards/back.png',
      metadata: { suit: 'spades', value: 14 },
    };

    const errors = validateCardEntry(card, 0);
    expect(errors).toEqual([]);
  });

  it('rejects non-object values', () => {
    const errors = validateCardEntry('not an object', 0);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('INVALID_TYPE');
  });

  it('reports missing required fields', () => {
    const errors = validateCardEntry({}, 0);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.path)).toEqual([
      'cards[0].id',
      'cards[0].name',
      'cards[0].front',
    ]);
  });

  it('reports empty back value', () => {
    const card = {
      id: 'ace',
      name: 'Ace',
      front: 'ace.png',
      back: '',
    };

    const errors = validateCardEntry(card, 5);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('cards[5].back');
    expect(errors[0].code).toBe('EMPTY_VALUE');
  });

  it('reports invalid metadata type', () => {
    const card = {
      id: 'ace',
      name: 'Ace',
      front: 'ace.png',
      metadata: 'not an object',
    };

    const errors = validateCardEntry(card, 0);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('cards[0].metadata');
    expect(errors[0].code).toBe('INVALID_TYPE');
  });
});

describe('validateSetReference', () => {
  it('validates a valid set reference', () => {
    const set = {
      name: 'Alpha Edition',
      path: 'sets/alpha',
    };

    const errors = validateSetReference(set, 0);
    expect(errors).toEqual([]);
  });

  it('rejects non-object values', () => {
    const errors = validateSetReference(['alpha', 'sets/alpha'], 0);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('INVALID_TYPE');
  });

  it('reports missing required fields', () => {
    const errors = validateSetReference({}, 2);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.path)).toEqual(['sets[2].name', 'sets[2].path']);
  });
});

describe('checkDuplicateIds', () => {
  it('returns empty for unique IDs', () => {
    const cards = [
      { id: 'a', name: 'A', front: 'a.png' },
      { id: 'b', name: 'B', front: 'b.png' },
      { id: 'c', name: 'C', front: 'c.png' },
    ];

    const errors = checkDuplicateIds(cards);
    expect(errors).toEqual([]);
  });

  it('detects single duplicate', () => {
    const cards = [
      { id: 'a', name: 'A1', front: 'a1.png' },
      { id: 'b', name: 'B', front: 'b.png' },
      { id: 'a', name: 'A2', front: 'a2.png' },
    ];

    const errors = checkDuplicateIds(cards);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('cards[2].id');
    expect(errors[0].message).toContain('cards[0]');
  });

  it('detects multiple duplicates', () => {
    const cards = [
      { id: 'a', name: 'A1', front: 'a1.png' },
      { id: 'a', name: 'A2', front: 'a2.png' },
      { id: 'a', name: 'A3', front: 'a3.png' },
    ];

    const errors = checkDuplicateIds(cards);
    expect(errors).toHaveLength(2);
  });
});
