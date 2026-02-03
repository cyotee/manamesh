import type {
  Coord,
  MerkleBattleshipPlayerState,
  MerkleBattleshipState,
  ShipSpec,
} from "./types";
import { CELL_COUNT, GRID_SIZE, STANDARD_FLEET } from "./types";

export function coordToIndex(c: Coord): number {
  return c.y * GRID_SIZE + c.x;
}

export function isValidCoord(c: Coord): boolean {
  return (
    Number.isInteger(c.x) &&
    Number.isInteger(c.y) &&
    c.x >= 0 &&
    c.x < 10 &&
    c.y >= 0 &&
    c.y < 10
  );
}

function emptyMarks() {
  return Array.from({ length: CELL_COUNT }, () => "unknown" as const);
}

export function createEmptyPlayerState(): MerkleBattleshipPlayerState {
  return {
    placementConfirmed: false,
    commitmentRootHex: null,
    opponentCommitmentRootHex: null,
    opponentMarks: emptyMarks(),
  };
}

export function createInitialState(playerIDs: string[]): MerkleBattleshipState {
  const players: Record<string, MerkleBattleshipPlayerState> = {};
  for (const pid of playerIDs) {
    players[pid] = createEmptyPlayerState();
  }
  return {
    phase: "placement",
    players,
    guesses: [],
    winner: null,
  };
}

export function publishCommitment(
  state: MerkleBattleshipState,
  playerId: string,
  commitmentRootHex: string,
): MerkleBattleshipState {
  if (!/^[0-9a-fA-F]{64}$/.test(commitmentRootHex)) {
    throw new Error("Invalid commitment root");
  }

  const player = state.players[playerId];
  if (!player) throw new Error("Invalid player");
  if (player.placementConfirmed) throw new Error("Already confirmed");

  player.commitmentRootHex = commitmentRootHex.toLowerCase();
  player.placementConfirmed = true;
  return state;
}

export function allPlacementsConfirmed(state: MerkleBattleshipState): boolean {
  return Object.values(state.players).every(
    (p) => p.placementConfirmed && !!p.commitmentRootHex,
  );
}

export function applyVerifiedGuess(
  state: MerkleBattleshipState,
  guesserId: string,
  target: Coord,
  result: "hit" | "miss",
): MerkleBattleshipState {
  if (!isValidCoord(target)) throw new Error("Invalid target");

  const opponentId = Object.keys(state.players).find((id) => id !== guesserId);
  if (!opponentId) throw new Error("No opponent");

  const guesser = state.players[guesserId];
  if (!guesser) throw new Error("Invalid player");
  const idx = coordToIndex(target);
  if (guesser.opponentMarks[idx] !== "unknown")
    throw new Error("Already guessed");
  guesser.opponentMarks[idx] = result === "hit" ? "hit" : "miss";
  state.guesses.push({ by: guesserId, target, result, at: Date.now() });
  return state;
}

export function hasAllShipsSunkFromMarks(
  marks: Array<"unknown" | "miss" | "hit">,
  fleet: ShipSpec[] = STANDARD_FLEET,
): boolean {
  const requiredHits = fleet.reduce((acc, s) => acc + s.size, 0);
  const hitCount = marks.filter((m) => m === "hit").length;
  return hitCount >= requiredHits;
}
