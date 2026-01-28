/**
 * Game Registry
 *
 * Central registry of available games with metadata for UI display
 * and boardgame.io game definitions.
 */

import type { Game } from 'boardgame.io';
import type { BoardProps } from 'boardgame.io/react';
import type { ComponentType } from 'react';
import { SimpleCardGame, type SimpleCardGameState } from './game';
import { PokerGame, CryptoPokerGame, type PokerState, type CryptoPokerState } from './modules/poker';
import { WarGame, type WarState } from './modules/war';

export interface GameInfo<T = unknown> {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  getGame: () => Game<T>;
  /** Get the crypto-enabled version for P2P play (if available) */
  getCryptoGame?: () => Game<T>;
  BoardComponent?: ComponentType<BoardProps<T>>;
}

export const GAMES: GameInfo[] = [
  {
    id: 'poker',
    name: "Texas Hold'em",
    description: 'Classic poker with betting rounds. Bluff, bet, and win the pot!',
    minPlayers: 2,
    maxPlayers: 6,
    getGame: () => PokerGame as Game,
    getCryptoGame: () => CryptoPokerGame as Game,
  },
  {
    id: 'war',
    name: 'War',
    description: 'Classic card battle. Flip cards and capture your opponent\'s deck!',
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => WarGame as Game,
  },
  {
    id: 'simple',
    name: 'Simple Card Game',
    description: 'Draw and play cards. First to play 5 cards wins!',
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => SimpleCardGame as Game,
  },
];

export function getGameById(id: string): GameInfo | undefined {
  return GAMES.find(g => g.id === id);
}

export function getGamesByPlayerCount(playerCount: number): GameInfo[] {
  return GAMES.filter(g => playerCount >= g.minPlayers && playerCount <= g.maxPlayers);
}
