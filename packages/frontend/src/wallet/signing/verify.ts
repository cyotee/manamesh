/**
 * EIP-712 Verification Utilities
 *
 * Functions for verifying EIP-712 typed data signatures.
 * Works client-side without blockchain access.
 */

import { recoverTypedDataAddress, hashTypedData } from 'viem';
import { MANAMESH_DOMAIN } from './domain';
import {
  getTypesForAction,
  type ActionTypeName,
  type ActionData,
} from './types';
import type { SignedAction } from './sign';

/**
 * Verification result
 */
export interface VerificationResult {
  /** Whether the signature is valid */
  isValid: boolean;
  /** Recovered signer address */
  recoveredAddress: `0x${string}` | null;
  /** Expected signer address */
  expectedAddress: `0x${string}`;
  /** Error message if verification failed */
  error?: string;
}

/**
 * Verify an EIP-712 signed action.
 *
 * Usage:
 * ```typescript
 * const result = await verifySignedAction(signedAction);
 * if (result.isValid) {
 *   console.log('Signature valid from:', result.recoveredAddress);
 * } else {
 *   console.error('Invalid signature:', result.error);
 * }
 * ```
 */
export async function verifySignedAction<T extends ActionData>(
  signedAction: SignedAction<T>
): Promise<VerificationResult> {
  const { actionType, data, signature, signer } = signedAction;

  try {
    const types = getTypesForAction(actionType);

    const recoveredAddress = await recoverTypedDataAddress({
      domain: MANAMESH_DOMAIN,
      types,
      primaryType: actionType,
      message: data as Record<string, unknown>,
      signature,
    });

    const isValid = recoveredAddress.toLowerCase() === signer.toLowerCase();

    return {
      isValid,
      recoveredAddress,
      expectedAddress: signer,
      error: isValid ? undefined : 'Recovered address does not match signer',
    };
  } catch (err) {
    return {
      isValid: false,
      recoveredAddress: null,
      expectedAddress: signer,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Verify a raw EIP-712 signature against action data.
 *
 * Use this when you have the components separately (not as a SignedAction object).
 */
export async function verifyTypedSignature(
  actionType: ActionTypeName,
  data: ActionData,
  signature: `0x${string}`,
  expectedAddress: `0x${string}`
): Promise<VerificationResult> {
  try {
    const types = getTypesForAction(actionType);

    const recoveredAddress = await recoverTypedDataAddress({
      domain: MANAMESH_DOMAIN,
      types,
      primaryType: actionType,
      message: data as Record<string, unknown>,
      signature,
    });

    const isValid = recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();

    return {
      isValid,
      recoveredAddress,
      expectedAddress,
      error: isValid ? undefined : 'Recovered address does not match expected',
    };
  } catch (err) {
    return {
      isValid: false,
      recoveredAddress: null,
      expectedAddress,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get the hash of a typed action (for commitment/verification schemes)
 */
export function hashTypedAction(
  actionType: ActionTypeName,
  data: ActionData
): `0x${string}` {
  const types = getTypesForAction(actionType);

  return hashTypedData({
    domain: MANAMESH_DOMAIN,
    types,
    primaryType: actionType,
    message: data as Record<string, unknown>,
  });
}

/**
 * Batch verify multiple signed actions.
 * Returns an array of results in the same order as inputs.
 */
export async function verifySignedActions(
  signedActions: SignedAction[]
): Promise<VerificationResult[]> {
  return Promise.all(signedActions.map(verifySignedAction));
}

/**
 * Check if all signed actions in an array are valid.
 * Useful for quick validation before processing.
 */
export async function areAllActionsValid(
  signedActions: SignedAction[]
): Promise<boolean> {
  const results = await verifySignedActions(signedActions);
  return results.every((r) => r.isValid);
}

/**
 * Filter out invalid actions from an array.
 * Returns only the actions with valid signatures.
 */
export async function filterValidActions<T extends SignedAction>(
  signedActions: T[]
): Promise<T[]> {
  const results = await verifySignedActions(signedActions);
  return signedActions.filter((_, i) => results[i].isValid);
}
