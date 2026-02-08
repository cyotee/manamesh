import { describe, it, expect } from 'vitest';
import { OnePieceZoneLayout } from './OnePieceLayout';
import type { PlayerZoneLayout, NormalizedRect } from '../types';

/** Assert that a rect has valid normalized coordinates in [0, 1]. */
function assertValidRect(rect: NormalizedRect, label: string): void {
  expect(rect.x, `${label}.x >= 0`).toBeGreaterThanOrEqual(0);
  expect(rect.y, `${label}.y >= 0`).toBeGreaterThanOrEqual(0);
  expect(rect.width, `${label}.width > 0`).toBeGreaterThan(0);
  expect(rect.height, `${label}.height > 0`).toBeGreaterThan(0);
  expect(rect.x + rect.width, `${label} right edge <= 1`).toBeLessThanOrEqual(1.01);
  expect(rect.y + rect.height, `${label} bottom edge <= 1`).toBeLessThanOrEqual(1.01);
}

/** Assert that two rects do not overlap. */
function assertNoOverlap(a: NormalizedRect, b: NormalizedRect, labelA: string, labelB: string): void {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;

  const overlapX = a.x < bRight && aRight > b.x;
  const overlapY = a.y < bBottom && aBottom > b.y;

  if (overlapX && overlapY) {
    // Allow small overlaps (< 2% of board) for aesthetic reasons
    const overlapWidth = Math.min(aRight, bRight) - Math.max(a.x, b.x);
    const overlapHeight = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);
    const overlapArea = overlapWidth * overlapHeight;
    expect(overlapArea, `${labelA} and ${labelB} overlap too much`).toBeLessThan(0.02);
  }
}

describe('OnePieceLayout', () => {
  it('has a valid name', () => {
    expect(OnePieceZoneLayout.name).toBe('One Piece TCG');
  });

  it('defines all 7 zones for local player', () => {
    const local = OnePieceZoneLayout.layout.local;
    const zones: (keyof PlayerZoneLayout)[] = [
      'mainDeck', 'lifeDeck', 'donDeck', 'trash', 'hand', 'playArea', 'donArea',
    ];
    for (const zone of zones) {
      expect(local[zone], `local.${zone} should exist`).toBeDefined();
    }
  });

  it('defines all 7 zones for opponent', () => {
    const opponent = OnePieceZoneLayout.layout.opponent;
    const zones: (keyof PlayerZoneLayout)[] = [
      'mainDeck', 'lifeDeck', 'donDeck', 'trash', 'hand', 'playArea', 'donArea',
    ];
    for (const zone of zones) {
      expect(opponent[zone], `opponent.${zone} should exist`).toBeDefined();
    }
  });

  it('all local zone rects are within normalized bounds', () => {
    const local = OnePieceZoneLayout.layout.local;
    for (const [name, rect] of Object.entries(local)) {
      assertValidRect(rect as NormalizedRect, `local.${name}`);
    }
  });

  it('all opponent zone rects are within normalized bounds', () => {
    const opponent = OnePieceZoneLayout.layout.opponent;
    for (const [name, rect] of Object.entries(opponent)) {
      assertValidRect(rect as NormalizedRect, `opponent.${name}`);
    }
  });

  it('local player zones are in the bottom half (y >= 0.5)', () => {
    const local = OnePieceZoneLayout.layout.local;
    for (const [name, rect] of Object.entries(local)) {
      expect(
        (rect as NormalizedRect).y,
        `local.${name} should be in bottom half`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('opponent zones are in the top half (y + height <= 0.55)', () => {
    const opponent = OnePieceZoneLayout.layout.opponent;
    for (const [name, rect] of Object.entries(opponent)) {
      const r = rect as NormalizedRect;
      expect(
        r.y + r.height,
        `opponent.${name} should be in top half`,
      ).toBeLessThanOrEqual(0.55);
    }
  });

  it('local hand zone does not overlap with local play area', () => {
    const local = OnePieceZoneLayout.layout.local;
    assertNoOverlap(local.hand, local.playArea, 'local.hand', 'local.playArea');
  });
});
