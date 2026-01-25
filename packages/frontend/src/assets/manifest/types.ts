/**
 * Asset Pack Manifest Types
 *
 * Types for parsing and validating asset pack manifest.json files.
 * Based on the Asset Pack Format specification in the PRD.
 */

/** Supported game types */
export type GameType = 'mtg' | 'lorcana' | 'onepiece' | 'poker' | 'war';

/**
 * Root manifest structure for an asset pack.
 * Contains metadata and references to cards or nested set manifests.
 */
export interface AssetPackManifest {
  /** Display name of the asset pack */
  name: string;
  /** Semantic version string */
  version: string;
  /** Game this pack is for */
  game: GameType | string;
  /** Direct card entries in this manifest */
  cards?: CardManifestEntry[];
  /** References to subdirectory manifests (for organizing by set) */
  sets?: SetReference[];
}

/**
 * Individual card entry in a manifest.
 * Contains paths to card images relative to the manifest location.
 */
export interface CardManifestEntry {
  /** Unique card identifier within the pack */
  id: string;
  /** Display name of the card */
  name: string;
  /** Relative path to front image */
  front: string;
  /** Relative path to back image (optional, uses default if not specified) */
  back?: string;
  /** Game-specific metadata (mana cost, card type, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Reference to a nested manifest in a subdirectory.
 * Used for organizing large packs by set or expansion.
 */
export interface SetReference {
  /** Display name of the set */
  name: string;
  /** Relative path to the subdirectory containing manifest.json */
  path: string;
}

/**
 * Validation error with path to the problematic field.
 */
export interface ValidationError {
  /** JSON path to the field (e.g., "cards[0].id") */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Error code for programmatic handling */
  code: ValidationErrorCode;
}

/** Validation error codes */
export type ValidationErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_TYPE'
  | 'INVALID_VALUE'
  | 'EMPTY_VALUE'
  | 'DUPLICATE_ID';

/**
 * Result type for parse operations.
 * Either success with data or failure with errors.
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; errors: E };

/** Shorthand for manifest parse result */
export type ManifestResult = Result<AssetPackManifest, ValidationError[]>;

/**
 * Loader function type for resolving nested manifests.
 * Takes a relative path and returns the parsed JSON.
 */
export type ManifestLoader = (path: string) => Promise<unknown>;
