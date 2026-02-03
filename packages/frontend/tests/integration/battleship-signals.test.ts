import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";

import {
  BattleshipGame,
  createInitialState,
  commitmentRootHexForBoard,
  leafHash,
} from "../../src/game/modules/battleship";
import { verifyMerkleProof } from "../../src/crypto/merkle";
import {
  handleBattleshipSignal,
  type BattleshipGuessSignal,
} from "../../src/game/modules/battleship/signals";

describe("Battleship P2P signals", () => {
  it("guess -> reveal -> applyReveal works and verifies proof", () => {
    const matchID = "sig-test";

    // Player 1 owns a board with a ship at (0,0).
    const boardBits = Array.from({ length: 100 }, () => 0 as const);
    boardBits[0] = 1;
    const saltsHex = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(2, "0"),
    );
    const root = commitmentRootHexForBoard(matchID, "1", boardBits, saltsHex);

    // Defender (player 1) receives a guess from player 0.
    const guess: BattleshipGuessSignal = {
      game: "battleship",
      matchID,
      type: "bs_guess",
      fromPlayerId: "0",
      coord: { x: 0, y: 0 },
    };

    const defRes = handleBattleshipSignal({
      raw: guess,
      matchID,
      myId: "1",
      opponentId: "0",
      boardBits,
      saltsHex,
      haveMyCommitment: true,
    });

    expect(defRes.outgoingSignals).toHaveLength(1);
    const reveal = defRes.outgoingSignals[0] as any;
    expect(reveal.type).toBe("bs_reveal");
    expect(reveal.toPlayerId).toBe("0");
    expect(reveal.ownerId).toBe("1");
    expect(reveal.index).toBe(0);
    expect(reveal.bit).toBe(1);

    // Attacker verifies Merkle proof (same logic as applyReveal uses).
    const leaf = leafHash(matchID, "1", 0, 1, saltsHex[0]);
    expect(verifyMerkleProof(leaf, reveal.proof, root)).toBe(true);

    // Now attacker receives reveal and applies it through the Battleship move.
    const atkRes = handleBattleshipSignal({
      raw: reveal,
      matchID,
      myId: "0",
      opponentId: "1",
      boardBits: null,
      saltsHex: null,
      haveMyCommitment: true,
    });
    expect(atkRes.applyRevealActions).toHaveLength(1);

    const G = createInitialState(["0", "1"]);
    G.players["1"].commitmentRootHex = root;
    const ctx = { matchID, phase: "battle", currentPlayer: "0" } as any;

    const action = atkRes.applyRevealActions[0];
    const res = (BattleshipGame.phases as any).battle.moves.applyReveal.move(
      { G, ctx, playerID: "0" },
      action.coord,
      action.reveal,
    );
    expect(res).not.toBe(INVALID_MOVE);
    expect(G.players["0"].opponentMarks[0]).toBe("hit");
  });
});
