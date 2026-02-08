/**
 * Deck Validation — One Piece TCG Tournament Rules
 *
 * Validates deck lists against official tournament rules:
 * - Exactly 1 leader card
 * - Exactly 50 non-leader cards
 * - Max 4 copies of any card (by card number)
 * - All non-leader cards must match at least one leader color
 * - DON!! deck (10) auto-added
 */

import type {
  DeckList,
  DeckValidationResult,
  DeckValidationError,
  DeckValidationWarning,
  EnrichedCard,
} from './types';

const REQUIRED_DECK_SIZE = 50;
const MAX_COPIES = 4;

/**
 * Validate a deck against One Piece TCG tournament rules.
 *
 * @param deck - The deck list to validate
 * @param cardLookup - Map of cardId → enriched card data (from the asset pack)
 */
export function validateDeck(
  deck: DeckList,
  cardLookup: Map<string, EnrichedCard>,
): DeckValidationResult {
  const errors: DeckValidationError[] = [];
  const warnings: DeckValidationWarning[] = [];

  // --- Leader validation ---
  const leader = deck.leaderId ? cardLookup.get(deck.leaderId) : null;
  const hasLeader = !!leader;

  if (!deck.leaderId) {
    errors.push({
      type: 'no-leader',
      message: 'A leader card is required.',
    });
  } else if (!leader) {
    errors.push({
      type: 'no-leader',
      message: `Leader card "${deck.leaderId}" not found in asset pack.`,
      cardIds: [deck.leaderId],
    });
  } else if (leader.cardType !== 'leader') {
    errors.push({
      type: 'no-leader',
      message: `"${leader.name}" is not a leader card (type: ${leader.cardType}).`,
      cardIds: [deck.leaderId],
    });
  }

  // --- Deck size ---
  const totalCards = Object.values(deck.cards).reduce((sum, qty) => sum + qty, 0);

  if (totalCards !== REQUIRED_DECK_SIZE) {
    errors.push({
      type: 'wrong-deck-size',
      message: `Deck must contain exactly ${REQUIRED_DECK_SIZE} cards (currently ${totalCards}).`,
    });
  }

  // --- Copy limit ---
  for (const [cardId, qty] of Object.entries(deck.cards)) {
    if (qty > MAX_COPIES) {
      const card = cardLookup.get(cardId);
      errors.push({
        type: 'over-copy-limit',
        message: `"${card?.name ?? cardId}" has ${qty} copies (max ${MAX_COPIES}).`,
        cardIds: [cardId],
      });
    }
  }

  // --- Color matching ---
  if (leader && leader.colors.length > 0) {
    const leaderColors = new Set(leader.colors);
    const mismatchedCards: string[] = [];

    for (const cardId of Object.keys(deck.cards)) {
      const card = cardLookup.get(cardId);
      if (!card) continue;

      // Check if at least one of the card's colors matches a leader color
      const cardColors = card.colors;
      if (cardColors.length === 0) continue; // Cards without color (DON??) are fine

      const hasMatch = cardColors.some((c) => leaderColors.has(c));
      if (!hasMatch) {
        mismatchedCards.push(cardId);
      }
    }

    if (mismatchedCards.length > 0) {
      const names = mismatchedCards
        .slice(0, 5)
        .map((id) => cardLookup.get(id)?.name ?? id)
        .join(', ');
      const suffix = mismatchedCards.length > 5
        ? ` and ${mismatchedCards.length - 5} more`
        : '';
      errors.push({
        type: 'color-mismatch',
        message: `${mismatchedCards.length} card(s) don't match leader color(s) [${[...leaderColors].join(', ')}]: ${names}${suffix}`,
        cardIds: mismatchedCards,
      });
    }
  }

  // --- Warnings (non-blocking) ---
  if (totalCards > 0 && leader) {
    // Low counter count warning
    let counterCount = 0;
    for (const [cardId, qty] of Object.entries(deck.cards)) {
      const card = cardLookup.get(cardId);
      if (card?.counter != null && card.counter > 0) {
        counterCount += qty;
      }
    }
    if (counterCount < 10 && totalCards >= 30) {
      warnings.push({
        type: 'low-counter-count',
        message: `Only ${counterCount} cards have counter values. Consider adding more for defense.`,
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    totalCards,
    hasLeader,
  };
}

/**
 * Check if a specific card can be added to the deck.
 * Returns null if ok, or an error message if not.
 */
export function canAddCard(
  deck: DeckList,
  cardId: string,
  card: EnrichedCard,
  leaderCard: EnrichedCard | null,
): string | null {
  // Check copy limit
  const currentQty = deck.cards[cardId] ?? 0;
  if (currentQty >= MAX_COPIES) {
    return `Maximum ${MAX_COPIES} copies of "${card.name}" allowed.`;
  }

  // Check color match against leader
  if (leaderCard && leaderCard.colors.length > 0 && card.colors.length > 0) {
    const leaderColors = new Set(leaderCard.colors);
    if (!card.colors.some((c) => leaderColors.has(c))) {
      return `"${card.name}" (${card.colors.join('/')}) doesn't match leader color(s) [${leaderCard.colors.join(', ')}].`;
    }
  }

  // Check if trying to add a leader as a regular card
  if (card.cardType === 'leader') {
    return 'Leader cards go in the leader slot, not the main deck.';
  }

  return null;
}
