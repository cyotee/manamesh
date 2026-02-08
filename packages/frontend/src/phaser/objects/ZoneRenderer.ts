/**
 * ZoneRenderer — Renders a zone as a visual region with cards.
 *
 * Handles zone background, label, card count badge, and card positioning
 * within the zone based on the zone's arrangement type (stack, fan, row, grid).
 */

import Phaser from 'phaser';
import type { ZoneSceneState, CardDimensions } from '../types';
import type { PixelRect } from '../layout/ResponsiveScaler';
import { CardSprite } from './CardSprite';
import { CARD_SIZES } from '../types';

export interface ZoneRendererConfig {
  /** Zone name for the label */
  name: string;
  /** Pixel rect from ResponsiveScaler */
  rect: PixelRect;
  /** How to arrange cards */
  arrangement: 'stack' | 'fan' | 'row' | 'grid';
  /** Card size to use */
  cardSize: CardDimensions;
  /** Whether this zone is interactive (local player's zone) */
  interactive: boolean;
  /** Whether to show card count badge */
  showCount: boolean;
  /** Whether to show top card face (e.g., trash pile) */
  showTopCard: boolean;
}

export class ZoneRenderer extends Phaser.GameObjects.Container {
  private background: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private countBadge: Phaser.GameObjects.Container | null = null;
  private cardSprites: CardSprite[] = [];
  private config: ZoneRendererConfig;

  constructor(scene: Phaser.Scene, config: ZoneRendererConfig) {
    super(scene, config.rect.x, config.rect.y);
    this.config = config;

    // Zone background
    this.background = scene.add.rectangle(
      config.rect.width / 2, config.rect.height / 2,
      config.rect.width, config.rect.height,
      0x1a2a3a, 0.3,
    );
    this.background.setStrokeStyle(1, 0x446688, 0.4);
    this.add(this.background);

    // Zone label
    this.label = scene.add.text(4, 2, config.name, {
      fontSize: '9px',
      fontFamily: 'sans-serif',
      color: '#8899aa',
    });
    this.add(this.label);

    // Make zone a drop target if interactive
    if (config.interactive) {
      this.background.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, config.rect.width, config.rect.height),
        Phaser.Geom.Rectangle.Contains,
      );
      this.background.setData('zoneId', config.name);
    }

    scene.add.existing(this);
  }

  /** Update the zone with new card state. */
  updateCards(
    state: ZoneSceneState,
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): void {
    // Clear existing card sprites
    for (const sprite of this.cardSprites) {
      sprite.destroy();
    }
    this.cardSprites = [];

    // Update count badge
    this.updateCountBadge(state.cards.length);

    if (state.cards.length === 0) return;

    switch (this.config.arrangement) {
      case 'stack':
        this.arrangeStack(state, cardImages, cardBackKey);
        break;
      case 'fan':
        this.arrangeFan(state, cardImages, cardBackKey);
        break;
      case 'row':
        this.arrangeRow(state, cardImages, cardBackKey);
        break;
      case 'grid':
        this.arrangeGrid(state, cardImages, cardBackKey);
        break;
    }
  }

  private arrangeStack(
    state: ZoneSceneState,
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): void {
    // Only render the top card for stacks
    const topCard = state.cards[state.cards.length - 1];
    if (!topCard) return;

    const cx = this.config.rect.width / 2;
    const cy = this.config.rect.height / 2;
    const imageKey = cardImages[topCard.id] ? `card_${topCard.id}` : null;

    const sprite = new CardSprite(
      this.scene, cx, cy, topCard,
      imageKey, cardBackKey, this.config.cardSize,
    );
    this.add(sprite);
    this.cardSprites.push(sprite);
  }

  private arrangeFan(
    state: ZoneSceneState,
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): void {
    const cards = state.cards;
    const zoneWidth = this.config.rect.width;
    const cardWidth = this.config.cardSize.width;
    const padding = 8;

    // Calculate overlap so cards fit in zone width
    const totalNeeded = cards.length * cardWidth;
    const overlap = cards.length > 1
      ? Math.max(0, (totalNeeded - zoneWidth + padding * 2) / (cards.length - 1))
      : 0;
    const effectiveWidth = cardWidth - overlap;
    const startX = padding + cardWidth / 2;
    const cy = this.config.rect.height / 2;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const x = startX + i * effectiveWidth;
      const imageKey = cardImages[card.id] ? `card_${card.id}` : null;

      const sprite = new CardSprite(
        this.scene, x, cy, card,
        imageKey, cardBackKey, this.config.cardSize,
      );
      sprite.setDepth(i);
      this.add(sprite);
      this.cardSprites.push(sprite);
    }
  }

  private arrangeRow(
    state: ZoneSceneState,
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): void {
    const cards = state.cards;
    const cardWidth = this.config.cardSize.width;
    const gap = 4;
    const startX = 8 + cardWidth / 2;
    const cy = this.config.rect.height / 2;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const x = startX + i * (cardWidth + gap);
      const imageKey = cardImages[card.id] ? `card_${card.id}` : null;

      const sprite = new CardSprite(
        this.scene, x, cy, card,
        imageKey, cardBackKey, this.config.cardSize,
      );
      this.add(sprite);
      this.cardSprites.push(sprite);
    }
  }

  private arrangeGrid(
    state: ZoneSceneState,
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): void {
    // Grid is used for play area — handled by SlotRenderer instead
    // Fall back to row arrangement
    this.arrangeRow(state, cardImages, cardBackKey);
  }

  private updateCountBadge(count: number): void {
    if (this.countBadge) {
      this.countBadge.destroy();
      this.countBadge = null;
    }

    if (!this.config.showCount || count === 0) return;

    this.countBadge = this.scene.add.container(
      this.config.rect.width - 16, 2,
    );
    const bg = this.scene.add.circle(0, 8, 10, 0x000000, 0.7);
    const text = this.scene.add.text(0, 8, `${count}`, {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: '#ffffff',
    }).setOrigin(0.5);
    this.countBadge.add([bg, text]);
    this.add(this.countBadge);
  }

  /** Get all card sprites (for drag-drop hit testing). */
  getCardSprites(): CardSprite[] {
    return this.cardSprites;
  }

  /** Get the zone pixel rect. */
  getRect(): PixelRect {
    return this.config.rect;
  }

  /** Get the zone config. */
  getConfig(): ZoneRendererConfig {
    return this.config;
  }

  /** Update the zone rect (on resize). */
  updateRect(rect: PixelRect): void {
    this.config.rect = rect;
    this.setPosition(rect.x, rect.y);
    this.background.setPosition(rect.width / 2, rect.height / 2);
    this.background.setSize(rect.width, rect.height);
  }

  destroy(fromScene?: boolean): void {
    for (const sprite of this.cardSprites) {
      sprite.destroy();
    }
    this.cardSprites = [];
    if (this.countBadge) {
      this.countBadge.destroy();
    }
    super.destroy(fromScene);
  }
}
