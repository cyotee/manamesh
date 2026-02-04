// Reuse grid/placement primitives from Merkle Battleship.
import type { CellBit, CellMark, Coord } from "../merkle-battleship";
import { CELL_COUNT, STANDARD_FLEET } from "../merkle-battleship";

export type HEBattleshipPhase = "placement" | "battle" | "gameOver";

export type PaillierPublicNHex = string;
export type PaillierCiphertextHex = string;

export interface HEBattleshipPlayerState {
  // Publish-only, used by opponent to encrypt a value we can decrypt.
  paillierPublicNHex: PaillierPublicNHex | null;

  // Homomorphic (Paillier) demo commitment to ship count.
  // This value is encrypted under the opponent's public key.
  encShipCountForOpponentHex: PaillierCiphertextHex | null;

  // Convenience for gating UI.
  placementConfirmed: boolean;

  // Private placement (hidden from opponent via playerView).
  boardBits: CellBit[] | null;

  // Public battle info.
  opponentMarks: CellMark[]; // length 100
}

export interface GuessRecord {
  by: string;
  target: Coord;
  result: "hit" | "miss";
  at: number;
}

export interface HEBattleshipState {
  phase: HEBattleshipPhase;
  players: Record<string, HEBattleshipPlayerState>;

  guesses: GuessRecord[];
  winner: string | null;
}

export const HE_GRID_CELL_COUNT = CELL_COUNT;
export const HE_REQUIRED_HITS = STANDARD_FLEET.reduce(
  (acc, s) => acc + s.size,
  0,
);
