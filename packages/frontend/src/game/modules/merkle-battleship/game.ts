import type { Game } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";
import type { Coord, MerkleBattleshipState } from "./types";
import {
  createInitialState,
  allPlacementsConfirmed,
  publishCommitment,
  applyVerifiedGuess,
  coordToIndex,
  isValidCoord,
  hasAllShipsSunkFromMarks,
  claimTimeout,
  isTimedOut,
} from "./logic";
import type { MerkleProofStep } from "@manamesh/crypto";
import { verifyMerkleProof } from "@manamesh/crypto";
import { leafHash } from "./commitment";

type GuessReveal = {
  gameId: string;
  ownerId: string;
  index: number;
  bit: 0 | 1;
  saltHex: string;
  proof: MerkleProofStep[];
};

export const MerkleBattleshipGame: Game<MerkleBattleshipState> = {
  name: "merkle-battleship",

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
        // Both players commit independently.
        activePlayers: { all: "placement" },
      },
      moves: {
        publishCommitment: {
          move: ({ G, ctx, playerID }, commitmentRootHex: string) => {
            try {
              if (ctx.phase !== "placement") return INVALID_MOVE;

              // Fast-path predictable invalid states to avoid noisy logs.
              const player = G.players[playerID];
              if (!player) return INVALID_MOVE;
              if (player.placementConfirmed) return INVALID_MOVE;
              if (!/^[0-9a-fA-F]{64}$/.test(commitmentRootHex))
                return INVALID_MOVE;

              publishCommitment(G, playerID, commitmentRootHex);
              return G;
            } catch (e) {
              console.error("[merkle-battleship] publishCommitment failed", e);
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => {
        return allPlacementsConfirmed(G);
      },
      next: "battle",
      onEnd: ({ G }) => {
        // Keep G.phase in sync for transports that don't reliably run hooks.
        G.phase = "battle";
      },
    },
    battle: {
      turn: {
        minMoves: 1,
        maxMoves: 1,
      },
      moves: {
        recordGuess: {
          move: ({ G, ctx, playerID, events }, target: Coord) => {
            try {
              if (ctx.phase !== "battle") return INVALID_MOVE;
              if (!isValidCoord(target)) return INVALID_MOVE;
              if (G.pendingGuess) return INVALID_MOVE;

              const opponentId = Object.keys(G.players).find(
                (id) => id !== playerID,
              );
              if (!opponentId) return INVALID_MOVE;

              const idx = coordToIndex(target);
              if (G.players[playerID].opponentMarks[idx] !== "unknown") {
                return INVALID_MOVE;
              }

              G.pendingGuess = {
                attackerId: playerID,
                target,
                index: idx,
                sentAt: Date.now(),
              };

              events?.endTurn?.();
              return G;
            } catch (e) {
              console.error("[merkle-battleship] recordGuess failed", e);
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        applyReveal: {
          move: (
            { G, ctx, playerID, events },
            target: Coord,
            reveal: GuessReveal,
          ) => {
            try {
              if (ctx.phase !== "battle") return INVALID_MOVE;
              if (!isValidCoord(target)) return INVALID_MOVE;

              const opponentId = Object.keys(G.players).find(
                (id) => id !== playerID,
              );
              if (!opponentId) return INVALID_MOVE;
              if (reveal.ownerId !== opponentId) return INVALID_MOVE;

              const idx = coordToIndex(target);
              if (reveal.index !== idx) return INVALID_MOVE;

              if (G.players[playerID].opponentMarks[idx] !== "unknown") {
                return INVALID_MOVE;
              }

              const root = G.players[opponentId].commitmentRootHex;
              if (!root) return INVALID_MOVE;

              const leaf = leafHash(
                reveal.gameId,
                reveal.ownerId,
                reveal.index,
                reveal.bit,
                reveal.saltHex,
              );
              const ok = verifyMerkleProof(leaf, reveal.proof, root);
              if (!ok) return INVALID_MOVE;

              applyVerifiedGuess(
                G,
                playerID,
                target,
                reveal.bit === 1 ? "hit" : "miss",
              );

              G.pendingGuess = null;

              if (hasAllShipsSunkFromMarks(G.players[playerID].opponentMarks)) {
                G.winner = playerID;
                G.phase = "gameOver";
              }

              events?.endTurn?.();
              return G;
            } catch (e) {
              console.error("[merkle-battleship] applyReveal failed", e);
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        claimTimeout: {
          move: ({ G, ctx, playerID, events }) => {
            try {
              if (ctx.phase !== "battle") return INVALID_MOVE;
              if (!G.pendingGuess) return INVALID_MOVE;
              if (G.pendingGuess.attackerId !== playerID) return INVALID_MOVE;

              const { timedOut, defenderForfeited } = claimTimeout(G, playerID);
              if (!timedOut) return INVALID_MOVE;

              if (!defenderForfeited) {
                const opponentId = Object.keys(G.players).find(
                  (id) => id !== playerID,
                );
                if (!opponentId) return INVALID_MOVE;

                applyVerifiedGuess(G, playerID, G.pendingGuess.target, "miss");
                G.pendingGuess = null;
              }

              events?.endTurn?.();
              return G;
            } catch (e) {
              console.error("[merkle-battleship] claimTimeout failed", e);
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => {
        return !!G.winner;
      },
    },
  },

  endIf: ({ G }) => {
    if (G.winner) return { winner: G.winner };
    return undefined;
  },
};
