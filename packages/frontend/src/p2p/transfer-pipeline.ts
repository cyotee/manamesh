/**
 * Transfer Pipeline — Builds and processes asset pack transfer payloads
 *
 * Handles the actual data preparation for P2P asset sharing:
 * - Sender: reads card images from IndexedDB cache → packages into transferable blob
 * - Receiver: unpacks received blob → stores card images + metadata in IndexedDB
 *
 * Transfer blob format (cards-only mode):
 *   [4 bytes: header length (uint32 BE)]
 *   [header JSON: { cards: Array<{ id, front, back?, frontSize, backSize? }> }]
 *   [card image blobs concatenated in order: front1, back1?, front2, back2?, ...]
 *
 * Transfer blob format (full-pack mode):
 *   The raw zip blob from IndexedDB pack-zips store.
 */

import {
  getCardImage,
  storeCardImage,
  storePackMetadata,
  getPackZip,
  storePackZip,
} from '../assets/loader/cache';
import type { CardManifestEntry } from '../assets/manifest/types';
import type { StoredPackMetadata } from '../assets/loader/types';
import { chunkBlob, type Chunk, type ChunkProgressCallback } from './chunking';
import {
  AssetSharingSession,
  type AssetSharingMessage,
} from './asset-sharing';
import type { AssetSharingChannel } from '../hooks/useAssetSharing';

// ---------------------------------------------------------------------------
// Transfer header (embedded in the blob)
// ---------------------------------------------------------------------------

interface TransferCardEntry {
  id: string;
  /** Original card metadata for re-creating manifest entries */
  meta: CardManifestEntry;
  frontSize: number;
  backSize: number | null;
}

interface TransferHeader {
  packId: string;
  packName: string;
  game: string;
  cards: TransferCardEntry[];
}

// ---------------------------------------------------------------------------
// Sender: Build and send a cards-only transfer
// ---------------------------------------------------------------------------

/**
 * Build a transfer blob for specific card IDs from a pack.
 *
 * Reads card front (and back if present) images from IndexedDB,
 * packages them with a JSON header describing the contents.
 *
 * @returns The transfer blob, total card count, or null if no images found.
 */
export async function buildCardsOnlyBlob(
  packId: string,
  cardIds: string[],
  packCards: CardManifestEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; cardCount: number; header: TransferHeader } | null> {
  const cardMap = new Map(packCards.map((c) => [c.id, c]));
  const entries: TransferCardEntry[] = [];
  const imageParts: Blob[] = [];
  let processed = 0;

  for (const cardId of cardIds) {
    const card = cardMap.get(cardId);
    if (!card) continue;

    // Read front image
    const front = await getCardImage(packId, cardId, 'front');
    if (!front) continue; // skip cards without cached images

    const frontSize = front.size;
    imageParts.push(front);

    // Read back image if it exists
    let backSize: number | null = null;
    if (card.back) {
      const back = await getCardImage(packId, cardId, 'back');
      if (back) {
        backSize = back.size;
        imageParts.push(back);
      }
    }

    entries.push({
      id: cardId,
      meta: card,
      frontSize,
      backSize,
    });

    processed++;
    onProgress?.(processed, cardIds.length);
  }

  if (entries.length === 0) return null;

  const header: TransferHeader = {
    packId,
    packName: packId, // Could resolve from metadata
    game: 'unknown',
    cards: entries,
  };

  // Encode header as JSON
  const headerJson = JSON.stringify(header);
  const headerBytes = new TextEncoder().encode(headerJson);

  // Build length prefix (4 bytes, big-endian uint32)
  const lengthPrefix = new Uint8Array(4);
  new DataView(lengthPrefix.buffer).setUint32(0, headerBytes.length, false);

  // Assemble: [length][header][images...]
  const blob = new Blob([lengthPrefix, headerBytes, ...imageParts]);

  return { blob, cardCount: entries.length, header };
}

/**
 * Build a transfer blob for a full pack (zip archive).
 */
export async function buildFullPackBlob(
  packId: string,
): Promise<{ blob: Blob } | null> {
  const zip = await getPackZip(packId);
  if (!zip) return null;
  return { blob: zip };
}

/**
 * Send a cards-only transfer over a channel.
 *
 * This is the high-level sender flow:
 * 1. Build the transfer blob
 * 2. Send an offer message with size info
 * 3. Chunk and send each chunk
 * 4. Send complete message
 */
export async function sendCardsTransfer(
  channel: AssetSharingChannel,
  packId: string,
  cardIds: string[],
  packCards: CardManifestEntry[],
  onProgress?: ChunkProgressCallback,
): Promise<boolean> {
  // Build the blob
  const result = await buildCardsOnlyBlob(packId, cardIds, packCards);
  if (!result) return false;

  const { blob, cardCount } = result;

  // Chunk the blob
  const chunks = await chunkBlob(blob);

  // Send offer
  channel.send(
    AssetSharingSession.createOffer(packId, 'cards-only', blob.size, chunks.length, cardCount)
  );

  // Send chunks
  for (let i = 0; i < chunks.length; i++) {
    channel.send(AssetSharingSession.createChunkMessage(packId, chunks[i]));
    onProgress?.(i + 1, chunks.length);
  }

  // Send complete
  channel.send(AssetSharingSession.createComplete(packId, true));

  return true;
}

/**
 * Send a full-pack transfer over a channel.
 */
export async function sendFullPackTransfer(
  channel: AssetSharingChannel,
  packId: string,
  packCards: CardManifestEntry[],
  onProgress?: ChunkProgressCallback,
): Promise<boolean> {
  const result = await buildFullPackBlob(packId);
  if (!result) return false;

  const { blob } = result;
  const chunks = await chunkBlob(blob);

  channel.send(
    AssetSharingSession.createOffer(packId, 'full-pack', blob.size, chunks.length, packCards.length)
  );

  for (let i = 0; i < chunks.length; i++) {
    channel.send(AssetSharingSession.createChunkMessage(packId, chunks[i]));
    onProgress?.(i + 1, chunks.length);
  }

  channel.send(AssetSharingSession.createComplete(packId, true));
  return true;
}

// ---------------------------------------------------------------------------
// Receiver: Unpack a received transfer blob
// ---------------------------------------------------------------------------

/**
 * Unpack a cards-only transfer blob and store card images in IndexedDB.
 *
 * @param blob The reassembled transfer blob.
 * @param targetPackId Pack ID to store images under (can differ from sender's).
 * @param onProgress Progress callback.
 * @returns Number of cards stored.
 */
export async function unpackCardsOnlyBlob(
  blob: Blob,
  targetPackId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ cardsStored: number; header: TransferHeader }> {
  // Read length prefix (first 4 bytes)
  const prefixSlice = blob.slice(0, 4);
  const prefixBuf = await prefixSlice.arrayBuffer();
  const headerLength = new DataView(prefixBuf).getUint32(0, false);

  // Read header JSON
  const headerSlice = blob.slice(4, 4 + headerLength);
  const headerText = await headerSlice.text();
  const header: TransferHeader = JSON.parse(headerText);

  // Read image blobs sequentially
  let offset = 4 + headerLength;
  let stored = 0;

  for (const entry of header.cards) {
    // Front image
    const frontBlob = blob.slice(offset, offset + entry.frontSize);
    offset += entry.frontSize;
    await storeCardImage(targetPackId, entry.id, 'front', frontBlob);

    // Back image (if present)
    if (entry.backSize !== null) {
      const backBlob = blob.slice(offset, offset + entry.backSize);
      offset += entry.backSize;
      await storeCardImage(targetPackId, entry.id, 'back', backBlob);
    }

    stored++;
    onProgress?.(stored, header.cards.length);
  }

  // Store pack metadata with card entries
  const meta: StoredPackMetadata = {
    id: targetPackId,
    name: header.packName,
    game: header.game,
    version: '0.0.0',
    source: { type: 'p2p', peerId: 'unknown', originalPackId: header.packId },
    cardCount: header.cards.length,
    cachedCardIds: header.cards.flatMap((c) => {
      const ids = [`${c.id}:front`];
      if (c.backSize !== null) ids.push(`${c.id}:back`);
      return ids;
    }),
    cards: header.cards.map((c) => c.meta),
    loadedAt: Date.now(),
  };
  await storePackMetadata(meta);

  return { cardsStored: stored, header };
}

/**
 * Unpack a full-pack transfer blob (zip archive) and store it.
 */
export async function unpackFullPackBlob(
  blob: Blob,
  targetPackId: string,
): Promise<void> {
  await storePackZip(targetPackId, blob);
  // The pack can be loaded later via loadPack({ type: 'p2p', ... })
  // which will reconstruct from metadata. For now, just store the zip.
}
