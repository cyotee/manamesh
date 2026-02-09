/**
 * IPFS Zip Archive Loader
 *
 * Downloads zip archives from IPFS, extracts them in the browser,
 * parses manifests, and caches individual card images in IndexedDB.
 */

import { loadAsset } from '../ipfs-loader';
import { getConfig } from '../config';
import { parseManifest } from '../manifest';
import type { CardManifestEntry } from '../manifest/types';
import {
  extractZip,
  decodeTextEntry,
  entryToBlob,
  inferMimeType,
} from './zip-extractor';
import {
  storePackMetadata,
  getPackMetadata,
  storeCardImage,
} from './cache';
import type {
  IPFSZipSource,
  LoadedAssetPack,
  LoadOptions,
  ProgressCallback,
  StoredPackMetadata,
  AssetPackSource,
} from './types';
import { sourceToPackId } from './types';
import { computeCidFromBlob } from './cid';

// In-memory cache of loaded packs
const zipLoadedPacks = new Map<string, LoadedAssetPack>();

// Standard playing card ranks and suits for auto-detection
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['C', 'D', 'H', 'S']; // Clubs, Diamonds, Hearts, Spades
const SUIT_NAMES: Record<string, string> = {
  'C': 'Clubs',
  'D': 'Diamonds',
  'H': 'Hearts',
  'S': 'Spades',
};
const RANK_NAMES: Record<string, string> = {
  '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
  '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine', '10': 'Ten',
  'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace',
};

/**
 * Auto-detect standard playing card pack structure.
 * Supports multiple naming patterns:
 * - "{rank}{suit}.png" (e.g., "AS.png", "2C.png", "10H.png")
 * - "cards/{rank}{suit}.png" (in cards/ subdirectory)
 * - "{suit}/{rank}.png" (e.g., "spades/ace.png")
 */
function autoDetectPlayingCards(entries: Map<string, Uint8Array>): unknown | null {
  const filePaths = Array.from(entries.keys());
  const cards: Array<{ id: string; name: string; front: string; back?: string }> = [];
  let backPath: string | undefined;

  // Find back image (common names)
  const backPatterns = ['back.png', 'cards/back.png', 'card_back.png', 'back.jpg', 'cards/back.jpg'];
  for (const pattern of backPatterns) {
    if (entries.has(pattern)) {
      backPath = pattern;
      break;
    }
  }

  // Also check for back in any directory
  if (!backPath) {
    for (const path of filePaths) {
      const lowerPath = path.toLowerCase();
      if (lowerPath.includes('back') && (lowerPath.endsWith('.png') || lowerPath.endsWith('.jpg'))) {
        backPath = path;
        break;
      }
    }
  }

  // Pattern 1: {rank}{suit}.png (case insensitive, with optional directory prefix)
  // Examples: AS.png, 2c.png, 10H.png, cards/AS.png
  const rankSuitPattern = /(?:^|[\/\\])(\d+|[JQKA])([CDHS])\.(?:png|jpg|jpeg|webp)$/i;

  for (const path of filePaths) {
    const match = path.match(rankSuitPattern);
    if (match) {
      const rank = match[1].toUpperCase();
      const suit = match[2].toUpperCase();

      if (RANKS.includes(rank) && SUITS.includes(suit)) {
        const cardId = `${rank}${suit}`;
        const cardName = `${RANK_NAMES[rank]} of ${SUIT_NAMES[suit]}`;
        cards.push({
          id: cardId,
          name: cardName,
          front: path,
          back: backPath,
        });
      }
    }
  }

  // Pattern 2: Check for jokers
  const jokerPatterns = [
    { pattern: /joker[_-]?1|red[_-]?joker|joker[_-]?red/i, id: 'JOKER_RED', name: 'Red Joker' },
    { pattern: /joker[_-]?2|black[_-]?joker|joker[_-]?black/i, id: 'JOKER_BLACK', name: 'Black Joker' },
    { pattern: /^joker\.(?:png|jpg)/i, id: 'JOKER', name: 'Joker' },
  ];

  for (const path of filePaths) {
    const filename = path.split('/').pop() || path;
    for (const { pattern, id, name } of jokerPatterns) {
      if (pattern.test(filename) && !cards.some(c => c.id === id)) {
        cards.push({ id, name, front: path, back: backPath });
        break;
      }
    }
  }

  // Need at least 40 cards for a valid deck (accounting for some missing)
  if (cards.length < 40) {
    console.log('[ZipLoader] Auto-detect found only', cards.length, 'cards, not enough for a standard deck');
    return null;
  }

  console.log('[ZipLoader] Auto-detected', cards.length, 'cards, back image:', backPath || 'none');

  return {
    name: 'Standard Playing Cards',
    version: '1.0.0',
    game: 'poker',
    cards,
  };
}

// In-flight loading promises to deduplicate concurrent requests
const loadingPromises = new Map<string, Promise<LoadedAssetPack>>();

/**
 * Load an asset pack from an IPFS zip archive.
 *
 * Flow:
 * 1. Check if pack is already loaded in memory
 * 2. Download the entire zip from IPFS
 * 3. Extract zip contents using fflate (non-blocking)
 * 4. Parse manifest.json
 * 5. Cache each card image individually in IndexedDB
 * 6. Return LoadedAssetPack
 *
 * @param source - IPFS zip source with CID
 * @param options - Load options
 * @param onProgress - Optional progress callback for extraction/caching
 * @returns Loaded asset pack with manifest and card list
 */
export async function loadZipPack(
  source: IPFSZipSource,
  options: LoadOptions = {},
  onProgress?: ProgressCallback
): Promise<LoadedAssetPack> {
  const packId = sourceToPackId(source);

  // Check if already loaded in memory
  const existing = zipLoadedPacks.get(packId);
  if (existing) {
    onProgress?.(100, 100);
    return existing;
  }

  // Check if already loading (deduplicate concurrent requests)
  const existingPromise = loadingPromises.get(packId);
  if (existingPromise) {
    console.log('[ZipLoader] Deduplicating request - already loading:', packId);
    const result = await existingPromise;
    onProgress?.(100, 100);
    return result;
  }

  // Create and track the loading promise
  const loadPromise = doLoadZipPack(source, options, onProgress, packId);
  loadingPromises.set(packId, loadPromise);

  try {
    return await loadPromise;
  } finally {
    loadingPromises.delete(packId);
  }
}

/**
 * Internal implementation of zip pack loading.
 */
async function doLoadZipPack(
  source: IPFSZipSource,
  options: LoadOptions,
  onProgress: ProgressCallback | undefined,
  packId: string
): Promise<LoadedAssetPack> {

  // Check if pack metadata exists in IndexedDB
  const existingMetadata = await getPackMetadata(packId);

  const config = getConfig();

  // Step 1: Download the zip from IPFS
  console.log('[ZipLoader] Downloading zip from IPFS:', source.cid);
  onProgress?.(0, 100);

  const result = await loadAsset(source.cid, {
    useCache: options.useCache ?? true,
    preferGateway: options.preferGateway ?? config.preferGateway,
    gatewayTimeout: options.timeout ?? config.gatewayTimeout,
    heliaTimeout: options.timeout ?? config.heliaFetchTimeout,
  });

  console.log('[ZipLoader] Downloaded zip:', result.blob.size, 'bytes from', result.source);
  onProgress?.(20, 100);

  // Step 2: Extract zip
  console.log('[ZipLoader] Extracting zip...');
  const { entries, totalSize } = await extractZip(result.blob);
  console.log('[ZipLoader] Extracted', entries.size, 'files,', totalSize, 'bytes total');

  onProgress?.(40, 100);

  // Debug: Log all file paths in the zip
  console.log('[ZipLoader] Extracted file paths:');
  for (const path of entries.keys()) {
    console.log('  -', path);
  }

  // Step 3: Parse manifest (or auto-generate for standard playing cards)
  let manifestJson: unknown;
  let manifestBasePath = ''; // Base path for relative file references

  // Try to find manifest.json - first at root, then in subdirectories
  let manifestData = entries.get('manifest.json');

  if (!manifestData) {
    // Look for manifest.json in subdirectories (common for zipped folders)
    for (const path of entries.keys()) {
      if (path.endsWith('/manifest.json') || path.endsWith('\\manifest.json')) {
        manifestData = entries.get(path);
        // Extract the base path (everything before manifest.json)
        manifestBasePath = path.substring(0, path.lastIndexOf('manifest.json'));
        console.log('[ZipLoader] Found manifest at:', path, 'basePath:', manifestBasePath);
        break;
      }
    }
  }

  if (manifestData) {
    manifestJson = JSON.parse(decodeTextEntry(manifestData));
  } else {
    // Try to auto-detect standard playing card pack
    console.log('[ZipLoader] No manifest.json found, attempting auto-detection...');
    manifestJson = autoDetectPlayingCards(entries);
    if (!manifestJson) {
      throw new Error('Zip archive does not contain manifest.json and is not a recognized card pack format');
    }
    console.log('[ZipLoader] Auto-detected playing card pack');
  }

  const parseResult = parseManifest(manifestJson);

  if (!parseResult.ok) {
    const errorMessages = parseResult.errors
      .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
      .join('; ');
    throw new Error(`Invalid manifest in zip: ${errorMessages}`);
  }

  const manifest = parseResult.value;
  console.log('[ZipLoader] Parsed manifest:', manifest.name, 'v' + manifest.version);

  // For zip archives, card paths are relative within the zip
  const cards = manifest.cards ?? [];

  onProgress?.(50, 100);

  // Step 4: Cache each card image
  console.log('[ZipLoader] Caching', cards.length, 'card images...');
  const cachedCardIds: string[] = [];

  // Find and cache the shared back image (try multiple common paths)
  const backPathCandidates = ['cards/back.png', 'back.png', 'card_back.png', 'cards/back.jpg', 'back.jpg'];
  let sharedBackPath: string | undefined;
  let sharedBackData: Uint8Array | undefined;

  // First check explicit paths (with and without base path)
  for (const candidate of backPathCandidates) {
    // Try with base path first
    let fullPath = manifestBasePath + candidate;
    let data = entries.get(fullPath);
    if (data) {
      sharedBackPath = fullPath;
      sharedBackData = data;
      break;
    }
    // Try without base path
    data = entries.get(candidate);
    if (data) {
      sharedBackPath = candidate;
      sharedBackData = data;
      break;
    }
  }

  // If not found, search for any file with "back" in the name
  if (!sharedBackData) {
    for (const [path, data] of entries) {
      const lowerPath = path.toLowerCase();
      if (lowerPath.includes('back') && (lowerPath.endsWith('.png') || lowerPath.endsWith('.jpg'))) {
        sharedBackPath = path;
        sharedBackData = data;
        break;
      }
    }
  }

  if (sharedBackData && sharedBackPath) {
    const backBlob = entryToBlob(sharedBackData, inferMimeType(sharedBackPath));
    await storeCardImage(packId, '_back', 'front', backBlob);
    console.log('[ZipLoader] Cached shared back image:', sharedBackPath);
  } else {
    console.log('[ZipLoader] No shared back image found');
  }

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    // Cache front image (prepend base path if needed)
    const frontPath = manifestBasePath + card.front;
    const frontData = entries.get(frontPath);
    if (frontData) {
      const frontBlob = entryToBlob(frontData, inferMimeType(frontPath));
      await storeCardImage(packId, card.id, 'front', frontBlob);
      cachedCardIds.push(card.id);
    } else {
      console.warn('[ZipLoader] Missing front image for card:', card.id, frontPath);
    }

    // Cache back image if card has a specific back (not shared)
    if (card.back && sharedBackPath && card.back !== sharedBackPath) {
      const backPath = manifestBasePath + card.back;
      const backData = entries.get(backPath);
      if (backData) {
        const backBlob = entryToBlob(backData, inferMimeType(backPath));
        await storeCardImage(packId, card.id, 'back', backBlob);
      }
    }

    // Report progress
    const progress = 50 + Math.floor(((i + 1) / cards.length) * 50);
    onProgress?.(progress, 100);
  }

  console.log('[ZipLoader] Cached', cachedCardIds.length, 'cards');
  onProgress?.(100, 100);

  // Step 5: Build and cache LoadedAssetPack
  const loadedPack: LoadedAssetPack = {
    id: packId,
    manifest,
    cards,
    source: source as AssetPackSource,
    loadedAt: Date.now(),
  };

  zipLoadedPacks.set(packId, loadedPack);

  // Compute IPFS CID from the zip blob
  const ipfsCid = await computeCidFromBlob(result.blob);

  // Store metadata
  const metadata: StoredPackMetadata = {
    id: packId,
    name: manifest.name,
    game: manifest.game,
    version: manifest.version,
    source: source as AssetPackSource,
    cardCount: cards.length,
    cachedCardIds: existingMetadata?.cachedCardIds ?? cachedCardIds,
    ipfsCid,
    loadedAt: loadedPack.loadedAt,
  };

  await storePackMetadata(metadata);
  console.log('[ZipLoader] Pack loaded and cached:', packId);

  return loadedPack;
}

/**
 * Get a zip-loaded pack from memory.
 */
export function getZipLoadedPack(packId: string): LoadedAssetPack | undefined {
  return zipLoadedPacks.get(packId);
}

/**
 * Unload a zip pack from memory.
 */
export function unloadZipPack(packId: string): void {
  zipLoadedPacks.delete(packId);
}

/**
 * Get all zip-loaded packs.
 */
export function getAllZipLoadedPacks(): LoadedAssetPack[] {
  return Array.from(zipLoadedPacks.values());
}
