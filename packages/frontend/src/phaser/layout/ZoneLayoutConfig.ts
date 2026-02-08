/**
 * Zone Layout Configuration Types
 *
 * Defines the interface for game-specific zone layouts.
 * Each game module provides its own layout by implementing GameZoneLayout.
 */

import type { BoardLayout } from '../types';

/**
 * A game-specific zone layout provider.
 * Each game module creates one of these to define where zones appear.
 */
export interface GameZoneLayout {
  /** Human-readable name for this layout */
  name: string;
  /** The board layout for a two-player game */
  layout: BoardLayout;
}
