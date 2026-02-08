/**
 * Generic blob chunking and reassembly for P2P transfers over WebRTC.
 *
 * WebRTC data channels transmit strings or ArrayBuffers. For large binary
 * payloads (asset pack zips, card images) we chunk into base64-encoded
 * segments and reassemble on the other end.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single chunk ready to send over the data channel. */
export interface Chunk {
  chunkIndex: number;
  totalChunks: number;
  /** Base64-encoded binary data for this chunk. */
  data: string;
}

/** Progress callback fired after each chunk is produced or received. */
export type ChunkProgressCallback = (received: number, total: number) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default chunk size in bytes (before base64 encoding). 48KB raw → ~64KB base64. */
export const DEFAULT_CHUNK_SIZE = 48 * 1024;

// ---------------------------------------------------------------------------
// Chunking (sender side)
// ---------------------------------------------------------------------------

/**
 * Split a Blob into an array of base64-encoded chunks.
 *
 * @param blob       The binary data to chunk.
 * @param chunkSize  Max raw bytes per chunk (default 48KB).
 * @param onProgress Optional progress callback.
 * @returns Array of Chunk objects ready to serialize and send.
 */
export async function chunkBlob(
  blob: Blob,
  chunkSize = DEFAULT_CHUNK_SIZE,
  onProgress?: ChunkProgressCallback,
): Promise<Chunk[]> {
  const totalChunks = Math.ceil(blob.size / chunkSize);
  const chunks: Chunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, blob.size);
    const slice = blob.slice(start, end);
    const buffer = await slice.arrayBuffer();
    const data = arrayBufferToBase64(buffer);

    chunks.push({ chunkIndex: i, totalChunks, data });
    onProgress?.(i + 1, totalChunks);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Reassembly (receiver side)
// ---------------------------------------------------------------------------

/**
 * Stateful chunk collector that reassembles a Blob from incoming chunks.
 *
 * Usage:
 *   const collector = createChunkCollector(totalChunks, onProgress);
 *   for (const chunk of incomingChunks) {
 *     const result = collector.addChunk(chunk);
 *     if (result) {
 *       // result is the reassembled Blob
 *     }
 *   }
 */
export interface ChunkCollector {
  /** Add an incoming chunk. Returns the reassembled Blob when all chunks are received, else null. */
  addChunk(chunk: Chunk): Blob | null;
  /** Number of chunks received so far. */
  readonly received: number;
  /** Total number of chunks expected. */
  readonly total: number;
  /** Whether all chunks have been received. */
  readonly isComplete: boolean;
}

export function createChunkCollector(
  totalChunks: number,
  onProgress?: ChunkProgressCallback,
): ChunkCollector {
  const buffers = new Map<number, ArrayBuffer>();

  return {
    addChunk(chunk: Chunk): Blob | null {
      if (buffers.has(chunk.chunkIndex)) {
        // Duplicate chunk, ignore
        return null;
      }

      buffers.set(chunk.chunkIndex, base64ToArrayBuffer(chunk.data));
      onProgress?.(buffers.size, totalChunks);

      if (buffers.size === totalChunks) {
        // Reassemble in order
        const ordered: ArrayBuffer[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const buf = buffers.get(i);
          if (!buf) throw new Error(`Missing chunk ${i}`);
          ordered.push(buf);
        }
        return new Blob(ordered);
      }

      return null;
    },

    get received() {
      return buffers.size;
    },

    get total() {
      return totalChunks;
    },

    get isComplete() {
      return buffers.size === totalChunks;
    },
  };
}

// ---------------------------------------------------------------------------
// Base64 utilities
// ---------------------------------------------------------------------------

/** Convert an ArrayBuffer to a base64 string. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert a base64 string back to an ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
