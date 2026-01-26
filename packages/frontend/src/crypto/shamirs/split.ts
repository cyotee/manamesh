/**
 * Shamir's Secret Sharing - Split Operation
 *
 * Splits a secret into N shares where any K shares can reconstruct the original.
 * Uses polynomial interpolation over a prime field GF(p).
 */

import { PRIME, SecretShare, ShamirConfig, SplitResult, ShareValidationError } from './types';

/**
 * Generate a cryptographically secure random BigInt in range [0, max)
 */
function randomBigInt(max: bigint): bigint {
  // Determine byte length needed
  const byteLength = Math.ceil(max.toString(16).length / 2);
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  // Convert to BigInt
  let result = BigInt(0);
  for (const byte of bytes) {
    result = (result << BigInt(8)) | BigInt(byte);
  }

  // Reduce to range [0, max)
  return result % max;
}

/**
 * Modular arithmetic: (a + b) mod p
 */
function modAdd(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) + (b % p) + p) % p;
}

/**
 * Modular arithmetic: (a * b) mod p
 */
function modMul(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) * (b % p) + p) % p;
}

/**
 * Evaluate polynomial at point x
 * polynomial[i] is the coefficient of x^i
 */
function evaluatePolynomial(coefficients: bigint[], x: bigint, p: bigint): bigint {
  let result = BigInt(0);
  let xPower = BigInt(1);

  for (const coef of coefficients) {
    result = modAdd(result, modMul(coef, xPower, p), p);
    xPower = modMul(xPower, x, p);
  }

  return result;
}

/**
 * Convert a hex string to BigInt
 */
function hexToBigInt(hex: string): bigint {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
    throw new ShareValidationError(`Invalid hex string: ${hex}`);
  }
  return BigInt('0x' + cleanHex);
}

/**
 * Convert BigInt to hex string (with leading zeros preserved)
 */
function bigIntToHex(n: bigint, byteLength: number = 32): string {
  const hex = n.toString(16);
  return hex.padStart(byteLength * 2, '0');
}

/**
 * Split a secret into shares using Shamir's Secret Sharing
 *
 * @param secret - The secret to split (hex string, typically a private key)
 * @param config - Threshold (K) and total shares (N)
 * @returns SplitResult with the generated shares
 *
 * @example
 * ```typescript
 * const result = splitSecret(privateKeyHex, { threshold: 3, totalShares: 4 });
 * // Any 3 of the 4 shares can reconstruct the secret
 * ```
 */
export function splitSecret(secret: string, config: ShamirConfig): SplitResult {
  const { threshold, totalShares } = config;

  // Validate inputs
  if (threshold < 2) {
    throw new ShareValidationError('Threshold must be at least 2');
  }
  if (totalShares < threshold) {
    throw new ShareValidationError('Total shares must be >= threshold');
  }
  if (totalShares > 255) {
    throw new ShareValidationError('Maximum 255 shares supported');
  }

  // Convert secret to BigInt
  const secretBigInt = hexToBigInt(secret);

  // Validate secret is in valid range
  if (secretBigInt >= PRIME) {
    throw new ShareValidationError('Secret too large for prime field');
  }

  // Generate random polynomial coefficients
  // f(x) = secret + a1*x + a2*x^2 + ... + a(k-1)*x^(k-1)
  // where k = threshold
  const coefficients: bigint[] = [secretBigInt];
  for (let i = 1; i < threshold; i++) {
    coefficients.push(randomBigInt(PRIME));
  }

  // Generate shares by evaluating polynomial at points 1, 2, ..., N
  const shares: SecretShare[] = [];
  for (let i = 1; i <= totalShares; i++) {
    const x = BigInt(i);
    const y = evaluatePolynomial(coefficients, x, PRIME);
    shares.push({
      index: i,
      value: bigIntToHex(y),
    });
  }

  return {
    threshold,
    totalShares,
    shares,
  };
}

/**
 * Validate that a share has the correct format
 */
export function validateShare(share: SecretShare): boolean {
  if (typeof share.index !== 'number' || share.index < 1 || share.index > 255) {
    return false;
  }
  if (typeof share.value !== 'string') {
    return false;
  }
  try {
    const val = hexToBigInt(share.value);
    return val >= BigInt(0) && val < PRIME;
  } catch {
    return false;
  }
}

/**
 * Create shares for distribution to other players
 *
 * @param privateKey - The player's private key to split
 * @param fromPlayer - The player ID who owns the key
 * @param otherPlayers - List of other player IDs to receive shares
 * @param threshold - Minimum shares needed to reconstruct (default: N-1)
 * @returns Array of KeyShares, one per recipient
 */
export function createKeyShares(
  privateKey: string,
  fromPlayer: string,
  otherPlayers: string[],
  threshold?: number
): import('./types').KeyShare[] {
  const totalShares = otherPlayers.length + 1; // +1 for the owner
  const k = threshold ?? Math.max(2, otherPlayers.length); // Default: need all others

  const result = splitSecret(privateKey, {
    threshold: k,
    totalShares,
  });

  // Distribute shares to other players (skip index 1 which could be kept by owner)
  return otherPlayers.map((playerId, idx) => ({
    fromPlayer,
    forPlayer: playerId,
    share: result.shares[idx + 1], // Start from index 2 (1-based)
  }));
}
