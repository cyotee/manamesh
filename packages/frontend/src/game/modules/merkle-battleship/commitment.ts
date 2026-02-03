import type { CellBit } from "./types";
import type { MerkleProofStep } from "../../../crypto";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  merkleProof,
  merkleRootHex,
  sha256,
  utf8Bytes,
} from "../../../crypto";

function assertHex(hex: string): void {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex");
  }
}

export function randomSaltHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

export function leafHash(
  gameId: string,
  playerId: string,
  index: number,
  bit: CellBit,
  saltHex: string,
): Uint8Array {
  assertHex(saltHex);
  const prefix = utf8Bytes(`${gameId}|${playerId}|${index}|${bit}|`);
  const salt = hexToBytes(saltHex);
  return sha256(concatBytes(prefix, salt));
}

export function buildLeaves(
  gameId: string,
  playerId: string,
  boardBits: CellBit[],
  saltByIndexHex: string[],
): Uint8Array[] {
  if (boardBits.length !== 100) throw new Error("boardBits must be 100");
  if (saltByIndexHex.length !== 100)
    throw new Error("saltByIndexHex must be 100");
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < 100; i++) {
    leaves.push(leafHash(gameId, playerId, i, boardBits[i], saltByIndexHex[i]));
  }
  return leaves;
}

export function commitmentRootHexForBoard(
  gameId: string,
  playerId: string,
  boardBits: CellBit[],
  saltByIndexHex: string[],
): string {
  return merkleRootHex(
    buildLeaves(gameId, playerId, boardBits, saltByIndexHex),
  );
}

export function proofForIndex(
  gameId: string,
  playerId: string,
  boardBits: CellBit[],
  saltByIndexHex: string[],
  index: number,
): MerkleProofStep[] {
  const leaves = buildLeaves(gameId, playerId, boardBits, saltByIndexHex);
  return merkleProof(leaves, index);
}
