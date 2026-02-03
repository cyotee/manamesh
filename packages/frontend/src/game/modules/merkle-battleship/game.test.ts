import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";

import { MerkleBattleshipGame } from "./game";
import { createInitialState } from "./logic";
import { commitmentRootHexForBoard, proofForIndex } from "./commitment";

function setupTwoPlayerState() {
  const G = createInitialState(["0", "1"]);
  const ctx = {
    matchID: "test-match",
    currentPlayer: "0",
  } as any;
  return { G, ctx };
}

describe("MerkleBattleshipGame", () => {
  it("publishCommitment accepts valid root and locks placement", () => {
    const { G } = setupTwoPlayerState();
    const root = "a".repeat(64);

    const res1 = (
      MerkleBattleshipGame.phases as any
    ).placement.moves.publishCommitment.move(
      { G, ctx: { matchID: "m", phase: "placement" }, playerID: "0" },
      root,
    );
    expect(res1).not.toBe(INVALID_MOVE);
    expect(G.players["0"].placementConfirmed).toBe(true);
    expect(G.players["0"].commitmentRootHex).toBe(root);

    const res2 = (
      MerkleBattleshipGame.phases as any
    ).placement.moves.publishCommitment.move(
      { G, ctx: { matchID: "m", phase: "placement" }, playerID: "0" },
      root,
    );
    expect(res2).toBe(INVALID_MOVE);
  });

  it("applyReveal rejects mismatched proof", () => {
    const { G, ctx } = setupTwoPlayerState();

    const boardBits = Array.from({ length: 100 }, () => 0 as const);
    boardBits[0] = 1;
    const salts = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(2, "0"),
    );

    // Set opponent commitment root on the opponent slice.
    G.players["1"].commitmentRootHex = commitmentRootHexForBoard(
      ctx.matchID,
      "1",
      boardBits,
      salts,
    );
    ctx.phase = "battle";

    const badProof = proofForIndex(ctx.matchID, "1", boardBits, salts, 1);

    const res = (
      MerkleBattleshipGame.phases as any
    ).battle.moves.applyReveal.move(
      { G, ctx, playerID: "0" },
      { x: 0, y: 0 },
      {
        gameId: ctx.matchID,
        ownerId: "1",
        index: 0,
        bit: 1,
        saltHex: salts[0],
        proof: badProof,
      },
    );

    expect(res).toBe(INVALID_MOVE);
  });

  it("applyReveal accepts valid proof and marks hit", () => {
    const { G, ctx } = setupTwoPlayerState();

    const boardBits = Array.from({ length: 100 }, () => 0 as const);
    boardBits[0] = 1;
    const salts = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(2, "0"),
    );

    G.players["1"].commitmentRootHex = commitmentRootHexForBoard(
      ctx.matchID,
      "1",
      boardBits,
      salts,
    );
    ctx.phase = "battle";

    const proof = proofForIndex(ctx.matchID, "1", boardBits, salts, 0);
    const res = (
      MerkleBattleshipGame.phases as any
    ).battle.moves.applyReveal.move(
      { G, ctx, playerID: "0" },
      { x: 0, y: 0 },
      {
        gameId: ctx.matchID,
        ownerId: "1",
        index: 0,
        bit: 1,
        saltHex: salts[0],
        proof,
      },
    );

    expect(res).not.toBe(INVALID_MOVE);
    expect(G.players["0"].opponentMarks[0]).toBe("hit");
  });
});
