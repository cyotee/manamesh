/**
 * EIP-712 Signing Utilities
 *
 * Functions for signing typed data using EIP-712 standard.
 * Supports both wagmi hooks and standalone signing.
 */

import { useSignTypedData, useAccount } from "wagmi";
import { useCallback, useState } from "react";
import { toHex, hexToBytes, keccak256 } from "viem";
import { MANAMESH_DOMAIN, createChainSpecificDomain } from "./domain";
import { walletDebug } from "../debug";
import {
  getTypesForAction,
  type ActionTypeName,
  type ActionData,
  type JoinGameData,
  type CommitShuffleData,
  type RevealCardData,
  type SubmitResultData,
  type GameActionData,
} from "./types";

/**
 * Signed action with signature and metadata
 */
export interface SignedAction<T extends ActionData = ActionData> {
  /** The action type */
  actionType: ActionTypeName;
  /** The action data */
  data: T;
  /** EIP-712 signature */
  signature: `0x${string}`;
  /** Address that signed */
  signer: `0x${string}`;
  /** Timestamp when signed */
  signedAt: number;
}

/**
 * useSignAction hook return type
 */
export interface UseSignActionReturn {
  /** Sign an action */
  signAction: <T extends ActionData>(
    actionType: ActionTypeName,
    data: T,
  ) => Promise<SignedAction<T>>;
  /** Whether signing is in progress */
  isSigning: boolean;
  /** Last signing error */
  error: Error | null;
}

/**
 * Hook to sign game actions with EIP-712.
 *
 * Usage:
 * ```tsx
 * const { signAction, isSigning } = useSignAction();
 *
 * const joinGame: JoinGameData = {
 *   gameId: 'game-123',
 *   playerId: 'player-1',
 *   publicKey: '0x...',
 *   timestamp: BigInt(Date.now()),
 * };
 *
 * const signed = await signAction('JoinGame', joinGame);
 * console.log(signed.signature);
 * ```
 */
export function useSignAction(): UseSignActionReturn {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const signAction = useCallback(
    async <T extends ActionData>(
      actionType: ActionTypeName,
      data: T,
    ): Promise<SignedAction<T>> => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      setIsSigning(true);
      setError(null);

      try {
        const types = getTypesForAction(actionType);

        const signature = await signTypedDataAsync({
          domain: MANAMESH_DOMAIN,
          types,
          primaryType: actionType,
          message: data as Record<string, unknown>,
        });

        const signedAction: SignedAction<T> = {
          actionType,
          data,
          signature,
          signer: address,
          signedAt: Date.now(),
        };

        walletDebug(`[signAction] Signed ${actionType}:`, signedAction);

        return signedAction;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsSigning(false);
      }
    },
    [address, signTypedDataAsync],
  );

  return {
    signAction,
    isSigning,
    error,
  };
}

// ============ Convenience hooks for specific action types ============

/**
 * Hook to sign JoinGame actions
 */
export function useSignJoinGame() {
  const { signAction, isSigning, error } = useSignAction();

  const signJoinGame = useCallback(
    async (data: JoinGameData): Promise<SignedAction<JoinGameData>> => {
      return signAction("JoinGame", data);
    },
    [signAction],
  );

  return { signJoinGame, isSigning, error };
}

/**
 * Hook to sign CommitShuffle actions
 */
export function useSignCommitShuffle() {
  const { signAction, isSigning, error } = useSignAction();

  const signCommitShuffle = useCallback(
    async (
      data: CommitShuffleData,
    ): Promise<SignedAction<CommitShuffleData>> => {
      return signAction("CommitShuffle", data);
    },
    [signAction],
  );

  return { signCommitShuffle, isSigning, error };
}

/**
 * Hook to sign RevealCard actions
 */
export function useSignRevealCard() {
  const { signAction, isSigning, error } = useSignAction();

  const signRevealCard = useCallback(
    async (data: RevealCardData): Promise<SignedAction<RevealCardData>> => {
      return signAction("RevealCard", data);
    },
    [signAction],
  );

  return { signRevealCard, isSigning, error };
}

/**
 * Hook to sign SubmitResult actions
 */
export function useSignSubmitResult() {
  const { signAction, isSigning, error } = useSignAction();

  const signSubmitResult = useCallback(
    async (data: SubmitResultData): Promise<SignedAction<SubmitResultData>> => {
      return signAction("SubmitResult", data);
    },
    [signAction],
  );

  return { signSubmitResult, isSigning, error };
}

// ============ Utility functions ============

/**
 * Create a JoinGame action with current timestamp
 */
export function createJoinGameData(
  gameId: string,
  playerId: string,
  publicKey: string,
): JoinGameData {
  return {
    gameId,
    playerId,
    publicKey: (publicKey.startsWith("0x")
      ? publicKey
      : `0x${publicKey}`) as `0x${string}`,
    timestamp: BigInt(Date.now()),
  };
}

/**
 * Create a CommitShuffle action with current timestamp
 */
export function createCommitShuffleData(
  gameId: string,
  playerId: string,
  shuffleIndex: number,
  commitment: string,
  proof: string,
): CommitShuffleData {
  return {
    gameId,
    playerId,
    shuffleIndex: BigInt(shuffleIndex),
    commitment: (commitment.startsWith("0x")
      ? commitment
      : `0x${commitment}`) as `0x${string}`,
    proof: (proof.startsWith("0x") ? proof : `0x${proof}`) as `0x${string}`,
    timestamp: BigInt(Date.now()),
  };
}

/**
 * Create a RevealCard action with current timestamp
 */
export function createRevealCardData(
  gameId: string,
  playerId: string,
  cardIndex: number,
  cardId: string,
  decryptionShare: string,
): RevealCardData {
  return {
    gameId,
    playerId,
    cardIndex: BigInt(cardIndex),
    cardId,
    decryptionShare: (decryptionShare.startsWith("0x")
      ? decryptionShare
      : `0x${decryptionShare}`) as `0x${string}`,
    timestamp: BigInt(Date.now()),
  };
}

/**
 * Create a SubmitResult action with current timestamp
 */
export function createSubmitResultData(
  gameId: string,
  winnerId: string,
  resultHash: string,
  payouts: string,
): SubmitResultData {
  return {
    gameId,
    winnerId,
    resultHash: (resultHash.startsWith("0x")
      ? resultHash
      : `0x${resultHash}`) as `0x${string}`,
    payouts: (payouts.startsWith("0x")
      ? payouts
      : `0x${payouts}`) as `0x${string}`,
    timestamp: BigInt(Date.now()),
  };
}
