/**
 * Game Module System
 *
 * This module exports all types and utilities for the pluggable game module system.
 * Game modules define the rules, zones, and rendering for specific card games.
 *
 * @example
 * ```typescript
 * import { GameModule, ZoneDefinition, CoreCard } from '@manamesh/frontend/game/modules';
 *
 * const myGame: GameModule = {
 *   id: 'my-game',
 *   name: 'My Card Game',
 *   // ...
 * };
 * ```
 */

// Core interfaces
export type {
  // Asset types
  AssetType,
  CardIdFormat,

  // Zone system
  ZoneFeature,
  Visibility,
  ZoneDefinition,

  // Card schema
  CoreCard,
  CardSchema,

  // Asset requirements
  GameModuleAssetRequirements,

  // Rendering
  CardArrangement,
  ZoneLayout,
  ZoneLayoutConfig,

  // Game state
  GameConfig,
  BaseGameState,
  GameMove,
  MoveValidation,

  // Main interface
  GameModule,

  // Game-specific cards
  StandardCard,
  WarCard,
  PokerCard,
  MTGCard,
  LorcanaCard,
  OnePieceCard,
} from './types';
