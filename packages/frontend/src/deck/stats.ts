/**
 * Deck Statistics Calculator
 *
 * Pure functions that compute deck composition statistics
 * from a deck list and card lookup table.
 */

import type { DeckList, DeckStats, EnrichedCard } from './types';

/**
 * Calculate deck statistics from a deck list.
 */
export function calculateDeckStats(
  deck: DeckList,
  cardLookup: Map<string, EnrichedCard>,
): DeckStats {
  const costCurve: Record<number, number> = {};
  const colorDistribution: Record<string, number> = {};
  const typeBreakdown: Record<string, number> = {};
  const powerDistribution: Record<number, number> = {};

  let totalCards = 0;
  let totalCost = 0;
  let costCount = 0;
  let withCounter = 0;
  let withoutCounter = 0;
  let totalCounter = 0;

  for (const [cardId, qty] of Object.entries(deck.cards)) {
    const card = cardLookup.get(cardId);
    if (!card) continue;

    totalCards += qty;

    // Cost curve
    if (card.cost != null) {
      const costKey = Math.min(card.cost, 10); // Bucket 10+
      costCurve[costKey] = (costCurve[costKey] ?? 0) + qty;
      totalCost += card.cost * qty;
      costCount += qty;
    }

    // Color distribution
    for (const color of card.colors) {
      colorDistribution[color] = (colorDistribution[color] ?? 0) + qty;
    }

    // Type breakdown
    const type = card.cardType || 'unknown';
    typeBreakdown[type] = (typeBreakdown[type] ?? 0) + qty;

    // Counter distribution
    if (card.counter != null && card.counter > 0) {
      withCounter += qty;
      totalCounter += card.counter * qty;
    } else {
      withoutCounter += qty;
    }

    // Power distribution (characters only)
    if (card.power != null && card.cardType === 'character') {
      const powerKey = card.power;
      powerDistribution[powerKey] = (powerDistribution[powerKey] ?? 0) + qty;
    }
  }

  return {
    totalCards,
    costCurve,
    colorDistribution,
    typeBreakdown,
    avgCost: costCount > 0 ? totalCost / costCount : 0,
    counterDistribution: {
      withCounter,
      withoutCounter,
      avgCounter: withCounter > 0 ? totalCounter / withCounter : 0,
    },
    powerDistribution,
  };
}
