/**
 * Deck Serialization Tests — YAML/TOML round-trip
 */

import { describe, it, expect } from 'vitest';
import {
  exportToYaml,
  exportToToml,
  importFromYaml,
  importFromToml,
  importFromText,
  exportToDeckList,
} from './serialization';
import type { DeckList } from './types';

function makeDeck(): DeckList {
  return {
    id: 'test-deck-id',
    name: 'Red Luffy Aggro',
    game: 'onepiece',
    packId: 'ipfs:QmTest',
    leaderId: 'OP01-001',
    cards: {
      'OP01-004': 4,
      'OP01-006': 4,
      'OP01-008': 3,
    },
    createdAt: 1000,
    updatedAt: 2000,
  };
}

describe('YAML serialization', () => {
  it('round-trips a deck through YAML', () => {
    const deck = makeDeck();
    const yaml = exportToYaml(deck);
    const imported = importFromYaml(yaml);

    expect(imported.name).toBe('Red Luffy Aggro');
    expect(imported.leader).toBe('OP01-001');
    expect(imported.cards['OP01-004']).toBe(4);
    expect(imported.cards['OP01-006']).toBe(4);
    expect(imported.cards['OP01-008']).toBe(3);
  });

  it('preserves game and pack fields', () => {
    const deck = makeDeck();
    const yaml = exportToYaml(deck);
    const imported = importFromYaml(yaml);

    expect(imported.game).toBe('onepiece');
    expect(imported.pack).toBe('ipfs:QmTest');
  });
});

describe('TOML serialization', () => {
  it('round-trips a deck through TOML', () => {
    const deck = makeDeck();
    const toml = exportToToml(deck);
    const imported = importFromToml(toml);

    expect(imported.name).toBe('Red Luffy Aggro');
    expect(imported.leader).toBe('OP01-001');
    expect(imported.cards['OP01-004']).toBe(4);
    expect(imported.cards['OP01-008']).toBe(3);
  });
});

describe('importFromText', () => {
  it('auto-detects YAML format', () => {
    const yaml = `name: "Test Deck"\nleader: OP01-001\ncards:\n  OP01-004: 4\n  OP01-006: 2\n`;
    const imported = importFromText(yaml);
    expect(imported.leader).toBe('OP01-001');
    expect(imported.cards['OP01-004']).toBe(4);
  });

  it('auto-detects TOML format', () => {
    const toml = `name = "Test Deck"\nleader = "OP01-001"\n\n[cards]\nOP01-004 = 4\nOP01-006 = 2\n`;
    const imported = importFromText(toml);
    expect(imported.leader).toBe('OP01-001');
    expect(imported.cards['OP01-004']).toBe(4);
  });

  it('falls back to YAML on ambiguous input', () => {
    // YAML is the default if TOML detection fails
    const yaml = `leader: OP01-001\ncards:\n  OP01-004: 4\n`;
    const imported = importFromText(yaml);
    expect(imported.leader).toBe('OP01-001');
  });
});

describe('validation', () => {
  it('rejects input without leader field', () => {
    expect(() => importFromYaml('cards:\n  OP01-004: 4\n')).toThrow('leader');
  });

  it('rejects input without cards field', () => {
    expect(() => importFromYaml('leader: OP01-001\n')).toThrow('cards');
  });

  it('rejects non-integer quantities', () => {
    expect(() =>
      importFromYaml('leader: OP01-001\ncards:\n  OP01-004: 1.5\n'),
    ).toThrow('Invalid quantity');
  });

  it('rejects zero quantities', () => {
    expect(() =>
      importFromYaml('leader: OP01-001\ncards:\n  OP01-004: 0\n'),
    ).toThrow('Invalid quantity');
  });

  it('rejects negative quantities', () => {
    expect(() =>
      importFromYaml('leader: OP01-001\ncards:\n  OP01-004: -2\n'),
    ).toThrow('Invalid quantity');
  });

  it('defaults missing name', () => {
    const imported = importFromYaml('leader: OP01-001\ncards:\n  OP01-004: 4\n');
    expect(imported.name).toBe('Imported Deck');
  });
});

describe('exportToDeckList', () => {
  it('converts an imported export to a full DeckList', () => {
    const imported = importFromYaml(
      'name: "Test"\nleader: OP01-001\ncards:\n  OP01-004: 4\n',
    );
    const deckList = exportToDeckList(imported, 'test-pack');

    expect(deckList.id).toBeTruthy(); // UUID generated
    expect(deckList.name).toBe('Test');
    expect(deckList.game).toBe('onepiece');
    expect(deckList.leaderId).toBe('OP01-001');
    expect(deckList.cards['OP01-004']).toBe(4);
    expect(deckList.createdAt).toBeGreaterThan(0);
  });
});
