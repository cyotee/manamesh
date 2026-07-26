/**
 * Game Registry
 *
 * Central registry of available games with metadata for UI display
 * and boardgame.io game definitions.
 */

import type { Game } from "boardgame.io";
import type { BoardProps } from "boardgame.io/react";
import type { ComponentType } from "react";
import { SimpleCardGame, type SimpleCardGameState } from "./game";
import {
  PokerGame,
  CryptoPokerGame,
  type PokerState,
  type CryptoPokerState,
} from "@manamesh/poker";
import { MerkleBattleshipGame, MerkleBattleshipBoard } from "@manamesh/game-battleship-merkle";
import { ThresholdTallyGame } from "./modules/threshold-tally";
import { OnePieceGame, OnePieceCryptoGame } from "@manamesh/onepiece";
import { MistbornModule, MistbornBoard, MistbornGame } from "@manamesh/mistborn-deckbuilder";
import { TimestreamsModule, TimestreamsBoard } from "@manamesh/timestreams";

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
    id: "threshold-tally",
    name: "Threshold Tally Arena (Demo)",
    description:
      "Threshold homomorphic tally demo: submit encrypted inputs and only decrypt the aggregate.",
    minPlayers: 2,
    maxPlayers: 3,
    getGame: () => ThresholdTallyGame as Game,
  },
  {
    id: "merkle-battleship",
    name: "Merkle Battleship",
    description:
      "Verifiable Battleship with binding placement (Merkle commitment). Package: @manamesh/game-battleship-merkle.",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => MerkleBattleshipGame as Game,
    BoardComponent: MerkleBattleshipBoard as ComponentType<BoardProps<unknown>>,
  },
  {
    id: "poker",
    name: "Texas Hold'em",
    description:
      "Classic poker with betting rounds. Bluff, bet, and win the pot!",
    minPlayers: 2,
    maxPlayers: 6,
    getGame: () => PokerGame as Game,
    getCryptoGame: () => CryptoPokerGame as Game,
  },
  {
    id: "onepiece",
    name: "One Piece TCG",
    description:
      "One Piece Trading Card Game — rules-agnostic state manager with cooperative decryption.",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => OnePieceGame as Game,
    getCryptoGame: () => OnePieceCryptoGame as Game,
  },
  {
    id: "simple",
    name: "Simple Card Game",
    description: "Draw and play cards. First to play 5 cards wins!",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => SimpleCardGame as Game,
  },
  {
    id: "mistborn",
    name: "Mistborn Deck Builder (Rules-Free)",
    description: "Phase 1: rules-free board for manual testing. Load pack, manage cards, advance tracks.",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => MistbornGame as Game,
    BoardComponent: MistbornBoard,
  },
  {
    id: "timestreams",
    name: "Timestreams",
    description: "Timestreams — cryptographically fair era-seeding card game. 2-4 players, home era assignment, timeline placement.",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => TimestreamsModule.getBoardgameIOGame() as Game,
    getCryptoGame: () => TimestreamsModule.getBoardgameIOGame() as Game,
    BoardComponent: TimestreamsBoard,
  },
];

export function getGameById(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}

export function getGamesByPlayerCount(playerCount: number): GameInfo[] {
  return GAMES.filter(
    (g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers,
  );
}
