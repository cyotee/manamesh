import type { Game } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";

import type { ThresholdTallyState } from "./types";
import {
  ackRoundResult,
  allAcks,
  allCiphertextsSubmitted,
  createInitialState,
  dkgReady,
  finalizeDkg,
  publishDkgCommitment,
  publishPublicShare,
  startNextRound,
  submitCiphertext,
  submitDecryptShare,
  confirmDkgShare,
} from "./logic";

export const ThresholdTallyGame: Game<ThresholdTallyState> = {
  name: "threshold-tally",

  setup: (ctx) => {
    const playerIDs = (ctx.playOrder as string[]) ?? ["0", "1", "2"];
    return createInitialState(playerIDs);
  },

  phases: {
    setup: {
      start: true,
      turn: { activePlayers: { all: "setup" } },
      moves: {
        publishDkgCommitment: {
          move: (
            { G, ctx, playerID },
            params: { c0Hex: string; c1Hex: string },
          ) => {
            try {
              if (ctx.phase !== "setup") return INVALID_MOVE;
              publishDkgCommitment(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        confirmDkgShare: {
          move: (
            { G, ctx, playerID },
            params: { fromPlayerId: string; ok: boolean },
          ) => {
            try {
              if (ctx.phase !== "setup") return INVALID_MOVE;
              confirmDkgShare(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        publishPublicShare: {
          move: ({ G, ctx, playerID }, params: { yHex: string }) => {
            try {
              if (ctx.phase !== "setup") return INVALID_MOVE;
              publishPublicShare(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
        finalizeDkg: {
          move: ({ G, ctx, playerID }) => {
            try {
              if (ctx.phase !== "setup") return INVALID_MOVE;
              finalizeDkg(G, playerID);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => dkgReady(G),
      next: "commit",
      onEnd: ({ G }) => {
        // Deterministically derive the aggregate public key once DKG is complete.
        // Anyone can trigger this in setup, but we do it here so it's guaranteed.
        if (!G.crypto.publicKeyHex) {
          try {
            finalizeDkg(G, "0");
          } catch {
            // Ignore: setup endIf ensures readiness; this is best-effort safety.
          }
        }
        G.phase = "commit";
      },
    },

    commit: {
      turn: { activePlayers: { all: "commit" } },
      moves: {
        submitCiphertext: {
          move: (
            { G, ctx, playerID },
            params: { c1Hex: string; c2Hex: string },
          ) => {
            try {
              if (ctx.phase !== "commit") return INVALID_MOVE;
              submitCiphertext(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => allCiphertextsSubmitted(G),
      next: "decrypt",
      onEnd: ({ G }) => {
        G.phase = "decrypt";
      },
    },

    decrypt: {
      turn: { activePlayers: { all: "decrypt" } },
      moves: {
        submitDecryptShare: {
          move: (
            { G, ctx, playerID },
            params: {
              partialHex: string;
              proof: { a1Hex: string; a2Hex: string; zHex: string };
            },
          ) => {
            try {
              if (ctx.phase !== "decrypt") return INVALID_MOVE;
              submitDecryptShare(G, playerID, params);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => G.roundState.decryptedTotal !== null,
      next: "resolve",
      onEnd: ({ G }) => {
        G.phase = "resolve";
      },
    },

    resolve: {
      turn: { activePlayers: { all: "resolve" } },
      moves: {
        ackRoundResult: {
          move: ({ G, ctx, playerID }) => {
            try {
              if (ctx.phase !== "resolve") return INVALID_MOVE;
              ackRoundResult(G, playerID);
              return G;
            } catch {
              return INVALID_MOVE;
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => allAcks(G),
      next: "commit",
      onEnd: ({ G }) => {
        startNextRound(G);
        G.phase = "commit";
      },
    },
  },
};
