/**
 * useDeckValidation Hook
 *
 * Reactive deck validation that recomputes whenever
 * the deck or card lookup changes.
 */

import { useMemo } from 'react';
import type { DeckList, DeckValidationResult, EnrichedCard } from '../deck/types';
import { validateDeck } from '../deck/validation';

export interface UseDeckValidationResult extends DeckValidationResult {
  /** CSS-friendly status: 'valid' | 'incomplete' | 'error' */
  status: 'valid' | 'incomplete' | 'error';
}

export function useDeckValidation(
  deck: DeckList,
  cardLookup: Map<string, EnrichedCard>,
): UseDeckValidationResult {
  return useMemo(() => {
    const result = validateDeck(deck, cardLookup);

    let status: 'valid' | 'incomplete' | 'error';
    if (result.isValid) {
      status = 'valid';
    } else if (result.errors.length > 0 && result.totalCards > 0) {
      status = 'error';
    } else {
      status = 'incomplete';
    }

    return { ...result, status };
  }, [deck, cardLookup]);
}
