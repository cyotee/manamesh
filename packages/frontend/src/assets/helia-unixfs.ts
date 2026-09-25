import type { Helia } from 'helia';
import { unixfs } from '@helia/unixfs';

/** Bridge Helia 4's byte-array blockstore to UnixFS 7's streaming API. */
export function unixfsForHelia(helia: Pick<Helia, 'blockstore'>) {
  const blockstore: Parameters<typeof unixfs>[0]['blockstore'] = {
    async *get(cid, options) {
      yield await helia.blockstore.get(cid, options);
    },
    has(cid, options) {
      return helia.blockstore.has(cid, options);
    },
    async put(cid, input, options) {
      if (input instanceof Uint8Array) {
        return helia.blockstore.put(cid, input, options);
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of input) {
        options?.signal?.throwIfAborted();
        chunks.push(chunk);
        length += chunk.length;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return helia.blockstore.put(cid, bytes, options);
    },
  };
  return unixfs({ blockstore });
}
