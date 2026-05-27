/**
 * Shared crypto utilities for game modules.
 * These functions are identical across war, gofish, onepiece, and poker modules.
 */

import { sha256Hex } from "@manamesh/crypto";

// Minimal state interface all setup-sequenced modules satisfy.
interface SetupPlayerState {
  playerOrder: string[];
  setupPlayerIndex: number;
}

/**
 * Return the player whose turn it is during the sequential setup phase
 * (key exchange → encrypt → shuffle).
 */
export function getCurrentSetupPlayer<S extends SetupPlayerState>(
  state: S,
): string {
  return state.playerOrder[state.setupPlayerIndex];
}

/**
 * Advance to the next setup player. Returns true once all players have acted.
 */
export function advanceSetupPlayer<S extends SetupPlayerState>(
  state: S,
): boolean {
  state.setupPlayerIndex++;
  return state.setupPlayerIndex >= state.playerOrder.length;
}

/**
 * Reset the setup player index at the start of a new sequential phase.
 */
export function resetSetupPlayer<S extends SetupPlayerState>(state: S): void {
  state.setupPlayerIndex = 0;
}

/**
 * Scan the card-point lookup table for the card ID whose curve point matches.
 * O(n) — adequate for a 52-card deck; replace with an inverted Map for larger sets.
 */
export function lookupCardIdFromPoint(
  cardPointLookup: Record<string, string>,
  point: string,
): string | null {
  for (const [cardId, cardPoint] of Object.entries(cardPointLookup)) {
    if (cardPoint === point) return cardId;
  }
  return null;
}

function isHex(s: string): boolean {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s);
}

/**
 * Deterministic Fisher-Yates shuffle driven by a seed hex string.
 * Reproducible across all players when the seed is derived from a
 * commit-reveal protocol, ensuring no single player can bias the order.
 */
export function deterministicShuffle<T>(arr: T[], seedHex: string): T[] {
  const out = arr.slice();
  const len = out.length;
  if (len <= 1) return out;
  if (!isHex(seedHex) || seedHex.length === 0) return out;

  let counter = 0;
  const nextU32 = (): number => {
    const bytes = new TextEncoder().encode(`${seedHex}:${counter++}`);
    const hex = sha256Hex(bytes);
    return parseInt(hex.slice(0, 8), 16) >>> 0;
  };

  for (let i = len - 1; i > 0; i--) {
    const j = nextU32() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}
