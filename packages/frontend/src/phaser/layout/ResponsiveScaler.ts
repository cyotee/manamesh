/**
 * ResponsiveScaler — Maps normalized (0–1) coordinates to pixel coordinates.
 *
 * Zone positions are defined in normalized space so they work at any resolution.
 * This scaler converts them to actual pixel positions for the current scene size.
 */

import type { NormalizedRect, CardDimensions } from '../types';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class ResponsiveScaler {
  constructor(
    private sceneWidth: number,
    private sceneHeight: number,
  ) {}

  /** Update scene dimensions (call on resize). */
  resize(width: number, height: number): void {
    this.sceneWidth = width;
    this.sceneHeight = height;
  }

  /** Convert a normalized rect to pixel coordinates. */
  toPixels(rect: NormalizedRect): PixelRect {
    return {
      x: rect.x * this.sceneWidth,
      y: rect.y * this.sceneHeight,
      width: rect.width * this.sceneWidth,
      height: rect.height * this.sceneHeight,
    };
  }

  /** Get the center point of a normalized rect in pixels. */
  centerOf(rect: NormalizedRect): { x: number; y: number } {
    return {
      x: (rect.x + rect.width / 2) * this.sceneWidth,
      y: (rect.y + rect.height / 2) * this.sceneHeight,
    };
  }

  /**
   * Scale card dimensions to fit within a zone, maintaining aspect ratio.
   * Returns scaled dimensions that fit the zone's height with some padding.
   */
  scaleCard(baseDimensions: CardDimensions, zoneRect: NormalizedRect): CardDimensions {
    const zonePixels = this.toPixels(zoneRect);
    const maxHeight = zonePixels.height * 0.85; // 85% of zone height
    const scale = Math.min(1, maxHeight / baseDimensions.height);
    return {
      width: Math.round(baseDimensions.width * scale),
      height: Math.round(baseDimensions.height * scale),
    };
  }

  /** Get current scene dimensions. */
  get width(): number {
    return this.sceneWidth;
  }

  get height(): number {
    return this.sceneHeight;
  }
}
