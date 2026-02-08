/**
 * DragDropManager — Handles card drag-and-drop interactions in Phaser.
 *
 * Detects drags on CardSprites, highlights valid drop targets,
 * and emits CardInteractionEvents through the EventBridge.
 */

import Phaser from 'phaser';
import type { CardInteractionEvent } from '../types';
import type { EventBridge } from './EventBridge';
import { CardSprite } from '../objects/CardSprite';

export interface DragDropConfig {
  /** Player ID for event attribution */
  playerId: string;
  /** Event bridge to emit interactions */
  eventBridge: EventBridge;
}

export class DragDropManager {
  private scene: Phaser.Scene;
  private config: DragDropConfig;
  private draggedSprite: CardSprite | null = null;
  private originalPosition: { x: number; y: number } | null = null;
  private originalDepth: number = 0;

  constructor(scene: Phaser.Scene, config: DragDropConfig) {
    this.scene = scene;
    this.config = config;
    this.setupInputHandlers();
  }

  private setupInputHandlers(): void {
    this.scene.input.on('dragstart', this.onDragStart, this);
    this.scene.input.on('drag', this.onDrag, this);
    this.scene.input.on('dragend', this.onDragEnd, this);
    this.scene.input.on('drop', this.onDrop, this);
    this.scene.input.on('gameobjectover', this.onPointerOver, this);
    this.scene.input.on('gameobjectout', this.onPointerOut, this);
    this.scene.input.on('gameobjectup', this.onClick, this);
  }

  /** Enable drag on a card sprite. */
  enableDrag(sprite: CardSprite): void {
    this.scene.input.setDraggable(sprite, true);
  }

  /** Disable drag on a card sprite. */
  disableDrag(sprite: CardSprite): void {
    this.scene.input.setDraggable(sprite, false);
  }

  private onDragStart(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
  ): void {
    if (!(gameObject instanceof CardSprite)) return;

    this.draggedSprite = gameObject;
    this.originalPosition = { x: gameObject.x, y: gameObject.y };
    this.originalDepth = gameObject.depth;
    gameObject.setDepth(1000); // Raise above everything
    gameObject.setAlpha(0.8);
  }

  private onDrag(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dragX: number,
    dragY: number,
  ): void {
    if (!(gameObject instanceof CardSprite)) return;
    gameObject.x = dragX;
    gameObject.y = dragY;
  }

  private onDrop(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dropZone: Phaser.GameObjects.GameObject,
  ): void {
    if (!(gameObject instanceof CardSprite)) return;

    const cardId = gameObject.getCardId();
    const sourceZone = gameObject.getData('sourceZone') as string | undefined;
    const targetZone = dropZone.getData('zoneId') as string | undefined;
    const targetSlot = dropZone.getData('slotPosition') as number | undefined;
    const slotType = dropZone.getData('slotType') as string | undefined;

    if (targetZone || slotType) {
      const event: CardInteractionEvent = {
        type: slotType ? 'play' : 'play',
        cardId,
        sourceZone,
        targetZone: targetZone ?? 'playArea',
        targetSlot,
        playerId: this.config.playerId,
      };
      this.config.eventBridge.emit(event);
    }

    // Reset position (Phaser scene will re-render from new state)
    this.resetDraggedSprite(gameObject);
  }

  private onDragEnd(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
  ): void {
    if (!(gameObject instanceof CardSprite)) return;
    this.resetDraggedSprite(gameObject);
  }

  private resetDraggedSprite(sprite: CardSprite): void {
    if (this.originalPosition) {
      sprite.x = this.originalPosition.x;
      sprite.y = this.originalPosition.y;
    }
    sprite.setDepth(this.originalDepth);
    sprite.setAlpha(1);
    this.draggedSprite = null;
    this.originalPosition = null;
  }

  private onPointerOver(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
  ): void {
    if (gameObject instanceof CardSprite) {
      gameObject.showName();
    }
  }

  private onPointerOut(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
  ): void {
    if (gameObject instanceof CardSprite) {
      gameObject.hideName();
    }
  }

  private onClick(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
  ): void {
    // Don't process clicks during drag
    if (this.draggedSprite) return;

    if (gameObject instanceof CardSprite) {
      const card = gameObject.getCardState();
      const sourceZone = gameObject.getData('sourceZone') as string | undefined;

      // Tap/untap toggle for cards in play area
      if (sourceZone === 'playArea' || sourceZone === 'donArea') {
        const event: CardInteractionEvent = {
          type: card.isTapped ? 'untap' : 'tap',
          cardId: card.id,
          sourceZone,
          playerId: this.config.playerId,
        };
        this.config.eventBridge.emit(event);
        return;
      }

      // Preview for cards in hand
      if (sourceZone === 'hand') {
        const event: CardInteractionEvent = {
          type: 'preview',
          cardId: card.id,
          sourceZone,
          playerId: this.config.playerId,
        };
        this.config.eventBridge.emit(event);
        return;
      }
    }

    // Click on deck zone to draw
    const zoneId = gameObject.getData('zoneId') as string | undefined;
    if (zoneId === 'Main Deck' || zoneId === 'DON!! Deck') {
      const event: CardInteractionEvent = {
        type: 'draw',
        sourceZone: zoneId === 'Main Deck' ? 'mainDeck' : 'donDeck',
        playerId: this.config.playerId,
      };
      this.config.eventBridge.emit(event);
    }
  }

  destroy(): void {
    this.scene.input.off('dragstart', this.onDragStart, this);
    this.scene.input.off('drag', this.onDrag, this);
    this.scene.input.off('dragend', this.onDragEnd, this);
    this.scene.input.off('drop', this.onDrop, this);
    this.scene.input.off('gameobjectover', this.onPointerOver, this);
    this.scene.input.off('gameobjectout', this.onPointerOut, this);
    this.scene.input.off('gameobjectup', this.onClick, this);
  }
}
