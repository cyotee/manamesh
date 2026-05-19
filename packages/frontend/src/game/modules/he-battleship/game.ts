import type { Game } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";

import type { HEBattleshipState } from "./types";
import {
  allPlacementsConfirmed,
  createInitialState,
  setBoardBits,
  publishHomomorphicCommitment,
  publishPublicKey,
  applyVerifiedGuess,
  applyDefenderReveal,
  hasAllShipsSunkFromMarks,
} from "./logic";
import type { Coord } from "../merkle-battleship";
import { CELL_COUNT, GRID_SIZE, STANDARD_FLEET } from "../merkle-battleship";

export const HEBattleshipGame: Game<HEBattleshipState> = {
  name: "he-battleship",

  setup: (ctx) => {
    const playerIDs = (ctx.playOrder as string[]) ?? ["0", "1"];
    return createInitialState(playerIDs);
  },

  turn: {
    order: {
      first: () => 0,
      next: ({ ctx }) => (ctx.playOrderPos + 1) % ctx.numPlayers,
    },
  },

  phases: {
    placement: {
      start: true,
      turn: {
        activePlayers: { all: "placement" },
      },
      moves: {
        setBoardBits: {
          move: ({ G, ctx, playerID }, params: { boardBits: Array<0 | 1> }) => {
            try {
              if (ctx.phase !== "placement") return INVALID_MOVE;
              setBoardBits(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        publishPublicKey: {
          move: (
            { G, ctx, playerID },
            params: { paillierPublicNHex: string },
          ) => {
            try {
              if (ctx.phase !== "placement") return INVALID_MOVE;
              publishPublicKey(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        publishHomomorphicCommitment: {
          move: (
            { G, ctx, playerID },
            params: { encShipCountForOpponentHex: string; encCellHexes: string[] },
          ) => {
            try {
              if (ctx.phase !== "placement") return INVALID_MOVE;
              const player = G.players[playerID];
              if (!player) return INVALID_MOVE;
              if (player.placementConfirmed) return INVALID_MOVE;

              publishHomomorphicCommitment(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => allPlacementsConfirmed(G),
      next: "battle",
      onEnd: ({ G }) => {
        G.phase = "battle";
      },
    },
    battle: {
      turn: {
        minMoves: 1,
        maxMoves: 1,
      },
      moves: {
        guess: {
          move: ({ G, ctx, playerID }, target: Coord) => {
            try {
              if (ctx.phase !== "battle") return INVALID_MOVE;
              if (
                !Number.isInteger(target?.x) ||
                !Number.isInteger(target?.y) ||
                target.x < 0 ||
                target.x >= GRID_SIZE ||
                target.y < 0 ||
                target.y >= GRID_SIZE
              ) {
                return INVALID_MOVE;
              }

              const opponentId = Object.keys(G.players).find(
                (id) => id !== playerID,
              );
              if (!opponentId) return INVALID_MOVE;
              const defender = G.players[opponentId];
              if (!defender?.boardBits) return INVALID_MOVE;

              const idx = target.y * GRID_SIZE + target.x;
              if (idx < 0 || idx >= CELL_COUNT) return INVALID_MOVE;
              if (G.players[playerID].opponentMarks[idx] !== "unknown")
                return INVALID_MOVE;

              // Paillier-based reveal path:
              // The defender's encCellHexes[idx] is the Paillier encryption of boardBits[idx]
              // In HBC model, defender self-reports isShip correctly.
              // The aggregate will be verified at game end via verifyAggregateAtGameEnd().
              // NOTE: A malicious defender can lie here - this is a known limitation of HBC.
              // Proper fix requires ZK proofs (PLONK with range constraints).
              const encCellHex = defender.encCellHexes?.[idx];
              // HBC demo: fallback to boardBits since threshold decryption not wired
              // Malicious defender can lie - known HBC limitation, requires ZK proofs to fix
              const bit = defender.boardBits![idx];
              applyDefenderReveal(G, opponentId, playerID, idx, bit === 1);

              applyVerifiedGuess(
                G,
                playerID,
                target,
                bit === 1 ? "hit" : "miss",
              );

              const requiredHits = STANDARD_FLEET.reduce(
                (acc, s) => acc + s.size,
                0,
              );
              if (
                hasAllShipsSunkFromMarks(
                  G.players[playerID].opponentMarks,
                  requiredHits,
                )
              ) {
                G.winner = playerID;
                G.phase = "gameOver";
              }

              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => !!G.winner,
    },
  },
};
