import { describe, it, expect } from 'vitest';
import { ResponsiveScaler } from './ResponsiveScaler';
import type { NormalizedRect } from '../types';

describe('ResponsiveScaler', () => {
  it('converts normalized rect to pixels', () => {
    const scaler = new ResponsiveScaler(1000, 800);
    const normalized: NormalizedRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };

    const pixels = scaler.toPixels(normalized);

    expect(pixels.x).toBe(100);
    expect(pixels.y).toBe(160);
    expect(pixels.width).toBe(500);
    expect(pixels.height).toBe(240);
  });

  it('computes center of a normalized rect', () => {
    const scaler = new ResponsiveScaler(1000, 800);
    const normalized: NormalizedRect = { x: 0.0, y: 0.0, width: 1.0, height: 1.0 };

    const center = scaler.centerOf(normalized);

    expect(center.x).toBe(500);
    expect(center.y).toBe(400);
  });

  it('handles zero-sized scenes', () => {
    const scaler = new ResponsiveScaler(0, 0);
    const normalized: NormalizedRect = { x: 0.5, y: 0.5, width: 0.3, height: 0.3 };

    const pixels = scaler.toPixels(normalized);

    expect(pixels.x).toBe(0);
    expect(pixels.y).toBe(0);
    expect(pixels.width).toBe(0);
    expect(pixels.height).toBe(0);
  });

  it('updates dimensions on resize', () => {
    const scaler = new ResponsiveScaler(100, 100);
    const rect: NormalizedRect = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };

    expect(scaler.toPixels(rect).x).toBe(50);

    scaler.resize(200, 200);
    expect(scaler.toPixels(rect).x).toBe(100);
  });

  it('scales card dimensions to fit zone height', () => {
    const scaler = new ResponsiveScaler(1000, 800);
    const zoneRect: NormalizedRect = { x: 0, y: 0, width: 1.0, height: 0.15 };
    // Zone height = 0.15 * 800 = 120px, 85% = 102px
    // Card height = 112px > 102px, so it should scale down

    const scaled = scaler.scaleCard({ width: 80, height: 112 }, zoneRect);

    expect(scaled.height).toBeLessThanOrEqual(102);
    expect(scaled.width).toBeLessThan(80);
    // Aspect ratio should be preserved
    const originalRatio = 80 / 112;
    const scaledRatio = scaled.width / scaled.height;
    expect(Math.abs(originalRatio - scaledRatio)).toBeLessThan(0.02);
  });

  it('does not upscale cards larger than base size', () => {
    const scaler = new ResponsiveScaler(1000, 800);
    const zoneRect: NormalizedRect = { x: 0, y: 0, width: 1.0, height: 0.5 };
    // Zone height = 400px, 85% = 340px > 112px, so no scaling needed

    const scaled = scaler.scaleCard({ width: 80, height: 112 }, zoneRect);

    expect(scaled.width).toBe(80);
    expect(scaled.height).toBe(112);
  });

  it('exposes width and height getters', () => {
    const scaler = new ResponsiveScaler(1920, 1080);
    expect(scaler.width).toBe(1920);
    expect(scaler.height).toBe(1080);
  });
});
