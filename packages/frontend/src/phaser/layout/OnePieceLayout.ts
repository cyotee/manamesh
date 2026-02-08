/**
 * One Piece TCG Zone Layout
 *
 * Defines normalized (0–1) positions for all 7 zones in a two-player layout.
 *
 * Board layout (top-to-bottom):
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  [Opp Hand]       [Opp Play Area]       [Opp Deck]  │  y: 0.00–0.12
 * │  [Opp Trash] [Leader][C1-C5][Stage]     [Opp Life]  │  y: 0.12–0.35
 * │             [Opp DON!! Area]             [Opp DON]   │  y: 0.35–0.45
 * │──────────────────── center ──────────────────────────│
 * │             [My DON!! Area]              [My DON]    │  y: 0.55–0.65
 * │  [My Trash]  [Leader][C1-C5][Stage]      [My Life]   │  y: 0.65–0.88
 * │  [My Hand]                               [My Deck]   │  y: 0.88–1.00
 * └─────────────────────────────────────────────────────┘
 */

import type { BoardLayout, PlayerZoneLayout } from '../types';
import type { GameZoneLayout } from './ZoneLayoutConfig';

const LOCAL_LAYOUT: PlayerZoneLayout = {
  hand:     { x: 0.02, y: 0.88, width: 0.72, height: 0.11 },
  playArea: { x: 0.12, y: 0.65, width: 0.62, height: 0.22 },
  trash:    { x: 0.02, y: 0.65, width: 0.09, height: 0.22 },
  donArea:  { x: 0.20, y: 0.56, width: 0.50, height: 0.08 },
  mainDeck: { x: 0.86, y: 0.88, width: 0.12, height: 0.11 },
  lifeDeck: { x: 0.86, y: 0.72, width: 0.12, height: 0.15 },
  donDeck:  { x: 0.76, y: 0.56, width: 0.10, height: 0.08 },
};

const OPPONENT_LAYOUT: PlayerZoneLayout = {
  hand:     { x: 0.02, y: 0.01, width: 0.72, height: 0.11 },
  playArea: { x: 0.12, y: 0.13, width: 0.62, height: 0.22 },
  trash:    { x: 0.02, y: 0.13, width: 0.09, height: 0.22 },
  donArea:  { x: 0.20, y: 0.36, width: 0.50, height: 0.08 },
  mainDeck: { x: 0.86, y: 0.01, width: 0.12, height: 0.11 },
  lifeDeck: { x: 0.86, y: 0.13, width: 0.12, height: 0.15 },
  donDeck:  { x: 0.76, y: 0.36, width: 0.10, height: 0.08 },
};

const ONEPIECE_BOARD_LAYOUT: BoardLayout = {
  local: LOCAL_LAYOUT,
  opponent: OPPONENT_LAYOUT,
};

export const OnePieceZoneLayout: GameZoneLayout = {
  name: 'One Piece TCG',
  layout: ONEPIECE_BOARD_LAYOUT,
};
