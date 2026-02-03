/**
 * EIP-712 Typed Data Schemas
 *
 * Defines structured types for game actions that can be signed with EIP-712.
 * These types enable verifiable game actions without on-chain transactions.
 */

import type { TypedData } from 'viem';

/**
 * Common types used across all game actions
 */
const CommonTypes = {
  // Empty - base types are primitive
} as const;

/**
 * Generic game action wrapper
 */
export const GameActionTypes = {
  GameAction: [
    { name: 'gameId', type: 'string' },
    { name: 'actionIndex', type: 'uint256' },
    { name: 'actionType', type: 'string' },
    { name: 'data', type: 'bytes' },
    { name: 'previousHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

/**
 * Join game action - player commits to joining a game
 */
export const JoinGameTypes = {
  JoinGame: [
    { name: 'gameId', type: 'string' },
    { name: 'playerId', type: 'string' },
    { name: 'publicKey', type: 'bytes' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

/**
 * Commit shuffle action - player commits their encrypted shuffle
 */
export const CommitShuffleTypes = {
  CommitShuffle: [
    { name: 'gameId', type: 'string' },
    { name: 'playerId', type: 'string' },
    { name: 'shuffleIndex', type: 'uint256' },
    { name: 'commitment', type: 'bytes32' },
    { name: 'proof', type: 'bytes' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

/**
 * Reveal card action - player reveals a card during play
 */
export const RevealCardTypes = {
  RevealCard: [
    { name: 'gameId', type: 'string' },
    { name: 'playerId', type: 'string' },
    { name: 'cardIndex', type: 'uint256' },
    { name: 'cardId', type: 'string' },
    { name: 'decryptionShare', type: 'bytes' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

/**
 * Submit result action - player submits final game result
 */
export const SubmitResultTypes = {
  SubmitResult: [
    { name: 'gameId', type: 'string' },
    { name: 'winnerId', type: 'string' },
    { name: 'resultHash', type: 'bytes32' },
    { name: 'payouts', type: 'bytes' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

// ============ Settlement Types (matching contracts/src/interfaces/IGameVault.sol) ============

/**
 * Bet action - a single bet in a hand (matches Solidity Bet struct)
 */
export const BetTypes = {
  Bet: [
    { name: 'handId', type: 'bytes32' },
    { name: 'betIndex', type: 'uint256' },
    { name: 'action', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'previousBetHash', type: 'bytes32' },
  ],
} as const;

/**
 * Hand result - outcome of a hand (matches Solidity HandResult struct)
 */
export const HandResultTypes = {
  HandResult: [
    { name: 'gameId', type: 'bytes32' },
    { name: 'handId', type: 'bytes32' },
    { name: 'winner', type: 'address' },
    { name: 'potAmount', type: 'uint256' },
    { name: 'finalBetHash', type: 'bytes32' },
  ],
} as const;

/**
 * Fold authorization - allows settlement without folded player's signature
 */
export const FoldAuthTypes = {
  FoldAuth: [
    { name: 'handId', type: 'bytes32' },
    { name: 'foldingPlayer', type: 'address' },
    { name: 'authorizedSettlers', type: 'address[]' },
  ],
} as const;

/**
 * Abandonment claim - for claiming stake from abandoned player
 */
export const AbandonmentTypes = {
  Abandonment: [
    { name: 'gameId', type: 'bytes32' },
    { name: 'handId', type: 'bytes32' },
    { name: 'abandonedPlayer', type: 'address' },
    { name: 'abandonedAt', type: 'uint256' },
    { name: 'splitRecipients', type: 'address[]' },
    { name: 'splitAmounts', type: 'uint256[]' },
  ],
} as const;

/**
 * All action types combined for convenience
 */
export const AllActionTypes = {
  ...GameActionTypes,
  ...JoinGameTypes,
  ...CommitShuffleTypes,
  ...RevealCardTypes,
  ...SubmitResultTypes,
  ...BetTypes,
  ...HandResultTypes,
  ...FoldAuthTypes,
  ...AbandonmentTypes,
} as const;

// ============ TypeScript interfaces for action data ============

/**
 * Generic game action data
 */
export interface GameActionData {
  gameId: string;
  actionIndex: bigint;
  actionType: string;
  data: `0x${string}`;
  previousHash: `0x${string}`;
  timestamp: bigint;
}

/**
 * Join game action data
 */
export interface JoinGameData {
  gameId: string;
  playerId: string;
  publicKey: `0x${string}`;
  timestamp: bigint;
}

/**
 * Commit shuffle action data
 */
export interface CommitShuffleData {
  gameId: string;
  playerId: string;
  shuffleIndex: bigint;
  commitment: `0x${string}`;
  proof: `0x${string}`;
  timestamp: bigint;
}

/**
 * Reveal card action data
 */
export interface RevealCardData {
  gameId: string;
  playerId: string;
  cardIndex: bigint;
  cardId: string;
  decryptionShare: `0x${string}`;
  timestamp: bigint;
}

/**
 * Submit result action data
 */
export interface SubmitResultData {
  gameId: string;
  winnerId: string;
  resultHash: `0x${string}`;
  payouts: `0x${string}`;
  timestamp: bigint;
}

// ============ Settlement TypeScript interfaces ============

/**
 * Bet action enum (matches Solidity uint8)
 */
export enum BetAction {
  Fold = 0,
  Check = 1,
  Call = 2,
  Raise = 3,
  AllIn = 4,
}

/**
 * Bet data (matches Solidity Bet struct)
 */
export interface BetData {
  handId: `0x${string}`;
  betIndex: bigint;
  action: BetAction;
  amount: bigint;
  previousBetHash: `0x${string}`;
}

/**
 * Hand result data (matches Solidity HandResult struct)
 */
export interface HandResultData {
  gameId: `0x${string}`;
  handId: `0x${string}`;
  winner: `0x${string}`;
  potAmount: bigint;
  finalBetHash: `0x${string}`;
}

/**
 * Fold authorization data (matches Solidity FoldAuth struct)
 */
export interface FoldAuthData {
  handId: `0x${string}`;
  foldingPlayer: `0x${string}`;
  authorizedSettlers: `0x${string}`[];
}

/**
 * Abandonment claim data (matches Solidity Abandonment struct)
 */
export interface AbandonmentData {
  gameId: `0x${string}`;
  handId: `0x${string}`;
  abandonedPlayer: `0x${string}`;
  abandonedAt: bigint;
  splitRecipients: `0x${string}`[];
  splitAmounts: bigint[];
}

/**
 * Union of all action data types
 */
export type ActionData =
  | GameActionData
  | JoinGameData
  | CommitShuffleData
  | RevealCardData
  | SubmitResultData
  | BetData
  | HandResultData
  | FoldAuthData
  | AbandonmentData;

/**
 * Action type names
 */
export type ActionTypeName =
  | 'GameAction'
  | 'JoinGame'
  | 'CommitShuffle'
  | 'RevealCard'
  | 'SubmitResult'
  | 'Bet'
  | 'HandResult'
  | 'FoldAuth'
  | 'Abandonment';

/**
 * Get the EIP-712 type definition for an action type
 */
export function getTypesForAction(actionType: ActionTypeName): Record<string, readonly { name: string; type: string }[]> {
  switch (actionType) {
    case 'GameAction':
      return GameActionTypes;
    case 'JoinGame':
      return JoinGameTypes;
    case 'CommitShuffle':
      return CommitShuffleTypes;
    case 'RevealCard':
      return RevealCardTypes;
    case 'SubmitResult':
      return SubmitResultTypes;
    case 'Bet':
      return BetTypes;
    case 'HandResult':
      return HandResultTypes;
    case 'FoldAuth':
      return FoldAuthTypes;
    case 'Abandonment':
      return AbandonmentTypes;
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
