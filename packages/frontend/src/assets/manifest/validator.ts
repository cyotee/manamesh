/**
 * Asset Pack Manifest Validator
 *
 * Validates manifest objects against the expected schema.
 * Returns a list of validation errors (empty if valid).
 */

import type {
  AssetPackManifest,
  CardManifestEntry,
  SetReference,
  ValidationError,
  ValidationErrorCode,
} from './types';

/**
 * Validate an unknown value as an AssetPackManifest.
 * Returns an array of validation errors (empty if valid).
 */
export function validateManifest(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isObject(value)) {
    errors.push(error('', 'Manifest must be an object', 'INVALID_TYPE'));
    return errors;
  }

  const manifest = value as Record<string, unknown>;

  // Required string fields
  validateRequiredString(manifest, 'name', errors);
  validateRequiredString(manifest, 'version', errors);
  validateRequiredString(manifest, 'game', errors);

  // Optional cards array
  if ('cards' in manifest && manifest.cards !== undefined) {
    if (!Array.isArray(manifest.cards)) {
      errors.push(error('cards', 'cards must be an array', 'INVALID_TYPE'));
    } else {
      validateCards(manifest.cards, errors);
    }
  }

  // Optional sets array
  if ('sets' in manifest && manifest.sets !== undefined) {
    if (!Array.isArray(manifest.sets)) {
      errors.push(error('sets', 'sets must be an array', 'INVALID_TYPE'));
    } else {
      validateSets(manifest.sets, errors);
    }
  }

  return errors;
}

/**
 * Validate a CardManifestEntry object.
 */
export function validateCardEntry(
  value: unknown,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `cards[${index}]`;

  if (!isObject(value)) {
    errors.push(error(prefix, 'Card entry must be an object', 'INVALID_TYPE'));
    return errors;
  }

  const card = value as Record<string, unknown>;

  // Required fields
  validateRequiredString(card, 'id', errors, prefix);
  validateRequiredString(card, 'name', errors, prefix);
  validateRequiredString(card, 'front', errors, prefix);

  // Optional back field
  if ('back' in card && card.back !== undefined) {
    if (typeof card.back !== 'string') {
      errors.push(
        error(`${prefix}.back`, 'back must be a string', 'INVALID_TYPE')
      );
    } else if (card.back === '') {
      errors.push(
        error(`${prefix}.back`, 'back cannot be empty', 'EMPTY_VALUE')
      );
    }
  }

  // Optional metadata field
  if ('metadata' in card && card.metadata !== undefined) {
    if (!isObject(card.metadata)) {
      errors.push(
        error(`${prefix}.metadata`, 'metadata must be an object', 'INVALID_TYPE')
      );
    }
  }

  return errors;
}

/**
 * Validate a SetReference object.
 */
export function validateSetReference(
  value: unknown,
  index: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `sets[${index}]`;

  if (!isObject(value)) {
    errors.push(error(prefix, 'Set reference must be an object', 'INVALID_TYPE'));
    return errors;
  }

  const set = value as Record<string, unknown>;

  validateRequiredString(set, 'name', errors, prefix);
  validateRequiredString(set, 'path', errors, prefix);

  return errors;
}

/**
 * Check for duplicate card IDs in a manifest.
 */
export function checkDuplicateIds(
  cards: CardManifestEntry[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < cards.length; i++) {
    const id = cards[i].id;
    if (seen.has(id)) {
      errors.push(
        error(
          `cards[${i}].id`,
          `Duplicate card ID "${id}" (first seen at cards[${seen.get(id)}])`,
          'DUPLICATE_ID'
        )
      );
    } else {
      seen.set(id, i);
    }
  }

  return errors;
}

// ============================================================================
// Internal helpers
// ============================================================================

function validateCards(
  cards: unknown[],
  errors: ValidationError[]
): void {
  for (let i = 0; i < cards.length; i++) {
    errors.push(...validateCardEntry(cards[i], i));
  }

  // Check for duplicate IDs if all cards are valid objects
  const validCards = cards.filter(
    (c): c is CardManifestEntry =>
      isObject(c) &&
      typeof (c as Record<string, unknown>).id === 'string'
  );

  if (validCards.length === cards.length) {
    errors.push(...checkDuplicateIds(validCards as CardManifestEntry[]));
  }
}

function validateSets(sets: unknown[], errors: ValidationError[]): void {
  for (let i = 0; i < sets.length; i++) {
    errors.push(...validateSetReference(sets[i], i));
  }
}

function validateRequiredString(
  obj: Record<string, unknown>,
  field: string,
  errors: ValidationError[],
  prefix = ''
): void {
  const path = prefix ? `${prefix}.${field}` : field;

  if (!(field in obj)) {
    errors.push(error(path, `${field} is required`, 'MISSING_FIELD'));
    return;
  }

  const value = obj[field];

  if (typeof value !== 'string') {
    errors.push(error(path, `${field} must be a string`, 'INVALID_TYPE'));
    return;
  }

  if (value === '') {
    errors.push(error(path, `${field} cannot be empty`, 'EMPTY_VALUE'));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function error(
  path: string,
  message: string,
  code: ValidationErrorCode
): ValidationError {
  return { path, message, code };
}
