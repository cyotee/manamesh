/**
 * Signing Module
 *
 * EIP-712 typed data signing and verification for game actions.
 */

// Domain
export {
  MANAMESH_DOMAIN,
  createChainSpecificDomain,
  getDomainSeparator,
} from "./domain";
export { createGameVaultDomain } from "./domain";

// Types
export {
  GameActionTypes,
  JoinGameTypes,
  CommitShuffleTypes,
  RevealCardTypes,
  SubmitResultTypes,
  BetTypes,
  HandResultTypes,
  FoldAuthTypes,
  AbandonmentTypes,
  AllActionTypes,
  getTypesForAction,
  BetAction,
  type GameActionData,
  type JoinGameData,
  type CommitShuffleData,
  type RevealCardData,
  type SubmitResultData,
  type BetData,
  type HandResultData,
  type FoldAuthData,
  type AbandonmentData,
  type ActionData,
  type ActionTypeName,
} from "./types";

// Signing
export {
  useSignAction,
  useSignGameVaultAction,
  useSignJoinGame,
  useSignCommitShuffle,
  useSignRevealCard,
  useSignSubmitResult,
  useSignBet,
  useSignHandResult,
  useSignFoldAuth,
  useSignAbandonment,
  createJoinGameData,
  createCommitShuffleData,
  createRevealCardData,
  createSubmitResultData,
  createBetData,
  createHandResultData,
  createFoldAuthData,
  createAbandonmentData,
  hashBet,
  type SignedAction,
  type UseSignActionReturn,
} from "./sign";

// Verification
export {
  verifySignedAction,
  verifyTypedSignature,
  hashTypedAction,
  verifySignedActions,
  areAllActionsValid,
  filterValidActions,
  type VerificationResult,
} from "./verify";
