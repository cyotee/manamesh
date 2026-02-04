import { describe, it, expect } from "vitest";

import { createInitialState } from "./logic";
import { auditFullReveal } from "./audit";
import { commitmentRootHexForBoard } from "./commitment";

describe("merkle-battleship/audit", () => {
  it("matches commitment root for full reveal", () => {
    const state = createInitialState(["0", "1"]);
    const boardBits = Array.from({ length: 100 }, () => 0 as const);
    boardBits[0] = 1;
    const saltsHex = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(2, "0"),
    );

    const expectedRootHex = commitmentRootHexForBoard(
      "m",
      "1",
      boardBits,
      saltsHex,
    );

    const res = auditFullReveal({
      matchID: "m",
      ownerId: "1",
      boardBits,
      saltsHex,
      expectedRootHex,
      state,
    });

    expect(res.rootMatches).toBe(true);
    expect(res.computedRootHex).toBe(expectedRootHex);
    expect(res.guessMismatches).toHaveLength(0);
  });

  it("detects inconsistent guess results against revealed board", () => {
    const state = createInitialState(["0", "1"]);
    state.phase = "battle";
    state.guesses.push({
      by: "0",
      target: { x: 0, y: 0 },
      result: "hit",
      at: 0,
    });

    const boardBits = Array.from({ length: 100 }, () => 0 as const);
    // bit at (0,0) is 0 => expected miss, but guess says hit.
    const saltsHex = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(2, "0"),
    );

    const expectedRootHex = commitmentRootHexForBoard(
      "m",
      "1",
      boardBits,
      saltsHex,
    );

    const res = auditFullReveal({
      matchID: "m",
      ownerId: "1",
      boardBits,
      saltsHex,
      expectedRootHex,
      state,
    });

    expect(res.rootMatches).toBe(true);
    expect(res.guessMismatches.length).toBe(1);
    expect(res.guessMismatches[0].expected).toBe("miss");
    expect(res.guessMismatches[0].got).toBe("hit");
  });
});
