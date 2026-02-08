/**
 * Deck Serialization — YAML/TOML import/export + IPFS publish
 *
 * Converts DeckList to/from portable text formats for sharing.
 */

import yaml from 'js-yaml';
import * as TOML from 'smol-toml';
import type { DeckList, DeckListExport } from './types';

// =============================================================================
// Export
// =============================================================================

/** Convert a DeckList to the portable export format. */
function toExport(deck: DeckList): DeckListExport {
  return {
    name: deck.name,
    game: deck.game,
    pack: deck.packId,
    leader: deck.leaderId,
    cards: { ...deck.cards },
  };
}

/** Serialize a deck to YAML. */
export function exportToYaml(deck: DeckList): string {
  const data = toExport(deck);
  return yaml.dump(data, {
    sortKeys: false,
    lineWidth: -1,
    quotingType: '"',
  });
}

/** Serialize a deck to TOML. */
export function exportToToml(deck: DeckList): string {
  const data = toExport(deck);
  return TOML.stringify(data as unknown as Record<string, unknown>);
}

// =============================================================================
// Import
// =============================================================================

/** Parse a YAML deck list string. */
export function importFromYaml(text: string): DeckListExport {
  const raw = yaml.load(text);
  return validateImport(raw);
}

/** Parse a TOML deck list string. */
export function importFromToml(text: string): DeckListExport {
  const raw = TOML.parse(text);
  return validateImport(raw);
}

/** Auto-detect format (YAML or TOML) and parse. */
export function importFromText(text: string): DeckListExport {
  const trimmed = text.trim();

  // TOML uses [section] headers and key = value syntax
  // YAML uses key: value syntax
  // Try TOML first if it looks like TOML
  if (trimmed.includes('[cards]') || trimmed.match(/^\w+\s*=/m)) {
    try {
      return importFromToml(trimmed);
    } catch {
      // Fall through to YAML
    }
  }

  return importFromYaml(trimmed);
}

/** Validate and normalize an imported deck object. */
function validateImport(raw: unknown): DeckListExport {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid deck list: expected an object');
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.leader || typeof obj.leader !== 'string') {
    throw new Error('Invalid deck list: missing or invalid "leader" field');
  }

  if (!obj.cards || typeof obj.cards !== 'object') {
    throw new Error('Invalid deck list: missing or invalid "cards" field');
  }

  // Normalize cards: ensure all values are positive integers
  const cards: Record<string, number> = {};
  for (const [cardId, qty] of Object.entries(obj.cards as Record<string, unknown>)) {
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid quantity for card "${cardId}": ${qty}`);
    }
    cards[cardId] = n;
  }

  return {
    name: typeof obj.name === 'string' ? obj.name : 'Imported Deck',
    game: 'onepiece',
    pack: typeof obj.pack === 'string' ? obj.pack : '',
    leader: obj.leader as string,
    cards,
  };
}

/**
 * Convert a DeckListExport to a full DeckList (for saving after import).
 */
export function exportToDeckList(
  imported: DeckListExport,
  packId: string,
): DeckList {
  return {
    id: crypto.randomUUID(),
    name: imported.name,
    game: 'onepiece',
    packId: imported.pack || packId,
    leaderId: imported.leader,
    cards: imported.cards,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// =============================================================================
// File I/O Helpers
// =============================================================================

/** Trigger a browser file download with the given content. */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read a File object as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
