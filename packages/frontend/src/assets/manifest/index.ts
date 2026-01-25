/**
 * Asset Pack Manifest Module
 *
 * Exports types and functions for parsing asset pack manifest files.
 */

// Types
export type {
  AssetPackManifest,
  CardManifestEntry,
  GameType,
  ManifestLoader,
  ManifestResult,
  Result,
  SetReference,
  ValidationError,
  ValidationErrorCode,
} from './types';

// Parser functions
export {
  findCardById,
  getAllCardIds,
  parseManifest,
  parseManifestString,
  resolveNestedManifests,
} from './parser';

// Validator functions
export {
  checkDuplicateIds,
  validateCardEntry,
  validateManifest,
  validateSetReference,
} from './validator';
