/**
 * PhaserBoard — React wrapper component for the Phaser card game scene.
 *
 * Creates a Phaser.Game instance, manages its lifecycle, and bridges
 * React state to the Phaser scene. Receives a SceneState object from
 * the parent component and forwards it to CardGameScene.updateState().
 *
 * Also subscribes to the EventBridge so the parent can handle
 * card interaction events from Phaser (mapping them to boardgame.io moves).
 */

import { useEffect, useRef, useMemo } from 'react';
import Phaser from 'phaser';
import { CardGameScene, type CardGameSceneConfig } from './CardGameScene';
import { EventBridge } from './input/EventBridge';
import type { SceneState, CardInteractionEvent } from './types';
import type { GameZoneLayout } from './layout/ZoneLayoutConfig';

export interface PhaserBoardProps {
  /** Current scene state snapshot (React → Phaser) */
  sceneState: SceneState;
  /** Game-specific zone layout */
  zoneLayout: GameZoneLayout;
  /** Local player's ID */
  playerId: string;
  /** Callback when the player interacts with cards (Phaser → React) */
  onInteraction?: (event: CardInteractionEvent) => void;
  /** CSS width (default: '100%') */
  width?: string;
  /** CSS height (default: '600px') */
  height?: string;
}

export function PhaserBoard({
  sceneState,
  zoneLayout,
  playerId,
  onInteraction,
  width = '100%',
  height = '600px',
}: PhaserBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<CardGameScene | null>(null);

  // Stable event bridge instance (persists across renders)
  const eventBridge = useMemo(() => new EventBridge(), []);

  // Subscribe to interaction events
  useEffect(() => {
    if (!onInteraction) return;
    return eventBridge.on(onInteraction);
  }, [eventBridge, onInteraction]);

  // Create Phaser game on mount, destroy on unmount
  useEffect(() => {
    if (!containerRef.current) return;

    const sceneConfig: CardGameSceneConfig = {
      zoneLayout,
      eventBridge,
      playerId,
    };

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: '#0a1628',
      scene: CardGameScene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      // Disable unnecessary features for a card game
      physics: { default: false },
      audio: { noAudio: true },
      input: {
        mouse: true,
        touch: true,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    // Pass config to the scene via the scene's init() method
    game.scene.start('CardGameScene', sceneConfig);

    // Get a reference to the running scene once it's ready
    const checkScene = () => {
      const scene = game.scene.getScene('CardGameScene') as CardGameScene | null;
      if (scene) {
        sceneRef.current = scene;
      } else {
        // Scene not ready yet, check again next frame
        requestAnimationFrame(checkScene);
      }
    };
    requestAnimationFrame(checkScene);

    return () => {
      sceneRef.current = null;
      game.destroy(true);
      gameRef.current = null;
      eventBridge.destroy();
    };
    // Only recreate the game if the layout or player changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneLayout, playerId]);

  // Forward state updates to the Phaser scene
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.updateState(sceneState);
    }
  }, [sceneState]);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        overflow: 'hidden',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
      }}
    />
  );
}
