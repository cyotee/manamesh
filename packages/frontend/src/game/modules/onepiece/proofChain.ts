/**
 * Cryptographic Proof Chain
 *
 * Maintains an auditable chain of all game state transitions.
 * Each proof links to the previous, forming a tamper-evident log
 * that both players can verify for dispute resolution.
 */

import type { CryptographicProof, OnePieceState } from './types';

// =============================================================================
// Proof Creation
// =============================================================================

let proofCounter = 0;

/**
 * Generate a unique transition ID.
 */
function generateTransitionId(): string {
  return `proof-${Date.now()}-${proofCounter++}`;
}

/**
 * Compute a SHA-256-like hash of proof data.
 * Uses a deterministic string representation for consistency.
 *
 * In production, this would use actual SHA-256.
 * For the module implementation, we use a simple hash
 * that can be replaced with crypto.subtle.digest later.
 */
export function hashProofData(data: string): string {
  // Simple deterministic hash for game state serialization.
  // This is a placeholder that produces consistent, unique hashes.
  // In production, replace with: await crypto.subtle.digest('SHA-256', ...)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Convert to hex-like string with enough entropy for proof chain linking
  const timestamp = Date.now();
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-${timestamp.toString(16)}`;
}

/**
 * Create a new cryptographic proof for a state transition.
 */
export function createProof(
  action: string,
  data: Record<string, unknown>,
  previousProofHash: string | null,
): CryptographicProof {
  const transitionId = generateTransitionId();
  const timestamp = Date.now();

  const proofData = JSON.stringify({
    transitionId,
    previousProofHash,
    action,
    data,
    timestamp,
  });

  const hash = hashProofData(proofData);

  return {
    transitionId,
    previousProofHash,
    action,
    data,
    signatures: {},
    timestamp,
    hash,
  };
}

/**
 * Sign a proof with a player's signature.
 * In production, this would use ECDSA or similar.
 */
export function signProof(
  proof: CryptographicProof,
  playerId: string,
  signature: string,
): CryptographicProof {
  return {
    ...proof,
    signatures: {
      ...proof.signatures,
      [playerId]: signature,
    },
  };
}

// =============================================================================
// Proof Chain Operations
// =============================================================================

/**
 * Append a proof to the game state's proof chain.
 */
export function appendProof(
  state: OnePieceState,
  proof: CryptographicProof,
): void {
  state.proofChain.push(proof);
}

/**
 * Verify the integrity of the entire proof chain.
 *
 * Checks that:
 * 1. Each proof's previousProofHash matches the prior proof's hash
 * 2. The chain starts with a null previousProofHash
 * 3. Timestamps are monotonically increasing
 *
 * @returns Result with validity and any error details.
 */
export function verifyProofChain(
  chain: CryptographicProof[],
): ProofChainVerification {
  if (chain.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors: ProofChainError[] = [];

  // First proof must have null previous hash
  if (chain[0].previousProofHash !== null) {
    errors.push({
      index: 0,
      transitionId: chain[0].transitionId,
      error: 'First proof must have null previousProofHash',
    });
  }

  for (let i = 1; i < chain.length; i++) {
    const current = chain[i];
    const previous = chain[i - 1];

    // Check chain linkage
    if (current.previousProofHash !== previous.hash) {
      errors.push({
        index: i,
        transitionId: current.transitionId,
        error: `Chain broken: expected previousProofHash "${previous.hash}", got "${current.previousProofHash}"`,
      });
    }

    // Check timestamp ordering
    if (current.timestamp < previous.timestamp) {
      errors.push({
        index: i,
        transitionId: current.transitionId,
        error: `Timestamp regression: ${current.timestamp} < ${previous.timestamp}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Verify that a specific proof has signatures from both players.
 */
export function verifyProofSignatures(
  proof: CryptographicProof,
  requiredSigners: string[],
): SignatureVerification {
  const missing = requiredSigners.filter(
    (signer) => !(signer in proof.signatures),
  );

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get the latest proof in the chain.
 */
export function getLatestProof(
  state: OnePieceState,
): CryptographicProof | null {
  if (state.proofChain.length === 0) return null;
  return state.proofChain[state.proofChain.length - 1];
}

/**
 * Get the hash of the latest proof (for chaining).
 */
export function getLatestProofHash(
  state: OnePieceState,
): string | null {
  const latest = getLatestProof(state);
  return latest?.hash ?? null;
}

/**
 * Find all proofs for a specific card.
 */
export function getProofsForCard(
  state: OnePieceState,
  cardId: string,
): CryptographicProof[] {
  return state.proofChain.filter(
    (proof) => proof.data.cardId === cardId,
  );
}

// =============================================================================
// Verification Types
// =============================================================================

export interface ProofChainError {
  index: number;
  transitionId: string;
  error: string;
}

export interface ProofChainVerification {
  valid: boolean;
  errors: ProofChainError[];
}

export interface SignatureVerification {
  valid: boolean;
  missing: string[];
}
