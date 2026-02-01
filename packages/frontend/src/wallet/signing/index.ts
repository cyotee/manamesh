/**
 * Signing Module
 *
 * EIP-712 typed data signing and verification for game actions.
 */

// Domain
export { MANAMESH_DOMAIN, createChainSpecificDomain, getDomainSeparator } from './domain';

// Types
export {
  GameActionTypes,
  JoinGameTypes,
  CommitShuffleTypes,
  RevealCardTypes,
  SubmitResultTypes,
  AllActionTypes,
  getTypesForAction,
  type GameActionData,
  type JoinGameData,
  type CommitShuffleData,
  type RevealCardData,
  type SubmitResultData,
  type ActionData,
  type ActionTypeName,
} from './types';

// Signing
export {
  useSignAction,
  useSignJoinGame,
  useSignCommitShuffle,
  useSignRevealCard,
  useSignSubmitResult,
  createJoinGameData,
  createCommitShuffleData,
  createRevealCardData,
  createSubmitResultData,
  type SignedAction,
  type UseSignActionReturn,
} from './sign';

// Verification
export {
  verifySignedAction,
  verifyTypedSignature,
  hashTypedAction,
  verifySignedActions,
  areAllActionsValid,
  filterValidActions,
  type VerificationResult,
} from './verify';
