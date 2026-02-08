import { describe, it, expect, vi } from 'vitest';
import {
  chunkBlob,
  createChunkCollector,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  DEFAULT_CHUNK_SIZE,
} from './chunking';
import type { Chunk } from './chunking';

describe('base64 utilities', () => {
  it('round-trips ArrayBuffer through base64', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 100, 200, 255]);
    const base64 = arrayBufferToBase64(original.buffer);
    const recovered = new Uint8Array(base64ToArrayBuffer(base64));
    expect(recovered).toEqual(original);
  });

  it('handles empty buffer', () => {
    const empty = new Uint8Array([]);
    const base64 = arrayBufferToBase64(empty.buffer);
    const recovered = new Uint8Array(base64ToArrayBuffer(base64));
    expect(recovered.length).toBe(0);
  });
});

describe('chunkBlob', () => {
  it('chunks a small blob into a single chunk', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const blob = new Blob([data]);
    const chunks = await chunkBlob(blob, 1024);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(1);
  });

  it('chunks a larger blob into multiple chunks', async () => {
    const data = new Uint8Array(100);
    data.fill(42);
    const blob = new Blob([data]);
    const chunks = await chunkBlob(blob, 30);

    // 100 bytes / 30 per chunk = ceil(3.33) = 4 chunks
    expect(chunks).toHaveLength(4);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(4);
    expect(chunks[3].chunkIndex).toBe(3);
    expect(chunks[3].totalChunks).toBe(4);
  });

  it('fires progress callback for each chunk', async () => {
    const data = new Uint8Array(100);
    const blob = new Blob([data]);
    const progress = vi.fn();

    await chunkBlob(blob, 50, progress);

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(progress).toHaveBeenCalledWith(2, 2);
  });

  it('handles empty blob', async () => {
    const blob = new Blob([]);
    const chunks = await chunkBlob(blob, 1024);
    // Empty blob: ceil(0/1024) = 0 chunks
    expect(chunks).toHaveLength(0);
  });

  it('uses DEFAULT_CHUNK_SIZE when not specified', async () => {
    // Create blob slightly larger than default chunk size
    const data = new Uint8Array(DEFAULT_CHUNK_SIZE + 1);
    const blob = new Blob([data]);
    const chunks = await chunkBlob(blob);

    expect(chunks).toHaveLength(2);
  });
});

describe('createChunkCollector', () => {
  it('reassembles chunks into original blob', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const blob = new Blob([original]);

    const chunks = await chunkBlob(blob, 4);
    expect(chunks.length).toBeGreaterThan(1);

    const collector = createChunkCollector(chunks.length);

    let result: Blob | null = null;
    for (const chunk of chunks) {
      result = collector.addChunk(chunk);
    }

    expect(result).not.toBeNull();
    const recovered = new Uint8Array(await result!.arrayBuffer());
    expect(recovered).toEqual(original);
  });

  it('returns null until all chunks received', async () => {
    const chunks: Chunk[] = [
      { chunkIndex: 0, totalChunks: 3, data: arrayBufferToBase64(new Uint8Array([1]).buffer) },
      { chunkIndex: 1, totalChunks: 3, data: arrayBufferToBase64(new Uint8Array([2]).buffer) },
      { chunkIndex: 2, totalChunks: 3, data: arrayBufferToBase64(new Uint8Array([3]).buffer) },
    ];

    const collector = createChunkCollector(3);

    expect(collector.addChunk(chunks[0])).toBeNull();
    expect(collector.received).toBe(1);
    expect(collector.isComplete).toBe(false);

    expect(collector.addChunk(chunks[1])).toBeNull();
    expect(collector.received).toBe(2);

    const result = collector.addChunk(chunks[2]);
    expect(result).not.toBeNull();
    expect(collector.isComplete).toBe(true);
    expect(collector.received).toBe(3);
  });

  it('handles out-of-order chunks', async () => {
    const original = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const blob = new Blob([original]);
    const chunks = await chunkBlob(blob, 2);

    // Deliver in reverse order
    const collector = createChunkCollector(chunks.length);
    const reversed = [...chunks].reverse();

    let result: Blob | null = null;
    for (const chunk of reversed) {
      result = collector.addChunk(chunk);
    }

    expect(result).not.toBeNull();
    const recovered = new Uint8Array(await result!.arrayBuffer());
    expect(recovered).toEqual(original);
  });

  it('ignores duplicate chunks', () => {
    const chunk: Chunk = {
      chunkIndex: 0,
      totalChunks: 2,
      data: arrayBufferToBase64(new Uint8Array([1]).buffer),
    };

    const collector = createChunkCollector(2);
    collector.addChunk(chunk);
    collector.addChunk(chunk); // duplicate
    expect(collector.received).toBe(1);
  });

  it('fires progress callback', () => {
    const progress = vi.fn();
    const collector = createChunkCollector(3, progress);

    collector.addChunk({ chunkIndex: 0, totalChunks: 3, data: arrayBufferToBase64(new Uint8Array([1]).buffer) });
    expect(progress).toHaveBeenCalledWith(1, 3);

    collector.addChunk({ chunkIndex: 2, totalChunks: 3, data: arrayBufferToBase64(new Uint8Array([3]).buffer) });
    expect(progress).toHaveBeenCalledWith(2, 3);
  });
});
