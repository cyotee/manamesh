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
} from "./modules/poker";
import { WarGame, type WarState } from "./modules/war";
import {
  CryptoGoFishGame,
  CryptoGoFishSecureGame,
  CryptoGoFishZkAttestGame,
  type CryptoGoFishState,
} from "./modules/gofish";
import { MerkleBattleshipGame } from "./modules/merkle-battleship";
import { ThresholdTallyGame } from "./modules/threshold-tally";
import { OnePieceGame } from "./modules/onepiece";

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
      "Verifiable Battleship with binding placement (Merkle commitment).",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => MerkleBattleshipGame as Game,
  },
  {
    id: "gofish",
    name: "Go Fish (Game Flow Demo)",
    description:
      "Go Fish game-flow demo with basic mental poker encryption. Supports 2-4 players locally.",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => CryptoGoFishGame as Game,
    getCryptoGame: () => CryptoGoFishGame as Game,
  },
  {
    id: "gofish-secure",
    name: "Go Fish (Coop Reveal)",
    description:
      "Go Fish with cooperative decryption shares (no private keys in shared state). Currently supports forced-draw reveal demo.",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => CryptoGoFishSecureGame as Game,
    getCryptoGame: () => CryptoGoFishSecureGame as Game,
  },
  {
    id: "gofish-zk",
    name: "Go Fish (ZK Attest)",
    description:
      "Go Fish with a deterministic verifier who signs ZK verdicts for off-move proof checking (scaffolding).",
    minPlayers: 2,
    maxPlayers: 4,
    getGame: () => CryptoGoFishZkAttestGame as Game,
    getCryptoGame: () => CryptoGoFishZkAttestGame as Game,
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
    id: "war",
    name: "War",
    description:
      "Classic card battle. Flip cards and capture your opponent's deck!",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => WarGame as Game,
  },
  {
    id: "onepiece",
    name: "One Piece TCG",
    description:
      "One Piece Trading Card Game — rules-agnostic state manager with cooperative decryption.",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => OnePieceGame as Game,
  },
  {
    id: "simple",
    name: "Simple Card Game",
    description: "Draw and play cards. First to play 5 cards wins!",
    minPlayers: 2,
    maxPlayers: 2,
    getGame: () => SimpleCardGame as Game,
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
