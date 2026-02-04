import { describe, it, expect } from "vitest";

import { validateFleetFromBits } from "./fleet";
import { CELL_COUNT } from "./types";

function emptyBoard() {
  return Array.from({ length: CELL_COUNT }, () => 0 as const);
}

describe("merkle-battleship/fleet", () => {
  it("accepts a standard legal fleet", () => {
    const bits = emptyBoard();

    // Sizes: 5,4,3,3,2. Place them horizontally with gaps.
    // Row 0: x=0..4 (size 5)
    for (let x = 0; x < 5; x++) bits[0 * 10 + x] = 1;
    // Row 2: x=0..3 (size 4)
    for (let x = 0; x < 4; x++) bits[2 * 10 + x] = 1;
    // Row 4: x=0..2 (size 3)
    for (let x = 0; x < 3; x++) bits[4 * 10 + x] = 1;
    // Row 6: x=0..2 (size 3)
    for (let x = 0; x < 3; x++) bits[6 * 10 + x] = 1;
    // Row 8: x=0..1 (size 2)
    for (let x = 0; x < 2; x++) bits[8 * 10 + x] = 1;

    const res = validateFleetFromBits(bits);
    expect(res.ok).toBe(true);
  });

  it("rejects wrong occupied cell count", () => {
    const bits = emptyBoard();
    bits[0] = 1;
    const res = validateFleetFromBits(bits);
    expect(res.ok).toBe(false);
  });

  it("rejects L-shaped ship", () => {
    const bits = emptyBoard();

    // Make a 3-cell L component.
    bits[0] = 1; // (0,0)
    bits[1] = 1; // (1,0)
    bits[10] = 1; // (0,1)

    // Fill remaining cells to reach 17 with a legal set of lines, but keep this invalid.
    // Add a size-5 line.
    for (let x = 0; x < 5; x++) bits[2 * 10 + x] = 1;
    // Add size-4 line.
    for (let x = 0; x < 4; x++) bits[4 * 10 + x] = 1;
    // Add size-3 line (already have 3 in L, so add size-3 line and size-2 line to make total 17).
    for (let x = 0; x < 3; x++) bits[6 * 10 + x] = 1;
    for (let x = 0; x < 2; x++) bits[8 * 10 + x] = 1;

    const res = validateFleetFromBits(bits);
    expect(res.ok).toBe(false);
  });

  it("accepts orthogonally touching ships (ships are defined by required sizes)", () => {
    const bits = emptyBoard();

    // Create a horizontal size-5 at y=0, x=0..4.
    for (let x = 0; x < 5; x++) bits[0 * 10 + x] = 1;

    // Create a vertical size-4 that touches the middle of that ship at (2,0).
    // Occupies (2,1..4) so the occupied cells form a T-shape connected component.
    for (let y = 1; y <= 4; y++) bits[y * 10 + 2] = 1;

    // Add two size-3 lines and a size-2 line elsewhere so occupied count is 17.
    for (let x = 0; x < 3; x++) bits[6 * 10 + x] = 1;
    for (let x = 0; x < 3; x++) bits[8 * 10 + x] = 1;
    for (let x = 0; x < 2; x++) bits[9 * 10 + x] = 1;

    const res = validateFleetFromBits(bits);
    expect(res.ok).toBe(true);
  });
});
