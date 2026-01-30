/**
 * Standard Playing Cards Asset Pack Configuration
 *
 * CID and metadata for the standard 52-card + jokers pack
 * stored as an IPFS zip archive.
 */

import type { IPFSZipSource } from '../loader/types';

/** IPFS CID for the standard playing cards zip archive */
export const STANDARD_CARDS_CID = 'QmaqKyAHEh75sBYQkVWZ46BZeQ9JxC1E2rRcXkXjkovgqa';

/** Pre-configured source for the standard playing cards pack */
export const STANDARD_CARDS_SOURCE: IPFSZipSource = {
  type: 'ipfs-zip',
  cid: STANDARD_CARDS_CID,
};

/**
 * Mapping from game card IDs (suit-rank format) to manifest card IDs.
 *
 * The manifest may use different ID conventions than the game logic.
 * This mapping bridges them.
 *
 * Both the manifest and the game use the same format: 'suit-rank'
 * e.g., 'clubs-A', 'hearts-K', 'spades-2'
 *
 * If the manifest uses different IDs, update this mapping.
 */
export function gameCardIdToManifestId(gameCardId: string): string {
  // Identity mapping -- both systems use suit-rank format
  return gameCardId;
}

/**
 * Get the card back ID (shared across all cards in a standard deck).
 * This is used to fetch the shared back image.
 */
export const CARD_BACK_ID = '_back';
