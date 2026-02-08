/**
 * CardIndicators — Visual overlays for card state.
 *
 * Renders tap rotation, counter badges, DON!! attachments, visibility borders,
 * and power displays as Phaser game objects layered on top of card sprites.
 */

import Phaser from 'phaser';
import type { CardSceneState, CardDimensions } from '../types';

/** Colors for visibility state borders */
const VISIBILITY_COLORS: Record<string, number> = {
  'encrypted': 0x333333,
  'owner-known': 0x4488ff,
  'opponent-known': 0xff4444,
  'all-known': 0xffcc00,
  'secret': 0x222222,
  'public': 0x000000, // no border
};

const VISIBILITY_ALPHA: Record<string, number> = {
  'encrypted': 0.6,
  'owner-known': 0.0,
  'opponent-known': 0.0,
  'all-known': 0.0,
  'secret': 0.7,
  'public': 0.0,
};

const BORDER_ALPHA: Record<string, number> = {
  'encrypted': 0.8,
  'owner-known': 0.6,
  'opponent-known': 0.6,
  'all-known': 0.5,
  'secret': 0.8,
  'public': 0.0,
};

/**
 * Create a dark overlay for encrypted/secret cards.
 */
export function createVisibilityOverlay(
  scene: Phaser.Scene,
  cardSize: CardDimensions,
  visibility: string,
): Phaser.GameObjects.Rectangle | null {
  const alpha = VISIBILITY_ALPHA[visibility] ?? 0;
  if (alpha <= 0) return null;

  const overlay = scene.add.rectangle(
    0, 0,
    cardSize.width, cardSize.height,
    VISIBILITY_COLORS[visibility] ?? 0x000000,
    alpha,
  );
  return overlay;
}

/**
 * Create a colored border for visibility states.
 */
export function createVisibilityBorder(
  scene: Phaser.Scene,
  cardSize: CardDimensions,
  visibility: string,
): Phaser.GameObjects.Rectangle | null {
  const alpha = BORDER_ALPHA[visibility] ?? 0;
  if (alpha <= 0) return null;

  const border = scene.add.rectangle(
    0, 0,
    cardSize.width + 4, cardSize.height + 4,
  );
  border.setStrokeStyle(2, VISIBILITY_COLORS[visibility] ?? 0x000000, alpha);
  border.setFillStyle(0x000000, 0);
  return border;
}

/**
 * Create a counter badge (e.g., "+1000").
 */
export function createCounterBadge(
  scene: Phaser.Scene,
  counter: number,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);

  const bg = scene.add.circle(0, 0, 14, 0x22aa22, 0.9);
  const text = scene.add.text(0, 0, `+${counter}`, {
    fontSize: '10px',
    fontFamily: 'monospace',
    color: '#ffffff',
    fontStyle: 'bold',
  }).setOrigin(0.5);

  container.add([bg, text]);
  return container;
}

/**
 * Create a power badge for characters/leaders in play.
 */
export function createPowerBadge(
  scene: Phaser.Scene,
  power: number,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);

  const bg = scene.add.rectangle(0, 0, 36, 16, 0xcc4400, 0.9);
  bg.setStrokeStyle(1, 0xffffff, 0.5);
  const text = scene.add.text(0, 0, `${power}`, {
    fontSize: '10px',
    fontFamily: 'monospace',
    color: '#ffffff',
    fontStyle: 'bold',
  }).setOrigin(0.5);

  container.add([bg, text]);
  return container;
}

/**
 * Create DON!! attachment indicator.
 */
export function createDonBadge(
  scene: Phaser.Scene,
  count: number,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);

  const bg = scene.add.circle(0, 0, 12, 0xdd8800, 0.9);
  const text = scene.add.text(0, 0, `${count}`, {
    fontSize: '10px',
    fontFamily: 'monospace',
    color: '#ffffff',
    fontStyle: 'bold',
  }).setOrigin(0.5);

  container.add([bg, text]);
  return container;
}

/**
 * Create a lock icon for encrypted cards.
 */
export function createLockIcon(
  scene: Phaser.Scene,
): Phaser.GameObjects.Text {
  return scene.add.text(0, 0, '\u{1F512}', {
    fontSize: '16px',
  }).setOrigin(0.5);
}

/**
 * Apply all relevant indicators to a card container.
 * Returns the indicator objects so they can be managed by CardSprite.
 */
export function applyIndicators(
  scene: Phaser.Scene,
  card: CardSceneState,
  cardSize: CardDimensions,
): Phaser.GameObjects.GameObject[] {
  const indicators: Phaser.GameObjects.GameObject[] = [];

  // Visibility border
  const border = createVisibilityBorder(scene, cardSize, card.visibility);
  if (border) indicators.push(border);

  // Visibility overlay
  const overlay = createVisibilityOverlay(scene, cardSize, card.visibility);
  if (overlay) indicators.push(overlay);

  // Lock icon for encrypted
  if (card.visibility === 'encrypted' || card.visibility === 'secret') {
    const lock = createLockIcon(scene);
    indicators.push(lock);
  }

  // Counter badge (top-right)
  if (card.counter != null && card.counter > 0) {
    const badge = createCounterBadge(scene, card.counter);
    badge.setPosition(cardSize.width / 2 - 14, -cardSize.height / 2 + 14);
    indicators.push(badge);
  }

  // Power badge (bottom-center)
  if (card.power != null) {
    const badge = createPowerBadge(scene, card.power);
    badge.setPosition(0, cardSize.height / 2 - 10);
    indicators.push(badge);
  }

  // DON!! badge (top-left)
  if (card.attachedDon > 0) {
    const badge = createDonBadge(scene, card.attachedDon);
    badge.setPosition(-cardSize.width / 2 + 14, -cardSize.height / 2 + 14);
    indicators.push(badge);
  }

  return indicators;
}
