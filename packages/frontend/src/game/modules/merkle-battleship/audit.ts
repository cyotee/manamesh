import type { CellBit, Coord, MerkleBattleshipState } from "./types";
import { commitmentRootHexForBoard } from "./commitment";
import { coordToIndex } from "./logic";
import { validateFleetFromBits } from "./fleet";

export type AuditGuessMismatch = {
  by: string;
  target: Coord;
  expected: "hit" | "miss";
  got: "hit" | "miss";
};

function otherPlayerId(playerIds: string[], pid: string): string | null {
  if (playerIds.length !== 2) return null;
  return playerIds[0] === pid ? playerIds[1] : playerIds[0];
}

export function auditFullReveal(params: {
  matchID: string;
  ownerId: string;
  boardBits: CellBit[];
  saltsHex: string[];
  expectedRootHex: string;
  state: MerkleBattleshipState;
}): {
  computedRootHex: string;
  rootMatches: boolean;
  guessMismatches: AuditGuessMismatch[];
  fleetOk: boolean;
  fleetReason?: string;
} {
  const computedRootHex = commitmentRootHexForBoard(
    params.matchID,
    params.ownerId,
    params.boardBits,
    params.saltsHex,
  );

  const rootMatches =
    computedRootHex.toLowerCase() === params.expectedRootHex.toLowerCase();

  const playerIds = Object.keys(params.state.players);
  const guessMismatches: AuditGuessMismatch[] = [];

  // For a 2P game: each guess targets the guesser's opponent.
  for (const g of params.state.guesses) {
    const ownerOfThisGuess = otherPlayerId(playerIds, g.by);
    if (!ownerOfThisGuess) break;
    if (ownerOfThisGuess !== params.ownerId) continue;

    const idx = coordToIndex(g.target);
    const bit = params.boardBits[idx];
    const expected: "hit" | "miss" = bit === 1 ? "hit" : "miss";
    if (g.result !== expected) {
      guessMismatches.push({
        by: g.by,
        target: g.target,
        expected,
        got: g.result,
      });
    }
  }

  const fleet = validateFleetFromBits(params.boardBits);

  return {
    computedRootHex,
    rootMatches,
    guessMismatches,
    fleetOk: fleet.ok,
    fleetReason: fleet.ok ? undefined : fleet.reason,
  };
}
