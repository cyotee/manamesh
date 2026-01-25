import { describe, expect, it, vi } from 'vitest';
import {
  findCardById,
  getAllCardIds,
  parseManifest,
  parseManifestString,
  resolveNestedManifests,
} from './parser';
import type { AssetPackManifest, ManifestLoader } from './types';

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const json = {
      name: 'Test Pack',
      version: '1.0.0',
      game: 'poker',
      cards: [{ id: 'ace', name: 'Ace', front: 'ace.png' }],
    };

    const result = parseManifest(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Test Pack');
      expect(result.value.cards).toHaveLength(1);
    }
  });

  it('returns errors for invalid manifest', () => {
    const result = parseManifest({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns errors for non-object', () => {
    const result = parseManifest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain('object');
    }
  });
});

describe('parseManifestString', () => {
  it('parses valid JSON string', () => {
    const json = JSON.stringify({
      name: 'Test',
      version: '1.0.0',
      game: 'war',
    });

    const result = parseManifestString(json);
    expect(result.ok).toBe(true);
  });

  it('returns error for invalid JSON', () => {
    const result = parseManifestString('{ invalid json }');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain('Failed to parse JSON');
    }
  });

  it('returns error for empty string', () => {
    const result = parseManifestString('');
    expect(result.ok).toBe(false);
  });

  it('validates after parsing', () => {
    const result = parseManifestString('{}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'MISSING_FIELD')).toBe(true);
    }
  });
});

describe('resolveNestedManifests', () => {
  it('returns cards from root manifest', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: [
        { id: 'ace', name: 'Ace', front: 'ace.png' },
        { id: 'king', name: 'King', front: 'king.png' },
      ],
    };

    const loader = vi.fn();
    const cards = await resolveNestedManifests(manifest, loader);

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe('ace');
    expect(cards[1].id).toBe('king');
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads and merges nested manifests', async () => {
    const rootManifest: AssetPackManifest = {
      name: 'MTG Collection',
      version: '1.0.0',
      game: 'mtg',
      sets: [{ name: 'Alpha', path: 'sets/alpha' }],
    };

    const alphaManifest: AssetPackManifest = {
      name: 'Alpha Edition',
      version: '1.0.0',
      game: 'mtg',
      cards: [
        { id: 'lotus', name: 'Black Lotus', front: 'lotus.png' },
        { id: 'mox', name: 'Mox Pearl', front: 'mox.png' },
      ],
    };

    const loader: ManifestLoader = vi.fn().mockResolvedValue(alphaManifest);

    const cards = await resolveNestedManifests(rootManifest, loader);

    expect(loader).toHaveBeenCalledWith('sets/alpha/manifest.json');
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toBe('sets/alpha/lotus.png');
    expect(cards[1].front).toBe('sets/alpha/mox.png');
  });

  it('handles deeply nested manifests', async () => {
    const rootManifest: AssetPackManifest = {
      name: 'Collection',
      version: '1.0.0',
      game: 'mtg',
      sets: [{ name: 'Vintage', path: 'vintage' }],
    };

    const vintageManifest: AssetPackManifest = {
      name: 'Vintage',
      version: '1.0.0',
      game: 'mtg',
      sets: [{ name: 'Alpha', path: 'alpha' }],
    };

    const alphaManifest: AssetPackManifest = {
      name: 'Alpha',
      version: '1.0.0',
      game: 'mtg',
      cards: [{ id: 'lotus', name: 'Black Lotus', front: 'lotus.png' }],
    };

    const loader: ManifestLoader = vi.fn().mockImplementation((path: string) => {
      if (path === 'vintage/manifest.json') {
        return Promise.resolve(vintageManifest);
      }
      if (path === 'vintage/alpha/manifest.json') {
        return Promise.resolve(alphaManifest);
      }
      return Promise.reject(new Error(`Unknown path: ${path}`));
    });

    const cards = await resolveNestedManifests(rootManifest, loader);

    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('vintage/alpha/lotus.png');
  });

  it('combines root cards with nested cards', async () => {
    const rootManifest: AssetPackManifest = {
      name: 'Mixed',
      version: '1.0.0',
      game: 'poker',
      cards: [{ id: 'joker', name: 'Joker', front: 'joker.png' }],
      sets: [{ name: 'Spades', path: 'spades' }],
    };

    const spadesManifest: AssetPackManifest = {
      name: 'Spades',
      version: '1.0.0',
      game: 'poker',
      cards: [{ id: 'ace-spades', name: 'Ace of Spades', front: 'ace.png' }],
    };

    const loader: ManifestLoader = vi.fn().mockResolvedValue(spadesManifest);

    const cards = await resolveNestedManifests(rootManifest, loader);

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe('joker');
    expect(cards[0].front).toBe('joker.png');
    expect(cards[1].id).toBe('ace-spades');
    expect(cards[1].front).toBe('spades/ace.png');
  });

  it('throws on loader error', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'mtg',
      sets: [{ name: 'Missing', path: 'missing' }],
    };

    const loader: ManifestLoader = vi
      .fn()
      .mockRejectedValue(new Error('Not found'));

    await expect(resolveNestedManifests(manifest, loader)).rejects.toThrow(
      'Failed to load manifest'
    );
  });

  it('throws on invalid nested manifest', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'mtg',
      sets: [{ name: 'Invalid', path: 'invalid' }],
    };

    const loader: ManifestLoader = vi.fn().mockResolvedValue({});

    await expect(resolveNestedManifests(manifest, loader)).rejects.toThrow(
      'Invalid manifest'
    );
  });

  it('adjusts back paths correctly', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      sets: [{ name: 'Set', path: 'set' }],
    };

    const setManifest: AssetPackManifest = {
      name: 'Set',
      version: '1.0.0',
      game: 'poker',
      cards: [
        {
          id: 'ace',
          name: 'Ace',
          front: 'ace-front.png',
          back: 'ace-back.png',
        },
      ],
    };

    const loader: ManifestLoader = vi.fn().mockResolvedValue(setManifest);

    const cards = await resolveNestedManifests(manifest, loader);

    expect(cards[0].front).toBe('set/ace-front.png');
    expect(cards[0].back).toBe('set/ace-back.png');
  });
});

describe('getAllCardIds', () => {
  it('returns all IDs from flat manifest', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: [
        { id: 'a', name: 'A', front: 'a.png' },
        { id: 'b', name: 'B', front: 'b.png' },
      ],
    };

    const ids = await getAllCardIds(manifest, vi.fn());
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('findCardById', () => {
  it('finds a card by ID', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: [
        { id: 'ace', name: 'Ace', front: 'ace.png' },
        { id: 'king', name: 'King', front: 'king.png' },
      ],
    };

    const card = await findCardById(manifest, 'king', vi.fn());
    expect(card).toBeDefined();
    expect(card?.name).toBe('King');
  });

  it('returns undefined for missing ID', async () => {
    const manifest: AssetPackManifest = {
      name: 'Test',
      version: '1.0.0',
      game: 'poker',
      cards: [{ id: 'ace', name: 'Ace', front: 'ace.png' }],
    };

    const card = await findCardById(manifest, 'queen', vi.fn());
    expect(card).toBeUndefined();
  });
});
