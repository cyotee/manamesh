/**
 * IPFS CID Computation
 *
 * Computes a CIDv1 (raw codec + SHA-256) from a Blob.
 * This produces a valid IPFS content identifier (bafy...) that
 * uniquely identifies the blob's contents.
 */

import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';

/**
 * Compute a CIDv1 from a Blob using SHA-256 + raw codec.
 * Returns a base32-encoded CID string (bafy...).
 */
export async function computeCidFromBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, raw.code, hash);
  return cid.toString();
}
