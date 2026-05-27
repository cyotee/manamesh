import type { HEBattleshipPlayerState, HEBattleshipState } from "./types";
import { CELL_COUNT, GRID_SIZE } from "../merkle-battleship";
import {
  paillierEncrypt,
  paillierDecrypt,
  paillierAdd,
  paillierPublicKeyFromNHex,
  bigintToHex,
} from "@manamesh/crypto/paillier";
import type { PaillierPrivateKey } from "@manamesh/crypto/paillier";

// Paillier utility functions working with hex strings
function paillierEncryptHex(nHex: string, m: number): string {
  const pk = paillierPublicKeyFromNHex(nHex);
  return bigintToHex(paillierEncrypt(pk, BigInt(m)));
}

function paillierDecryptHex(
  nHex: string,
  lambdaHex: string,
  muHex: string,
  cHex: string,
): number {
  const pk = paillierPublicKeyFromNHex(nHex);
  const sk: PaillierPrivateKey = {
    lambda: BigInt("0x" + lambdaHex),
    mu: BigInt("0x" + muHex),
  };
  const c = BigInt("0x" + cHex);
  return Number(paillierDecrypt(pk, sk, c));
}

function paillierAddHex(nHex: string, c1Hex: string, c2Hex: string): string {
  const pk = paillierPublicKeyFromNHex(nHex);
  const c1 = BigInt("0x" + c1Hex);
  const c2 = BigInt("0x" + c2Hex);
  return bigintToHex(paillierAdd(pk, c1, c2));
}

export function createEmptyPlayerState(): HEBattleshipPlayerState {
  return {
    placementConfirmed: false,
    paillierPublicNHex: null,
    encShipCountForOpponentHex: null,
    encCellHexes: null,
    boardBits: null,
    opponentMarks: Array.from({ length: CELL_COUNT }, () => "unknown" as const),
    revealedCells: {},
  };
}

export function createInitialState(playerIDs: string[]): HEBattleshipState {
  const players: Record<string, HEBattleshipPlayerState> = {};
  for (const pid of playerIDs) players[pid] = createEmptyPlayerState();
  return {
    phase: "placement",
    players,
    guesses: [],
    winner: null,
    verifiedHitCount: null,
    aggregateVerified: false,
  };
}

export function setBoardBits(
  state: HEBattleshipState,
  playerId: string,
  params: { boardBits: Array<0 | 1> },
): HEBattleshipState {
  const player = state.players[playerId];
  if (!player) throw new Error("Invalid player");
  if (player.placementConfirmed)
    throw new Error("Cannot change board after confirm");

  if (
    !Array.isArray(params.boardBits) ||
    params.boardBits.length !== CELL_COUNT
  )
    throw new Error("Invalid boardBits");
  if (!params.boardBits.every((b) => b === 0 || b === 1))
    throw new Error("Invalid boardBits");

  player.boardBits = params.boardBits as any;
  return state;
}

export function publishHomomorphicCommitment(
  state: HEBattleshipState,
  playerId: string,
  params: { encShipCountForOpponentHex: string; encCellHexes: string[] },
): HEBattleshipState {
  const player = state.players[playerId];
  if (!player) throw new Error("Invalid player");
  if (player.placementConfirmed) throw new Error("Already confirmed");
  if (!player.paillierPublicNHex)
    throw new Error("Publish Paillier public key first");
  if (!player.boardBits) throw new Error("Place ships first");

  const cHex = params.encShipCountForOpponentHex.startsWith("0x")
    ? params.encShipCountForOpponentHex.slice(2)
    : params.encShipCountForOpponentHex;

  if (!/^[0-9a-fA-F]+$/.test(cHex) || cHex.length < 8)
    throw new Error("Invalid ciphertext");

  const cells = params.encCellHexes;
  if (!Array.isArray(cells) || cells.length !== CELL_COUNT)
    throw new Error("Must provide 100 cell encryptions");

  // Verify: homomorphically sum all per-cell encryptions and check against encShipCountForOpponentHex
  let encSum = cells[0]!.startsWith("0x")
    ? cells[0].slice(2)
    : cells[0];
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i]!.startsWith("0x") ? cells[i].slice(2) : cells[i];
    encSum = paillierAddHex(player.paillierPublicNHex!, encSum, c);
  }

  // Check encSum === encShipCountForOpponentHex (exact hex comparison)
  if (encSum.toLowerCase() !== cHex.toLowerCase())
    throw new Error("Per-cell sum does not match committed ship count");

  player.encShipCountForOpponentHex = cHex.toLowerCase();
  player.encCellHexes = cells.map((c) =>
    c.startsWith("0x") ? c.slice(2).toLowerCase() : c.toLowerCase(),
  );
  player.placementConfirmed = true;
  return state;
}

export function publishPublicKey(
  state: HEBattleshipState,
  playerId: string,
  params: { paillierPublicNHex: string },
): HEBattleshipState {
  const player = state.players[playerId];
  if (!player) throw new Error("Invalid player");

  if (player.paillierPublicNHex)
    throw new Error("Public key already published");

  const nHex = params.paillierPublicNHex.startsWith("0x")
    ? params.paillierPublicNHex.slice(2)
    : params.paillierPublicNHex;

  if (!/^[0-9a-fA-F]+$/.test(nHex) || nHex.length < 8)
    throw new Error("Invalid Paillier public n");

  player.paillierPublicNHex = nHex.toLowerCase();
  return state;
}

export function allPlacementsConfirmed(state: HEBattleshipState): boolean {
  return Object.values(state.players).every(
    (p) =>
      p.placementConfirmed &&
      !!p.paillierPublicNHex &&
      !!p.encShipCountForOpponentHex &&
      !!p.boardBits,
  );
}

export function applyVerifiedGuess(
  state: HEBattleshipState,
  guesserId: string,
  target: { x: number; y: number },
  result: "hit" | "miss",
): HEBattleshipState {
  const guesser = state.players[guesserId];
  if (!guesser) throw new Error("Invalid player");

  const idx = target.y * GRID_SIZE + target.x;
  if (idx < 0 || idx >= CELL_COUNT) throw new Error("Invalid target");
  if (guesser.opponentMarks[idx] !== "unknown")
    throw new Error("Already guessed");

  guesser.opponentMarks[idx] = result;
  state.guesses.push({ by: guesserId, target, result, at: Date.now() } as any);
  return state;
}

export function hasAllShipsSunkFromMarks(
  marks: Array<"unknown" | "miss" | "hit">,
  requiredHits: number,
): boolean {
  return marks.filter((m) => m === "hit").length >= requiredHits;
}

export function applyDefenderReveal(
  state: HEBattleshipState,
  defenderId: string,
  attackerId: string,
  cellIdx: number,
  isShip: boolean,
): HEBattleshipState {
  const defender = state.players[defenderId];
  if (!defender) throw new Error("Invalid defender");

  if (!defender.revealedCells[attackerId]) {
    defender.revealedCells[attackerId] = [];
  }
  defender.revealedCells[attackerId]!.push({ idx: cellIdx, isShip });

  return state;
}

export function verifyAggregateAtGameEnd(
  state: HEBattleshipState,
  playerId: string,
): { verified: boolean; claimedHits: number; committedTotal: number } {
  const defender = state.players[playerId];
  if (!defender) throw new Error("Invalid player");

  const claimedHits = defender.revealedCells
    ? Object.values(defender.revealedCells).flat().filter((r) => r.isShip)
        .length
    : 0;

  // The committed total is the decryption of encShipCountForOpponentHex
  // In HBC model, we trust the defender's self-decryption for now
  // A real implementation would use threshold decryption
  let committedTotal = 0;
  if (defender.encShipCountForOpponentHex) {
    // Placeholder: would use threshold Paillier decryption in production
    // For HBC demo, we trust the defender's self-reported decryption
    committedTotal = claimedHits;
  }

  // Verify that hit count is reasonable (max 17 ship cells for standard fleet)
  const verified = claimedHits <= 17;

  return { verified, claimedHits, committedTotal };
}
