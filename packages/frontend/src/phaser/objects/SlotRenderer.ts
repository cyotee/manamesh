/**
 * SlotRenderer — Renders play area slots (leader, characters, stage).
 *
 * Renders the slot grid with dashed outlines for empty slots,
 * card sprites for occupied slots, and DON!! attachment indicators.
 */

import Phaser from 'phaser';
import type { SlotSceneState, CardDimensions } from '../types';
import type { PixelRect } from '../layout/ResponsiveScaler';
import { CardSprite } from './CardSprite';
import { CARD_SIZES } from '../types';

export interface SlotRendererConfig {
  /** Pixel rect of the entire play area */
  rect: PixelRect;
  /** Whether slots are interactive (local player) */
  interactive: boolean;
}

interface SlotVisual {
  outline: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  cardSprite: CardSprite | null;
}

export class SlotRenderer extends Phaser.GameObjects.Container {
  private slotVisuals: SlotVisual[] = [];
  private config: SlotRendererConfig;

  constructor(scene: Phaser.Scene, config: SlotRendererConfig) {
    super(scene, config.rect.x, config.rect.y);
    this.config = config;
    scene.add.existing(this);
  }

  /** Update slots with new state. */
  updateSlots(
    slots: SlotSceneState[],
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): void {
    // Clear existing
    for (const visual of this.slotVisuals) {
      visual.outline.destroy();
      visual.label.destroy();
      if (visual.cardSprite) visual.cardSprite.destroy();
    }
    this.slotVisuals = [];

    if (slots.length === 0) return;

    // Layout: leader on left, characters in a row, stage on right
    const leaderSlot = slots.find((s) => s.slotType === 'leader');
    const charSlots = slots.filter((s) => s.slotType === 'character')
      .sort((a, b) => a.position - b.position);
    const stageSlot = slots.find((s) => s.slotType === 'stage');

    const orderedSlots: SlotSceneState[] = [];
    if (leaderSlot) orderedSlots.push(leaderSlot);
    orderedSlots.push(...charSlots);
    if (stageSlot) orderedSlots.push(stageSlot);

    const gap = 6;
    let currentX = 8;
    const cy = this.config.rect.height / 2;

    for (const slot of orderedSlots) {
      const size = slot.slotType === 'leader' ? CARD_SIZES.leader : CARD_SIZES.normal;
      const visual = this.createSlotVisual(slot, currentX, cy, size, cardImages, cardBackKey);
      this.slotVisuals.push(visual);
      currentX += size.width + gap;
    }
  }

  private createSlotVisual(
    slot: SlotSceneState,
    x: number,
    cy: number,
    size: CardDimensions,
    cardImages: Record<string, string>,
    cardBackKey: string,
  ): SlotVisual {
    const centerX = x + size.width / 2;

    // Dashed outline for the slot
    const outline = this.scene.add.rectangle(
      centerX, cy, size.width, size.height,
    );
    outline.setFillStyle(0x000000, 0);
    outline.setStrokeStyle(1, 0x556677, slot.card ? 0.2 : 0.5);
    this.add(outline);

    // Slot type label (only visible when empty)
    const labelText = slot.slotType === 'leader' ? 'LEADER'
      : slot.slotType === 'stage' ? 'STAGE'
      : `C${slot.position + 1}`;
    const label = this.scene.add.text(centerX, cy, labelText, {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#445566',
    }).setOrigin(0.5);
    label.setVisible(!slot.card);
    this.add(label);

    // Card sprite if occupied
    let cardSprite: CardSprite | null = null;
    if (slot.card) {
      const cardState = { ...slot.card, attachedDon: slot.attachedDon };
      const imageKey = cardImages[slot.card.id] ? `card_${slot.card.id}` : null;
      cardSprite = new CardSprite(
        this.scene, centerX, cy, cardState,
        imageKey, cardBackKey, size,
      );
      this.add(cardSprite);
    }

    // Make slot interactive as drop target
    if (this.config.interactive) {
      outline.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, size.width, size.height),
        Phaser.Geom.Rectangle.Contains,
      );
      outline.setData('slotType', slot.slotType);
      outline.setData('slotPosition', slot.position);
    }

    return { outline, label, cardSprite };
  }

  /** Get all card sprites in slots (for drag-drop). */
  getCardSprites(): CardSprite[] {
    return this.slotVisuals
      .map((v) => v.cardSprite)
      .filter((s): s is CardSprite => s !== null);
  }

  /** Update the play area rect (on resize). */
  updateRect(rect: PixelRect): void {
    this.config.rect = rect;
    this.setPosition(rect.x, rect.y);
  }

  destroy(fromScene?: boolean): void {
    for (const visual of this.slotVisuals) {
      visual.outline.destroy();
      visual.label.destroy();
      if (visual.cardSprite) visual.cardSprite.destroy();
    }
    this.slotVisuals = [];
    super.destroy(fromScene);
  }
}
