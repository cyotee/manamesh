export type MerkleBattleshipPhase = "placement" | "battle" | "gameOver";

export type CellBit = 0 | 1;
export type CellMark = "unknown" | "miss" | "hit";

export interface Coord {
  x: number; // 0-9
  y: number; // 0-9
}

export type Orientation = "horizontal" | "vertical";

export interface ShipSpec {
  id: string;
  name: string;
  size: number;
}

export interface PlacedShip {
  id: string;
  start: Coord;
  orientation: Orientation;
  size: number;
}

export interface GuessRecord {
  by: string;
  target: Coord;
  result: "hit" | "miss";
  at: number;
}

export interface MerkleBattleshipPlayerState {
  placementConfirmed: boolean;
  commitmentRootHex: string | null;

  opponentCommitmentRootHex: string | null;
  opponentMarks: CellMark[]; // length 100
}

export interface MerkleBattleshipState {
  phase: MerkleBattleshipPhase;
  players: Record<string, MerkleBattleshipPlayerState>;
  guesses: GuessRecord[];
  winner: string | null;
}

export const GRID_SIZE = 10;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export const STANDARD_FLEET: ShipSpec[] = [
  { id: "carrier", name: "Carrier", size: 5 },
  { id: "battleship", name: "Battleship", size: 4 },
  { id: "cruiser", name: "Cruiser", size: 3 },
  { id: "submarine", name: "Submarine", size: 3 },
  { id: "destroyer", name: "Destroyer", size: 2 },
];
