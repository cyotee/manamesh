/**
 * CardGameScene — Main Phaser scene for rendering a card game board.
 *
 * Orchestrates all renderers (zones, play area slots), the texture manager,
 * placeholder factory, and drag-drop manager. React pushes SceneState snapshots
 * via updateState(); the scene re-renders zones and slots accordingly.
 *
 * This scene is a "dumb renderer" — it never mutates game state. All player
 * interactions are emitted through the EventBridge for React to handle.
 */

import Phaser from 'phaser';
import type {
  SceneState,
  PlayerSceneState,
  PlayerZoneLayout,
  CardDimensions,
} from './types';
import { CARD_SIZES } from './types';
import type { GameZoneLayout } from './layout/ZoneLayoutConfig';
import { ResponsiveScaler, type PixelRect } from './layout/ResponsiveScaler';
import { ZoneRenderer, type ZoneRendererConfig } from './objects/ZoneRenderer';
import { SlotRenderer, type SlotRendererConfig } from './objects/SlotRenderer';
import { TextureManager } from './assets/TextureManager';
import { createPlaceholderBack, createPlaceholderFace } from './assets/PlaceholderFactory';
import { DragDropManager, type DragDropConfig } from './input/DragDropManager';
import type { EventBridge } from './input/EventBridge';

/** Zone rendering metadata (how to visualize each zone type). */
interface ZoneMeta {
  arrangement: 'stack' | 'fan' | 'row' | 'grid';
  cardSize: CardDimensions;
  showCount: boolean;
  showTopCard: boolean;
}

const ZONE_META: Record<string, ZoneMeta> = {
  mainDeck:  { arrangement: 'stack', cardSize: CARD_SIZES.deck,   showCount: true,  showTopCard: false },
  lifeDeck:  { arrangement: 'stack', cardSize: CARD_SIZES.deck,   showCount: true,  showTopCard: false },
  donDeck:   { arrangement: 'stack', cardSize: CARD_SIZES.don,    showCount: true,  showTopCard: false },
  trash:     { arrangement: 'stack', cardSize: CARD_SIZES.normal, showCount: true,  showTopCard: true },
  hand:      { arrangement: 'fan',   cardSize: CARD_SIZES.hand,   showCount: false, showTopCard: true },
  donArea:   { arrangement: 'row',   cardSize: CARD_SIZES.don,    showCount: false, showTopCard: true },
};

/** Zone display names. */
const ZONE_NAMES: Record<string, string> = {
  mainDeck: 'Main Deck',
  lifeDeck: 'Life',
  donDeck: 'DON!! Deck',
  trash: 'Trash',
  hand: 'Hand',
  donArea: 'DON!!',
  playArea: 'Play Area',
};

export interface CardGameSceneConfig {
  /** Game-specific zone layout (e.g., OnePieceZoneLayout) */
  zoneLayout: GameZoneLayout;
  /** Event bridge for Phaser → React communication */
  eventBridge: EventBridge;
  /** Local player's ID */
  playerId: string;
}

export class CardGameScene extends Phaser.Scene {
  private sceneConfig!: CardGameSceneConfig;
  private scaler!: ResponsiveScaler;
  private textureManager!: TextureManager;
  private dragDropManager!: DragDropManager;

  /** Zone renderers keyed by "local_hand", "opponent_mainDeck", etc. */
  private zoneRenderers: Map<string, ZoneRenderer> = new Map();
  /** Slot renderers for play areas */
  private slotRenderers: Map<string, SlotRenderer> = new Map();

  private currentState: SceneState | null = null;
  private cardBackKey = 'placeholder_back';

  constructor() {
    super({ key: 'CardGameScene' });
  }

  /** Called by the React wrapper before scene starts. */
  init(data: CardGameSceneConfig): void {
    this.sceneConfig = data;
  }

  create(): void {
    // Set up responsive scaling
    this.scaler = new ResponsiveScaler(
      this.scale.width,
      this.scale.height,
    );

    // Create texture manager
    this.textureManager = new TextureManager(this);

    // Create placeholder card back texture
    createPlaceholderBack(this, CARD_SIZES.normal, this.cardBackKey);

    // Set up drag-drop
    const dragConfig: DragDropConfig = {
      playerId: this.sceneConfig.playerId,
      eventBridge: this.sceneConfig.eventBridge,
    };
    this.dragDropManager = new DragDropManager(this, dragConfig);

    // Build zone renderers for both players
    this.buildZoneRenderers();

    // Handle browser resize
    this.scale.on('resize', this.onResize, this);

    // Dark background
    this.cameras.main.setBackgroundColor('#0a1628');

    // If we already received state before create(), render it now
    if (this.currentState) {
      this.renderState(this.currentState);
    }
  }

  /**
   * Update the scene with a new state snapshot from React.
   * This is the primary API called by the React wrapper.
   */
  updateState(state: SceneState): void {
    this.currentState = state;

    // Sync card images into Phaser's texture cache
    if (this.textureManager) {
      this.textureManager.syncImages(state.cardImages);
      if (state.cardBackUrl) {
        this.textureManager.ensureCardBackLoaded(state.cardBackUrl);
      }
    }

    // Re-render if the scene is ready
    if (this.scaler) {
      this.renderState(state);
    }
  }

  private buildZoneRenderers(): void {
    const layout = this.sceneConfig.zoneLayout.layout;

    // Build renderers for local player (interactive) and opponent (not interactive)
    this.buildPlayerZones('local', layout.local, true);
    this.buildPlayerZones('opponent', layout.opponent, false);
  }

  private buildPlayerZones(
    side: 'local' | 'opponent',
    zoneLayout: PlayerZoneLayout,
    interactive: boolean,
  ): void {
    // Create zone renderers for each zone type (except playArea which uses SlotRenderer)
    for (const [zoneId, normalizedRect] of Object.entries(zoneLayout)) {
      if (zoneId === 'playArea') {
        // Play area uses SlotRenderer
        const rect = this.scaler.toPixels(normalizedRect);
        const slotConfig: SlotRendererConfig = {
          rect,
          interactive,
        };
        const slotRenderer = new SlotRenderer(this, slotConfig);
        this.slotRenderers.set(`${side}_playArea`, slotRenderer);
        continue;
      }

      const meta = ZONE_META[zoneId];
      if (!meta) continue;

      const rect = this.scaler.toPixels(normalizedRect);
      const config: ZoneRendererConfig = {
        name: ZONE_NAMES[zoneId] ?? zoneId,
        rect,
        arrangement: meta.arrangement,
        cardSize: meta.cardSize,
        interactive,
        showCount: meta.showCount,
        showTopCard: meta.showTopCard,
      };

      const renderer = new ZoneRenderer(this, config);
      this.zoneRenderers.set(`${side}_${zoneId}`, renderer);
    }
  }

  private renderState(state: SceneState): void {
    const localPlayerId = state.viewingPlayer;

    // Find opponent player ID
    const playerIds = Object.keys(state.players);
    const opponentId = playerIds.find((id) => id !== localPlayerId);

    // Render local player's zones
    const localState = state.players[localPlayerId];
    if (localState) {
      this.renderPlayerZones('local', localState, state.cardImages, state.interactionsEnabled);
    }

    // Render opponent's zones
    if (opponentId) {
      const opponentState = state.players[opponentId];
      if (opponentState) {
        this.renderPlayerZones('opponent', opponentState, state.cardImages, false);
      }
    }
  }

  private renderPlayerZones(
    side: 'local' | 'opponent',
    playerState: PlayerSceneState,
    cardImages: Record<string, string>,
    enableDrag: boolean,
  ): void {
    // Update zone renderers
    for (const [zoneId, zoneState] of Object.entries(playerState.zones)) {
      const renderer = this.zoneRenderers.get(`${side}_${zoneId}`);
      if (renderer) {
        renderer.updateCards(zoneState, cardImages, this.cardBackKey);

        // Enable drag on local hand cards
        if (enableDrag && zoneId === 'hand') {
          for (const sprite of renderer.getCardSprites()) {
            sprite.setData('sourceZone', 'hand');
            this.dragDropManager.enableDrag(sprite);
          }
        }

        // Enable drag on local DON!! area cards
        if (enableDrag && zoneId === 'donArea') {
          for (const sprite of renderer.getCardSprites()) {
            sprite.setData('sourceZone', 'donArea');
            this.dragDropManager.enableDrag(sprite);
          }
        }
      }
    }

    // Update play area slot renderer
    const slotRenderer = this.slotRenderers.get(`${side}_playArea`);
    if (slotRenderer) {
      slotRenderer.updateSlots(
        playerState.playArea,
        cardImages,
        this.cardBackKey,
      );

      // Enable drag on play area cards
      if (enableDrag) {
        for (const sprite of slotRenderer.getCardSprites()) {
          sprite.setData('sourceZone', 'playArea');
          this.dragDropManager.enableDrag(sprite);
        }
      }
    }
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    this.scaler.resize(gameSize.width, gameSize.height);

    const layout = this.sceneConfig.zoneLayout.layout;

    // Update zone renderer positions
    this.updatePlayerZonePositions('local', layout.local);
    this.updatePlayerZonePositions('opponent', layout.opponent);

    // Re-render current state at new size
    if (this.currentState) {
      this.renderState(this.currentState);
    }
  }

  private updatePlayerZonePositions(
    side: 'local' | 'opponent',
    zoneLayout: PlayerZoneLayout,
  ): void {
    for (const [zoneId, normalizedRect] of Object.entries(zoneLayout)) {
      const rect = this.scaler.toPixels(normalizedRect);

      if (zoneId === 'playArea') {
        const slotRenderer = this.slotRenderers.get(`${side}_playArea`);
        if (slotRenderer) slotRenderer.updateRect(rect);
      } else {
        const renderer = this.zoneRenderers.get(`${side}_${zoneId}`);
        if (renderer) renderer.updateRect(rect);
      }
    }
  }

  destroy(): void {
    this.scale.off('resize', this.onResize, this);

    for (const renderer of this.zoneRenderers.values()) {
      renderer.destroy();
    }
    this.zoneRenderers.clear();

    for (const renderer of this.slotRenderers.values()) {
      renderer.destroy();
    }
    this.slotRenderers.clear();

    if (this.dragDropManager) {
      this.dragDropManager.destroy();
    }
  }
}
