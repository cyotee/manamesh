/**
 * SceneState type tests
 *
 * Validates that SceneState types are structurally correct and that
 * the CARD_SIZES constants have valid dimensions.
 */

import { describe, it, expect } from 'vitest';
import { CARD_SIZES, CARD_ASPECT_RATIO } from './types';
import type {
  SceneState,
  PlayerSceneState,
  ZoneSceneState,
  CardSceneState,
  SlotSceneState,
  CardInteractionEvent,
} from './types';

describe('CARD_SIZES', () => {
  it('normal cards have positive dimensions', () => {
    expect(CARD_SIZES.normal.width).toBeGreaterThan(0);
    expect(CARD_SIZES.normal.height).toBeGreaterThan(0);
  });

  it('hand cards are smaller than normal', () => {
    expect(CARD_SIZES.hand.width).toBeLessThanOrEqual(CARD_SIZES.normal.width);
    expect(CARD_SIZES.hand.height).toBeLessThanOrEqual(CARD_SIZES.normal.height);
  });

  it('leader cards are larger than normal', () => {
    expect(CARD_SIZES.leader.width).toBeGreaterThan(CARD_SIZES.normal.width);
    expect(CARD_SIZES.leader.height).toBeGreaterThan(CARD_SIZES.normal.height);
  });

  it('DON!! cards are smaller than normal', () => {
    expect(CARD_SIZES.don.width).toBeLessThan(CARD_SIZES.normal.width);
    expect(CARD_SIZES.don.height).toBeLessThan(CARD_SIZES.normal.height);
  });

  it('preview cards are the largest', () => {
    expect(CARD_SIZES.preview.width).toBeGreaterThan(CARD_SIZES.leader.width);
    expect(CARD_SIZES.preview.height).toBeGreaterThan(CARD_SIZES.leader.height);
  });

  it('card aspect ratio constant is correct', () => {
    expect(CARD_ASPECT_RATIO).toBeCloseTo(2.5 / 3.5, 4);
  });

  it('all card sizes maintain approximate poker card aspect ratio', () => {
    const tolerance = 0.05;
    for (const [name, size] of Object.entries(CARD_SIZES)) {
      const ratio = size.width / size.height;
      expect(
        Math.abs(ratio - CARD_ASPECT_RATIO),
        `${name} aspect ratio`,
      ).toBeLessThan(tolerance);
    }
  });
});

describe('SceneState type contracts', () => {
  it('a minimal SceneState is valid', () => {
    const state: SceneState = {
      players: {},
      currentPlayer: '0',
      viewingPlayer: '0',
      phase: 'play',
      cardImages: {},
      cardBackUrl: '',
      interactionsEnabled: true,
    };
    expect(state.players).toBeDefined();
    expect(state.currentPlayer).toBe('0');
  });

  it('a CardSceneState has required fields', () => {
    const card: CardSceneState = {
      id: 'card-1',
      name: 'Luffy',
      visibility: 'public',
      isTapped: false,
      counter: null,
      power: 5000,
      attachedDon: 2,
      position: 0,
    };
    expect(card.id).toBe('card-1');
    expect(card.power).toBe(5000);
  });

  it('a SlotSceneState can be empty', () => {
    const slot: SlotSceneState = {
      slotType: 'character',
      card: null,
      attachedDon: 0,
      position: 1,
    };
    expect(slot.card).toBeNull();
  });

  it('a CardInteractionEvent has type and playerId', () => {
    const event: CardInteractionEvent = {
      type: 'play',
      cardId: 'card-1',
      sourceZone: 'hand',
      targetZone: 'playArea',
      playerId: '0',
    };
    expect(event.type).toBe('play');
    expect(event.playerId).toBe('0');
  });
});
