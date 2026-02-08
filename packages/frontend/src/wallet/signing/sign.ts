/**
 * EIP-712 Signing Utilities
 *
 * Functions for signing typed data using EIP-712 standard.
 * Supports both wagmi hooks and standalone signing.
 */

import { useSignTypedData, useAccount, useChainId } from "wagmi";
import { useCallback, useState } from "react";
import { toHex, hexToBytes, keccak256, encodeAbiParameters } from "viem";
import type { TypedDataDomain } from "viem";
import { MANAMESH_DOMAIN, createGameVaultDomain } from "./domain";
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
  type BetData,
  type HandResultData,
  type FoldAuthData,
  type AbandonmentData,
  BetAction,
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
    opts?: { domain?: TypedDataDomain },
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
      opts?: { domain?: TypedDataDomain },
    ): Promise<SignedAction<T>> => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      setIsSigning(true);
      setError(null);

      try {
        const types = getTypesForAction(actionType);

        const signature = await signTypedDataAsync({
          domain: opts?.domain ?? MANAMESH_DOMAIN,
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

/**
 * Hook to sign actions intended for on-chain verification by GameVault.
 * Domain includes chainId + verifyingContract.
 */
export function useSignGameVaultAction(vaultAddress: `0x${string}`) {
  const chainId = useChainId();
  const { signAction, isSigning, error } = useSignAction();

  const signVaultAction = useCallback(
    async <T extends ActionData>(
      actionType: ActionTypeName,
      data: T,
    ): Promise<SignedAction<T>> => {
      const domain = createGameVaultDomain(chainId, vaultAddress);
      return signAction(actionType, data, { domain });
    },
    [chainId, vaultAddress, signAction],
  );

  return { signVaultAction, isSigning, error };
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

// ============ Settlement Signing Hooks ============

/**
 * Hook to sign Bet actions (for off-chain betting)
 */
export function useSignBet() {
  const { signAction, isSigning, error } = useSignAction();

  const signBet = useCallback(
    async (data: BetData): Promise<SignedAction<BetData>> => {
      return signAction("Bet", data);
    },
    [signAction],
  );

  return { signBet, isSigning, error };
}

/**
 * Hook to sign HandResult actions (for settlement)
 */
export function useSignHandResult() {
  const { signAction, isSigning, error } = useSignAction();

  const signHandResult = useCallback(
    async (data: HandResultData): Promise<SignedAction<HandResultData>> => {
      return signAction("HandResult", data);
    },
    [signAction],
  );

  return { signHandResult, isSigning, error };
}

/**
 * Hook to sign FoldAuth actions (for authorizing settlement without folded player)
 */
export function useSignFoldAuth() {
  const { signAction, isSigning, error } = useSignAction();

  const signFoldAuth = useCallback(
    async (data: FoldAuthData): Promise<SignedAction<FoldAuthData>> => {
      return signAction("FoldAuth", data);
    },
    [signAction],
  );

  return { signFoldAuth, isSigning, error };
}

/**
 * Hook to sign Abandonment claims
 */
export function useSignAbandonment() {
  const { signAction, isSigning, error } = useSignAction();

  const signAbandonment = useCallback(
    async (data: AbandonmentData): Promise<SignedAction<AbandonmentData>> => {
      return signAction("Abandonment", data);
    },
    [signAction],
  );

  return { signAbandonment, isSigning, error };
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

// ============ Settlement Data Creation Functions ============

/**
 * Create a Bet with proper chain linking
 */
export function createBetData(
  handId: string,
  bettor: string,
  betIndex: number,
  action: BetAction,
  amount: bigint,
  previousBetHash: string = "0x0000000000000000000000000000000000000000000000000000000000000000",
): BetData {
  return {
    handId: (handId.startsWith("0x") ? handId : `0x${handId}`) as `0x${string}`,
    bettor: bettor as `0x${string}`,
    betIndex: BigInt(betIndex),
    action,
    amount,
    previousBetHash: (previousBetHash.startsWith("0x")
      ? previousBetHash
      : `0x${previousBetHash}`) as `0x${string}`,
  };
}

/**
 * Create a HandResult for settlement
 */
export function createHandResultData(
  gameId: string,
  handId: string,
  finalBetHash: string,
  players: string[],
  deltas: bigint[],
): HandResultData {
  return {
    gameId: (gameId.startsWith("0x") ? gameId : `0x${gameId}`) as `0x${string}`,
    handId: (handId.startsWith("0x") ? handId : `0x${handId}`) as `0x${string}`,
    finalBetHash: (finalBetHash.startsWith("0x")
      ? finalBetHash
      : `0x${finalBetHash}`) as `0x${string}`,
    players: players as `0x${string}`[],
    deltas,
  };
}

/**
 * Create a FoldAuth to authorize settlement without folded player
 */
export function createFoldAuthData(
  gameId: string,
  handId: string,
  foldingPlayer: string,
  authorizedSettlers: string[],
): FoldAuthData {
  return {
    gameId: (gameId.startsWith("0x") ? gameId : `0x${gameId}`) as `0x${string}`,
    handId: (handId.startsWith("0x") ? handId : `0x${handId}`) as `0x${string}`,
    foldingPlayer: foldingPlayer as `0x${string}`,
    authorizedSettlers: authorizedSettlers as `0x${string}`[],
  };
}

/**
 * Create an Abandonment claim
 */
export function createAbandonmentData(
  gameId: string,
  handId: string,
  abandonedPlayer: string,
  abandonedAt: number,
  splitRecipients: string[],
  splitAmounts: bigint[],
): AbandonmentData {
  return {
    gameId: (gameId.startsWith("0x") ? gameId : `0x${gameId}`) as `0x${string}`,
    handId: (handId.startsWith("0x") ? handId : `0x${handId}`) as `0x${string}`,
    abandonedPlayer: abandonedPlayer as `0x${string}`,
    abandonedAt: BigInt(abandonedAt),
    splitRecipients: splitRecipients as `0x${string}`[],
    splitAmounts,
  };
}

/**
 * Compute the hash of a bet (for chain linking)
 * This matches the Solidity SignatureVerifier.hashBet() function
 */
export function hashBet(bet: BetData): `0x${string}` {
  // Matches contracts/src/libraries/SignatureVerifier.sol:hashBet
  const BET_TYPEHASH = keccak256(
    toHex(
      new TextEncoder().encode(
        "Bet(bytes32 handId,address bettor,uint256 betIndex,uint8 action,uint256 amount,bytes32 previousBetHash)",
      ),
    ),
  );

  const encoded = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint8" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      BET_TYPEHASH,
      bet.handId,
      bet.bettor,
      bet.betIndex,
      bet.action,
      bet.amount,
      bet.previousBetHash,
    ],
  );

  return keccak256(encoded);
}
