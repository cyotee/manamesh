/**
 * PlaceholderFactory — Generates placeholder card graphics.
 *
 * Creates simple card-shaped graphics for cards whose images haven't loaded yet.
 * Uses Phaser's Graphics API to draw directly to a RenderTexture.
 */

import Phaser from 'phaser';
import type { CardDimensions } from '../types';

/**
 * Generate a placeholder card back texture and register it in the scene.
 */
export function createPlaceholderBack(
  scene: Phaser.Scene,
  size: CardDimensions,
  key: string = 'placeholder_back',
): void {
  if (scene.textures.exists(key)) return;

  const rt = scene.add.renderTexture(0, 0, size.width, size.height);
  const g = scene.add.graphics();

  // Card background
  g.fillStyle(0x663322, 1);
  g.fillRoundedRect(0, 0, size.width, size.height, 4);

  // Border
  g.lineStyle(1, 0x886644, 0.8);
  g.strokeRoundedRect(1, 1, size.width - 2, size.height - 2, 4);

  // Cross-hatch pattern
  g.lineStyle(1, 0x553311, 0.3);
  for (let i = -size.height; i < size.width; i += 8) {
    g.lineBetween(i, 0, i + size.height, size.height);
    g.lineBetween(i + size.width, 0, i, size.height);
  }

  rt.draw(g);
  rt.saveTexture(key);
  g.destroy();
  rt.destroy();
}

/**
 * Generate a placeholder card face texture with a name label.
 */
export function createPlaceholderFace(
  scene: Phaser.Scene,
  size: CardDimensions,
  name: string,
  key: string,
): void {
  if (scene.textures.exists(key)) return;

  const rt = scene.add.renderTexture(0, 0, size.width, size.height);
  const g = scene.add.graphics();

  // Card background
  g.fillStyle(0x223355, 1);
  g.fillRoundedRect(0, 0, size.width, size.height, 4);

  // Border
  g.lineStyle(1, 0x4466aa, 0.6);
  g.strokeRoundedRect(1, 1, size.width - 2, size.height - 2, 4);

  rt.draw(g);

  // Name text
  const text = scene.add.text(size.width / 2, size.height / 2, name, {
    fontSize: '8px',
    fontFamily: 'sans-serif',
    color: '#aabbcc',
    wordWrap: { width: size.width - 8 },
    align: 'center',
  }).setOrigin(0.5);
  rt.draw(text);
  text.destroy();

  rt.saveTexture(key);
  g.destroy();
  rt.destroy();
}
