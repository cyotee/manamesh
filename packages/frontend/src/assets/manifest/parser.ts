/**
 * Asset Pack Manifest Parser
 *
 * Parses and validates manifest.json files, with support for
 * resolving nested manifests into a flat card list.
 */

import type {
  AssetPackManifest,
  CardManifestEntry,
  ManifestLoader,
  ManifestResult,
  ValidationError,
} from './types';
import { validateManifest } from './validator';

/**
 * Parse and validate a manifest from an unknown JSON value.
 *
 * @param json - The parsed JSON value (from JSON.parse or fetch)
 * @returns Result with validated manifest or validation errors
 */
export function parseManifest(json: unknown): ManifestResult {
  const errors = validateManifest(json);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Type assertion is safe after validation passes
  return { ok: true, value: json as AssetPackManifest };
}

/**
 * Parse a manifest from a JSON string.
 *
 * @param jsonString - The raw JSON string
 * @returns Result with validated manifest or validation errors
 */
export function parseManifestString(jsonString: string): ManifestResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid JSON';
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: `Failed to parse JSON: ${message}`,
          code: 'INVALID_VALUE',
        },
      ],
    };
  }

  return parseManifest(parsed);
}

/**
 * Resolve nested manifests into a flat list of card entries.
 *
 * This function recursively loads set references and collects all cards
 * into a single flat array. Card paths are adjusted to be relative to
 * the root manifest location.
 *
 * @param root - The root manifest to resolve
 * @param loader - Function to load nested manifest JSON by path
 * @param basePath - Base path for the current manifest (for path resolution)
 * @returns Promise resolving to flat array of all cards
 * @throws Error if a nested manifest fails to load or validate
 */
export async function resolveNestedManifests(
  root: AssetPackManifest,
  loader: ManifestLoader,
  basePath = ''
): Promise<CardManifestEntry[]> {
  const cards: CardManifestEntry[] = [];

  // Add direct cards with adjusted paths
  if (root.cards) {
    for (const card of root.cards) {
      cards.push(adjustCardPaths(card, basePath));
    }
  }

  // Recursively load and process set references
  if (root.sets) {
    for (const set of root.sets) {
      const setPath = joinPath(basePath, set.path);
      const manifestPath = joinPath(setPath, 'manifest.json');

      let json: unknown;
      try {
        json = await loader(manifestPath);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        throw new Error(
          `Failed to load manifest at "${manifestPath}": ${message}`
        );
      }

      const result = parseManifest(json);
      if (!result.ok) {
        throw new Error(
          `Invalid manifest at "${manifestPath}": ${formatErrors(result.errors)}`
        );
      }

      // Recursively resolve this nested manifest
      const nestedCards = await resolveNestedManifests(
        result.value,
        loader,
        setPath
      );
      cards.push(...nestedCards);
    }
  }

  return cards;
}

/**
 * Get all card IDs from a manifest (including nested).
 * Useful for checking if a card exists without loading images.
 */
export async function getAllCardIds(
  root: AssetPackManifest,
  loader: ManifestLoader
): Promise<string[]> {
  const cards = await resolveNestedManifests(root, loader);
  return cards.map((card) => card.id);
}

/**
 * Find a card by ID in a manifest (including nested).
 * Returns undefined if not found.
 */
export async function findCardById(
  root: AssetPackManifest,
  cardId: string,
  loader: ManifestLoader
): Promise<CardManifestEntry | undefined> {
  const cards = await resolveNestedManifests(root, loader);
  return cards.find((card) => card.id === cardId);
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Adjust card image paths to be relative to the root manifest.
 */
function adjustCardPaths(
  card: CardManifestEntry,
  basePath: string
): CardManifestEntry {
  if (!basePath) {
    return card;
  }

  return {
    ...card,
    front: joinPath(basePath, card.front),
    back: card.back ? joinPath(basePath, card.back) : undefined,
  };
}

/**
 * Join path segments, handling empty base paths.
 */
function joinPath(base: string, path: string): string {
  if (!base) {
    return path;
  }
  // Normalize slashes and join
  const cleanBase = base.replace(/\/+$/, '');
  const cleanPath = path.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

/**
 * Format validation errors for display.
 */
function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join('; ');
}
