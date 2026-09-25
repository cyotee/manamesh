/**
 * Game Registry
 *
 * Central registry of available games with metadata for UI display
 * and boardgame.io game definitions.
 */

import type { Game } from "boardgame.io";
import type { BoardProps } from "boardgame.io/react";
import type { ComponentType } from "react";
import { SimpleCardGame } from "./game";
import {
  PokerGame,
  CryptoPokerGame,
} from "@manamesh/poker";
import { MerkleBattleshipGame, MerkleBattleshipBoard } from "@manamesh/game-battleship-merkle";
import { ThresholdTallyGame } from "./modules/threshold-tally";
import { OnePieceGame, OnePieceCryptoGame } from "@manamesh/onepiece";
import { MistbornBoard, MistbornGame } from "@manamesh/mistborn-deckbuilder";
import { TimestreamsModule, TimestreamsBoard } from "@manamesh/timestreams";

export interface GameInfo<T = unknown, CryptoState = T> {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  getGame: () => Game<T>;
  /** Get the crypto-enabled version for P2P play (if available) */
  getCryptoGame?: () => Game<CryptoState>;
  BoardComponent?: ComponentType<BoardProps<T>>;
}

/** Check each game's board against its state before collecting heterogeneous entries. */
export function defineGame<const Id extends string, State, CryptoState = State>(
  info: GameInfo<State, CryptoState> & { id: Id },
): GameInfo<State, CryptoState> & { id: Id } {
  return info;
}

export const GAMES = [
  defineGame({
    id: "threshold-tally",
    name: "Threshold Tally Arena (Demo)",
    description:
      "Threshold homomorphic tally demo: submit encrypted inputs and only decrypt the aggregate.",
    minPlayers: 2,
    maxPlayers: 3,
    getGame: () => ThresholdTallyGame,
  }),
  defineGame({
    id: "merkle-battleship",
    name: "Merkle Battleship",
    description:
      "Verifiable Battleship with binding placement (Merkle commitment). Package: @manamesh/game-battleship-merkle.",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => MerkleBattleshipGame,
    BoardComponent: MerkleBattleshipBoard,
  }),
  defineGame({
    id: "poker",
    name: "Texas Hold'em",
    description:
      "Classic poker with betting rounds. Bluff, bet, and win the pot!",
    minPlayers: 2,
    maxPlayers: 6,
    getGame: () => PokerGame,
    getCryptoGame: () => CryptoPokerGame,
  }),
  defineGame({
    id: "onepiece",
    name: "One Piece TCG",
    description:
      "One Piece Trading Card Game — rules-agnostic state manager with cooperative decryption.",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => OnePieceGame,
    getCryptoGame: () => OnePieceCryptoGame,
  }),
  defineGame({
    id: "simple",
    name: "Simple Card Game",
    description: "Draw and play cards. First to play 5 cards wins!",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => SimpleCardGame,
  }),
  defineGame({
    id: "mistborn",
    name: "Mistborn Deck Builder (Rules-Free)",
    description: "Phase 1: rules-free board for manual testing. Load pack, manage cards, advance tracks.",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => MistbornGame,
    BoardComponent: MistbornBoard,
  }),
  defineGame({
    id: "timestreams",
    name: "Timestreams",
    description: "Timestreams — cryptographically fair era-seeding card game. 2-4 players, home era assignment, timeline placement.",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => TimestreamsModule.getBoardgameIOGame(),
    getCryptoGame: () => TimestreamsModule.getBoardgameIOGame(),
    BoardComponent: TimestreamsBoard,
  }),
];

export type RegisteredGame = (typeof GAMES)[number];

export function getGameById(id: string): RegisteredGame | undefined {
  return GAMES.find((g) => g.id === id);
}

export function getGamesByPlayerCount(playerCount: number): RegisteredGame[] {
  return GAMES.filter(
    (g) => playerCount >= g.minPlayers && playerCount <= g.maxPlayers,
  );
}
