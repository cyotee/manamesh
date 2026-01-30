/**
 * Zip Archive Extractor
 *
 * Extracts zip archives using fflate with non-blocking decompression.
 * Designed for browser-based IPFS asset pack extraction.
 */

import { unzip } from 'fflate';

export interface ZipExtractionResult {
  entries: Map<string, Uint8Array>;
  totalSize: number;
}

/**
 * Extract a zip archive from a Blob.
 * Uses fflate's async unzip to avoid blocking the UI thread.
 *
 * @param zipBlob - The zip file as a Blob
 * @returns Map of file paths to their content as Uint8Array
 */
export async function extractZip(zipBlob: Blob): Promise<ZipExtractionResult> {
  const arrayBuffer = await zipBlob.arrayBuffer();
  const zipData = new Uint8Array(arrayBuffer);

  // Debug: Check if this looks like a zip file (PK magic bytes)
  const isZip = zipData.length >= 4 &&
    zipData[0] === 0x50 && zipData[1] === 0x4B; // "PK"

  console.log('[ZipExtractor] Blob size:', zipBlob.size, 'type:', zipBlob.type);
  console.log('[ZipExtractor] ArrayBuffer size:', arrayBuffer.byteLength);
  console.log('[ZipExtractor] Uint8Array size:', zipData.length);
  console.log('[ZipExtractor] First 20 bytes:', Array.from(zipData.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('[ZipExtractor] Looks like zip (PK header):', isZip);

  if (!isZip && zipData.length > 0) {
    // Try to decode as text to see what we got
    const preview = new TextDecoder().decode(zipData.slice(0, 200));
    console.error('[ZipExtractor] Not a zip file! Content preview:', preview);
  }

  return new Promise((resolve, reject) => {
    // fflate's callback-based unzip yields to the event loop
    unzip(zipData, (err, result) => {
      if (err) {
        reject(new Error(`Zip extraction failed: ${err.message}`));
        return;
      }

      const entries = new Map<string, Uint8Array>();
      let totalSize = 0;

      for (const [path, data] of Object.entries(result)) {
        // Skip directories (they have zero-length data)
        if (data.length > 0) {
          entries.set(path, data);
          totalSize += data.length;
        }
      }

      resolve({ entries, totalSize });
    });
  });
}

/**
 * Extract a single text file from a zip entry.
 */
export function decodeTextEntry(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Convert a Uint8Array to a Blob with the given MIME type.
 */
export function entryToBlob(data: Uint8Array, mimeType: string): Blob {
  // Create a copy of the data to avoid SharedArrayBuffer issues
  // This ensures we have a regular ArrayBuffer regardless of the underlying buffer type
  const copy = new Uint8Array(data);
  return new Blob([copy], { type: mimeType });
}

/**
 * Infer MIME type from a file path extension.
 */
export function inferMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}
