import type { CellBit, Coord, ShipSpec } from "./types";
import { CELL_COUNT, GRID_SIZE, STANDARD_FLEET } from "./types";

function indexToCoord(index: number): Coord {
  return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
}

function coordToIndex(c: Coord): number {
  return c.y * GRID_SIZE + c.x;
}

function neighbors4(index: number): number[] {
  const { x, y } = indexToCoord(index);
  const out: number[] = [];
  if (x > 0) out.push(coordToIndex({ x: x - 1, y }));
  if (x < GRID_SIZE - 1) out.push(coordToIndex({ x: x + 1, y }));
  if (y > 0) out.push(coordToIndex({ x, y: y - 1 }));
  if (y < GRID_SIZE - 1) out.push(coordToIndex({ x, y: y + 1 }));
  return out;
}

function isStraightContiguousLine(cells: number[]): boolean {
  if (cells.length <= 1) return true;
  const coords = cells.map(indexToCoord);
  const xs = coords.map((c) => c.x);
  const ys = coords.map((c) => c.y);
  const allSameX = xs.every((x) => x === xs[0]);
  const allSameY = ys.every((y) => y === ys[0]);
  if (!allSameX && !allSameY) return false;

  if (allSameY) {
    const sorted = xs.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    return true;
  }

  const sorted = ys.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  return true;
}

function extractLineFromComponent(
  componentSet: Set<number>,
  length: number,
): number[] | null {
  // Enumerate maximal horizontal segments.
  let bestH: number[] = [];
  for (const idx of componentSet) {
    const { x, y } = indexToCoord(idx);
    // Start of a segment if left neighbor isn't occupied.
    if (x > 0 && componentSet.has(coordToIndex({ x: x - 1, y }))) continue;
    const seg: number[] = [];
    for (let xx = x; xx < GRID_SIZE; xx++) {
      const j = coordToIndex({ x: xx, y });
      if (!componentSet.has(j)) break;
      seg.push(j);
    }
    if (seg.length > bestH.length) bestH = seg;
  }

  // Enumerate maximal vertical segments.
  let bestV: number[] = [];
  for (const idx of componentSet) {
    const { x, y } = indexToCoord(idx);
    if (y > 0 && componentSet.has(coordToIndex({ x, y: y - 1 }))) continue;
    const seg: number[] = [];
    for (let yy = y; yy < GRID_SIZE; yy++) {
      const j = coordToIndex({ x, y: yy });
      if (!componentSet.has(j)) break;
      seg.push(j);
    }
    if (seg.length > bestV.length) bestV = seg;
  }

  const candidates: number[][] = [];
  if (bestH.length >= length) {
    for (let i = 0; i <= bestH.length - length; i++) {
      candidates.push(bestH.slice(i, i + length));
    }
  }
  if (bestV.length >= length) {
    for (let i = 0; i <= bestV.length - length; i++) {
      candidates.push(bestV.slice(i, i + length));
    }
  }

  for (const c of candidates) {
    if (isStraightContiguousLine(c)) return c;
  }
  return null;
}

function sameMultiset(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const aa = a.slice().sort((x, y) => x - y);
  const bb = b.slice().sort((x, y) => x - y);
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

export type FleetValidation = {
  ok: boolean;
  reason?: string;
  shipSizesFound: number[];
  requiredShipSizes: number[];
  occupiedCount: number;
};

export function validateFleetFromBits(
  boardBits: CellBit[],
  fleet: ShipSpec[] = STANDARD_FLEET,
): FleetValidation {
  if (boardBits.length !== CELL_COUNT) {
    return {
      ok: false,
      reason: `boardBits must be ${CELL_COUNT}`,
      shipSizesFound: [],
      requiredShipSizes: fleet.map((s) => s.size),
      occupiedCount: boardBits.filter((b) => b === 1).length,
    };
  }

  const requiredShipSizes = fleet.map((s) => s.size);
  const requiredCells = requiredShipSizes.reduce((acc, n) => acc + n, 0);

  const occupied = new Set<number>();
  for (let i = 0; i < CELL_COUNT; i++) if (boardBits[i] === 1) occupied.add(i);
  if (occupied.size !== requiredCells) {
    return {
      ok: false,
      reason: `Expected ${requiredCells} occupied cells, got ${occupied.size}`,
      shipSizesFound: [],
      requiredShipSizes,
      occupiedCount: occupied.size,
    };
  }

  // We allow ships to touch orthogonally; therefore we cannot treat each 4-connected
  // component as a single ship. Instead, partition occupied cells into the required
  // straight contiguous ship segments.
  const remaining = new Set<number>(occupied);
  const shipSizesFound: number[] = [];

  const sizesDesc = requiredShipSizes.slice().sort((a, b) => b - a);
  for (const size of sizesDesc) {
    let placed = false;

    // Prefer extracting from a connected component (keeps search local), but fall back
    // to global scan if needed.
    const visited = new Set<number>();
    for (const start of remaining) {
      if (visited.has(start)) continue;
      const queue: number[] = [start];
      visited.add(start);
      const component: number[] = [];

      while (queue.length) {
        const cur = queue.shift()!;
        component.push(cur);
        for (const nb of neighbors4(cur)) {
          if (!remaining.has(nb)) continue;
          if (visited.has(nb)) continue;
          visited.add(nb);
          queue.push(nb);
        }
      }

      const componentSet = new Set<number>(component);
      const line = extractLineFromComponent(componentSet, size);
      if (!line) continue;

      // Remove extracted ship cells from remaining.
      for (const idx of line) remaining.delete(idx);
      shipSizesFound.push(size);
      placed = true;
      break;
    }

    if (!placed) {
      return {
        ok: false,
        reason: `Could not partition fleet into required ship sizes`,
        shipSizesFound,
        requiredShipSizes,
        occupiedCount: occupied.size,
      };
    }
  }

  if (remaining.size !== 0) {
    return {
      ok: false,
      reason: `Extra occupied cells after partition (${remaining.size})`,
      shipSizesFound,
      requiredShipSizes,
      occupiedCount: occupied.size,
    };
  }

  return {
    ok: true,
    shipSizesFound,
    requiredShipSizes,
    occupiedCount: occupied.size,
  };
}
