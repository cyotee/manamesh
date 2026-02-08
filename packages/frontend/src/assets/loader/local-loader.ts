/**
 * Local Asset Pack Loader
 *
 * Handles loading asset packs from local file uploads:
 * - Zip file: store zip blob in IndexedDB, then extract
 * - Directory: zip client-side with fflate, store, then extract
 *
 * All packs are stored as zip blobs in IndexedDB so they persist across
 * sessions. On next visit, packs can be reloaded from the stored zip.
 * Card images are also cached individually for fast access.
 */

import { zip as fflateZip } from 'fflate';
import { parseManifest, resolveNestedManifests } from '../manifest';
import type { AssetPackManifest, CardManifestEntry } from '../manifest/types';
import {
  extractZip,
  decodeTextEntry,
  entryToBlob,
  inferMimeType,
} from './zip-extractor';
import {
  storePackMetadata,
  storeCardImage,
  getPackMetadata,
  storePackZip,
  getPackZip,
} from './cache';
import type {
  LocalSource,
  LoadedAssetPack,
  ProgressCallback,
  StoredPackMetadata,
} from './types';

// In-memory cache of locally loaded packs
const localPacks = new Map<string, LoadedAssetPack>();

/**
 * Load a local zip file as an asset pack.
 *
 * Flow:
 * 1. Read the File as Blob
 * 2. Store the zip blob in IndexedDB for persistence
 * 3. Extract with fflate
 * 4. Parse manifest(s) and resolve nested sets
 * 5. Cache all card images into IndexedDB
 * 6. Store pack metadata
 *
 * @param file - A File object from an <input type="file"> element
 * @param onProgress - Optional progress callback
 * @returns Loaded asset pack
 */
export async function loadLocalZip(
  file: File,
  onProgress?: ProgressCallback,
): Promise<LoadedAssetPack> {
  onProgress?.(0, 100);

  // Read file into Blob
  const zipBlob = new Blob([await file.arrayBuffer()], { type: 'application/zip' });

  onProgress?.(10, 100);

  // Extract zip entries
  const { entries } = await extractZip(zipBlob);

  onProgress?.(30, 100);

  return processExtractedEntries(entries, zipBlob, file.name, onProgress, 30);
}

/**
 * Load a local directory as an asset pack.
 *
 * The browser's directory picker returns a FileList with `webkitRelativePath`.
 * We read all files, zip them with fflate, store the zip, then extract and process.
 *
 * @param files - FileList from <input type="file" webkitdirectory>
 * @param onProgress - Optional progress callback
 * @returns Loaded asset pack
 */
export async function loadLocalDirectory(
  files: FileList,
  onProgress?: ProgressCallback,
): Promise<LoadedAssetPack> {
  onProgress?.(0, 100);

  // Read all files into a Map<path, Uint8Array>
  const fileEntries = new Map<string, Uint8Array>();

  // Strip the common root directory prefix from paths.
  // webkitRelativePath includes the directory name, e.g., "mypack/manifest.json".
  // We want paths relative to the root.
  let commonPrefix = '';
  if (files.length > 0 && files[0].webkitRelativePath) {
    const firstPath = files[0].webkitRelativePath;
    const rootDir = firstPath.split('/')[0];
    commonPrefix = rootDir + '/';
  }

  const totalFiles = files.length;
  for (let i = 0; i < totalFiles; i++) {
    const file = files[i];
    const relativePath = file.webkitRelativePath.startsWith(commonPrefix)
      ? file.webkitRelativePath.slice(commonPrefix.length)
      : file.webkitRelativePath;

    // Skip empty paths and hidden files
    if (!relativePath || relativePath.startsWith('.')) continue;

    const buffer = await file.arrayBuffer();
    fileEntries.set(relativePath, new Uint8Array(buffer));

    // Progress: reading phase is 0-15%
    onProgress?.(Math.floor((i / totalFiles) * 15), 100);
  }

  onProgress?.(15, 100);

  // Zip the directory contents with fflate
  const zipBlob = await createZipBlob(fileEntries);

  onProgress?.(25, 100);

  // Extract (we already have the entries in memory, but process through
  // the same path for consistency)
  const { entries } = await extractZip(zipBlob);

  onProgress?.(30, 100);

  const dirName = commonPrefix.replace(/\/$/, '') || 'local-pack';
  return processExtractedEntries(entries, zipBlob, dirName, onProgress, 30);
}

/**
 * Create a zip Blob from a map of file entries using fflate.
 */
function createZipBlob(entries: Map<string, Uint8Array>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // fflate expects a flat object of { path: Uint8Array }
    const zipInput: Record<string, Uint8Array> = {};
    for (const [path, data] of entries) {
      zipInput[path] = data;
    }

    fflateZip(zipInput, { level: 1 }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(new Blob([data], { type: 'application/zip' }));
    });
  });
}

/**
 * Process extracted file entries into a LoadedAssetPack.
 *
 * Shared between zip and directory loaders.
 * Stores the zip blob and pack metadata in IndexedDB for persistence.
 */
async function processExtractedEntries(
  entries: Map<string, Uint8Array>,
  zipBlob: Blob,
  sourceName: string,
  onProgress?: ProgressCallback,
  progressBase: number = 0,
): Promise<LoadedAssetPack> {
  // Find manifest.json — check root first, then subdirectories
  let manifestData = entries.get('manifest.json');
  let manifestBasePath = '';

  if (!manifestData) {
    for (const path of entries.keys()) {
      if (path.endsWith('/manifest.json') || path.endsWith('\\manifest.json')) {
        manifestData = entries.get(path);
        manifestBasePath = path.substring(0, path.lastIndexOf('manifest.json'));
        break;
      }
    }
  }

  if (!manifestData) {
    throw new Error(
      'No manifest.json found. Ensure the asset pack contains a manifest.json at the root level.'
    );
  }

  const manifestJson = JSON.parse(decodeTextEntry(manifestData));
  const parseResult = parseManifest(manifestJson);

  if (!parseResult.ok) {
    const errorMessages = parseResult.errors
      .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
      .join('; ');
    throw new Error(`Invalid manifest: ${errorMessages}`);
  }

  const manifest = parseResult.value;

  onProgress?.(progressBase + 10, 100);

  // Resolve nested set manifests (scraper output has nested directories)
  const nestedLoader = async (path: string): Promise<unknown> => {
    const fullPath = manifestBasePath + path;
    const data = entries.get(fullPath);
    if (!data) {
      throw new Error(`Nested manifest not found: ${fullPath}`);
    }
    return JSON.parse(decodeTextEntry(data));
  };

  const cards = await resolveNestedManifests(manifest, nestedLoader);

  onProgress?.(progressBase + 20, 100);

  // Generate a stable pack ID from the manifest name
  const safeName = (manifest.name || sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const packId = `local:${safeName}`;

  const source: LocalSource = { type: 'local', packId };

  // Store the zip blob in IndexedDB for persistence across sessions
  await storePackZip(packId, zipBlob);

  // Cache card images into IndexedDB
  const cachedCardIds: string[] = [];
  const totalCards = cards.length;

  // Find shared back image
  const backCandidates = ['cards/back.png', 'back.png', 'card_back.png'];
  let sharedBackData: Uint8Array | undefined;
  let sharedBackPath: string | undefined;

  for (const candidate of backCandidates) {
    const fullPath = manifestBasePath + candidate;
    const data = entries.get(fullPath) ?? entries.get(candidate);
    if (data) {
      sharedBackData = data;
      sharedBackPath = fullPath;
      break;
    }
  }

  // Also search for any back image
  if (!sharedBackData) {
    for (const [path, data] of entries) {
      if (path.toLowerCase().includes('back') &&
          /\.(png|jpg|jpeg|webp)$/i.test(path)) {
        sharedBackData = data;
        sharedBackPath = path;
        break;
      }
    }
  }

  if (sharedBackData && sharedBackPath) {
    const backBlob = entryToBlob(sharedBackData, inferMimeType(sharedBackPath));
    await storeCardImage(packId, '_back', 'front', backBlob);
  }

  for (let i = 0; i < totalCards; i++) {
    const card = cards[i];

    // Cache front image
    const frontPath = manifestBasePath + card.front;
    const frontData = entries.get(frontPath);
    if (frontData) {
      const frontBlob = entryToBlob(frontData, inferMimeType(frontPath));
      await storeCardImage(packId, card.id, 'front', frontBlob);
      cachedCardIds.push(card.id);
    }

    // Cache back image if card-specific
    if (card.back && card.back !== sharedBackPath) {
      const backPath = manifestBasePath + card.back;
      const backData = entries.get(backPath);
      if (backData) {
        const backBlob = entryToBlob(backData, inferMimeType(backPath));
        await storeCardImage(packId, card.id, 'back', backBlob);
      }
    }

    // Progress: caching phase is progressBase+20 to 100
    const progress = (progressBase + 20) +
      Math.floor(((i + 1) / totalCards) * (100 - progressBase - 20));
    onProgress?.(progress, 100);
  }

  onProgress?.(100, 100);

  // Build LoadedAssetPack
  const loadedPack: LoadedAssetPack = {
    id: packId,
    manifest,
    cards,
    source,
    loadedAt: Date.now(),
  };

  localPacks.set(packId, loadedPack);

  // Store pack metadata in IndexedDB so the pack shows in "Available Packs"
  const existingMetadata = await getPackMetadata(packId);
  const metadata: StoredPackMetadata = {
    id: packId,
    name: manifest.name,
    game: manifest.game,
    version: manifest.version,
    source,
    cardCount: cards.length,
    cachedCardIds: existingMetadata?.cachedCardIds ?? cachedCardIds,
    cards,
    manifest,
    loadedAt: loadedPack.loadedAt,
  };

  await storePackMetadata(metadata);

  console.log(
    `[LocalLoader] Loaded "${manifest.name}" — ${cards.length} cards, ` +
    `zip: ${(zipBlob.size / 1024).toFixed(0)}KB, packId: ${packId}`
  );

  return loadedPack;
}

/**
 * Get a locally loaded pack from memory.
 */
export function getLocalPack(packId: string): LoadedAssetPack | undefined {
  return localPacks.get(packId);
}

/**
 * Reload a local pack from IndexedDB.
 * Reads the stored zip blob, extracts it, and rebuilds the LoadedAssetPack.
 * Returns null if no zip is stored for this pack.
 */
export async function reloadLocalPack(
  packId: string
): Promise<LoadedAssetPack | null> {
  // Already in memory?
  const existing = localPacks.get(packId);
  if (existing) return existing;

  // Try fast path: load cards + manifest directly from stored metadata
  const metadata = await getPackMetadata(packId);
  if (metadata?.cards && metadata.manifest) {
    const source: LocalSource = { type: 'local', packId };
    const loadedPack: LoadedAssetPack = {
      id: packId,
      manifest: metadata.manifest,
      cards: metadata.cards,
      source,
      loadedAt: metadata.loadedAt,
    };

    localPacks.set(packId, loadedPack);

    console.log(
      `[LocalLoader] Reloaded "${metadata.manifest.name}" from cached metadata — ${metadata.cards.length} cards`
    );

    return loadedPack;
  }

  // Slow path: re-extract from stored zip blob
  const zipBlob = await getPackZip(packId);
  if (!zipBlob) return null;

  console.log(`[LocalLoader] Reloading "${packId}" from stored zip (${(zipBlob.size / 1024).toFixed(0)}KB)...`);

  // Extract the zip
  const { entries } = await extractZip(zipBlob);

  // Find and parse manifest
  let manifestData = entries.get('manifest.json');
  let manifestBasePath = '';

  if (!manifestData) {
    for (const path of entries.keys()) {
      if (path.endsWith('/manifest.json') || path.endsWith('\\manifest.json')) {
        manifestData = entries.get(path);
        manifestBasePath = path.substring(0, path.lastIndexOf('manifest.json'));
        break;
      }
    }
  }

  if (!manifestData) return null;

  const manifestJson = JSON.parse(decodeTextEntry(manifestData));
  const parseResult = parseManifest(manifestJson);
  if (!parseResult.ok) return null;

  const manifest = parseResult.value;

  // Resolve nested manifests
  const nestedLoader = async (path: string): Promise<unknown> => {
    const fullPath = manifestBasePath + path;
    const data = entries.get(fullPath);
    if (!data) throw new Error(`Nested manifest not found: ${fullPath}`);
    return JSON.parse(decodeTextEntry(data));
  };

  const cards = await resolveNestedManifests(manifest, nestedLoader);

  const source: LocalSource = { type: 'local', packId };

  const loadedPack: LoadedAssetPack = {
    id: packId,
    manifest,
    cards,
    source,
    loadedAt: metadata?.loadedAt ?? Date.now(),
  };

  localPacks.set(packId, loadedPack);

  // Backfill metadata with cards + manifest so next reload is fast
  if (metadata) {
    metadata.cards = cards;
    metadata.manifest = manifest;
    await storePackMetadata(metadata);
  }

  console.log(
    `[LocalLoader] Reloaded "${manifest.name}" from stored zip — ${cards.length} cards`
  );

  return loadedPack;
}

/**
 * Unload a local pack from memory (does not clear IndexedDB cache).
 */
export function unloadLocalPack(packId: string): void {
  localPacks.delete(packId);
}

/**
 * Get all locally loaded packs.
 */
export function getAllLocalPacks(): LoadedAssetPack[] {
  return Array.from(localPacks.values());
}
