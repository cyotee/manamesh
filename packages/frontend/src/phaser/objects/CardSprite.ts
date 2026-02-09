/**
 * CardSprite — Phaser container representing a single card.
 *
 * Renders the card face/back image, state indicators (tap, counters, DON!!,
 * visibility), and handles hit area for input. Extends Phaser.GameObjects.Container
 * so indicators can be layered as children.
 */

import Phaser from 'phaser';
import type { CardSceneState, CardDimensions } from '../types';
import { applyIndicators } from './CardIndicators';
import { CARD_SIZES } from '../types';

export class CardSprite extends Phaser.GameObjects.Container {
  private cardImage: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  private indicators: Phaser.GameObjects.GameObject[] = [];
  private cardState: CardSceneState;
  private cardSize: CardDimensions;
  private nameText: Phaser.GameObjects.Text | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    state: CardSceneState,
    imageKey: string | null,
    cardBackKey: string,
    size: CardDimensions = CARD_SIZES.normal,
  ) {
    super(scene, x, y);
    this.cardState = state;
    this.cardSize = size;

    // Determine whether to show face or back
    const showFace = state.visibility === 'public'
      || state.visibility === 'owner-known'
      || state.visibility === 'all-known';

    if (showFace && imageKey && scene.textures.exists(imageKey)) {
      this.cardImage = scene.add.image(0, 0, imageKey);
      this.cardImage.setDisplaySize(size.width, size.height);
    } else if (!showFace && scene.textures.exists(cardBackKey)) {
      this.cardImage = scene.add.image(0, 0, cardBackKey);
      this.cardImage.setDisplaySize(size.width, size.height);
    } else {
      // Placeholder rectangle
      const color = showFace ? 0x2244aa : 0x884422;
      this.cardImage = scene.add.rectangle(0, 0, size.width, size.height, color, 0.8);
      (this.cardImage as Phaser.GameObjects.Rectangle).setStrokeStyle(1, 0xffffff, 0.3);
    }
    this.add(this.cardImage);

    // Apply tap rotation
    if (state.isTapped) {
      this.setAngle(90);
    }

    // Apply indicators
    this.indicators = applyIndicators(scene, state, size);
    for (const indicator of this.indicators) {
      this.add(indicator);
    }

    // Set interactive hit area
    this.setSize(size.width, size.height);
    this.setInteractive(
      new Phaser.Geom.Rectangle(
        -size.width / 2, -size.height / 2,
        size.width, size.height,
      ),
      Phaser.Geom.Rectangle.Contains,
    );

    scene.add.existing(this);
  }

  /** Update the card with new state. */
  updateState(
    state: CardSceneState,
    imageKey: string | null,
    cardBackKey: string,
  ): void {
    this.cardState = state;

    // Update tap
    this.setAngle(state.isTapped ? 90 : 0);

    // Remove old indicators
    for (const indicator of this.indicators) {
      indicator.destroy();
    }
    this.indicators = applyIndicators(this.scene, state, this.cardSize);
    for (const indicator of this.indicators) {
      this.add(indicator);
    }

    // Update image if visibility changed
    const showFace = state.visibility === 'public'
      || state.visibility === 'owner-known'
      || state.visibility === 'all-known';

    const targetKey = showFace ? imageKey : cardBackKey;
    if (targetKey && this.scene.textures.exists(targetKey) && this.cardImage instanceof Phaser.GameObjects.Image) {
      this.cardImage.setTexture(targetKey);
    }
  }

  /** Show card name on hover. Only reveals name for face-up cards. */
  showName(): void {
    if (this.nameText) return;
    // Don't reveal names for face-down (encrypted/secret) cards
    const vis = this.cardState.visibility;
    if (vis === 'encrypted' || vis === 'secret') return;
    this.nameText = this.scene.add.text(0, this.cardSize.height / 2 + 8, this.cardState.name, {
      fontSize: '9px',
      fontFamily: 'sans-serif',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0);
    this.add(this.nameText);
  }

  /** Hide card name. */
  hideName(): void {
    if (this.nameText) {
      this.nameText.destroy();
      this.nameText = null;
    }
  }

  /** Get the current card state. */
  getCardState(): CardSceneState {
    return this.cardState;
  }

  /** Get the card ID. */
  getCardId(): string {
    return this.cardState.id;
  }

  destroy(fromScene?: boolean): void {
    this.hideName();
    for (const indicator of this.indicators) {
      indicator.destroy();
    }
    this.indicators = [];
    super.destroy(fromScene);
  }
}
