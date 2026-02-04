import type { HEBattleshipPlayerState, HEBattleshipState } from "./types";
import { CELL_COUNT, GRID_SIZE } from "../merkle-battleship";

export function createEmptyPlayerState(): HEBattleshipPlayerState {
  return {
    placementConfirmed: false,
    paillierPublicNHex: null,
    encShipCountForOpponentHex: null,
    boardBits: null,
    opponentMarks: Array.from({ length: CELL_COUNT }, () => "unknown" as const),
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
  params: { encShipCountForOpponentHex: string },
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

  player.encShipCountForOpponentHex = cHex.toLowerCase();
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
