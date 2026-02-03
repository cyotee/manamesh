/**
 * EIP-712 Domain Configuration
 *
 * Defines the EIP-712 domain for ManaMesh game signatures.
 * Domain is chain-agnostic to allow cross-chain verification.
 */

import type { TypedDataDomain } from "viem";

/**
 * ManaMesh EIP-712 Domain
 *
 * Note: chainId is intentionally omitted to make signatures verifiable on any chain.
 * This is appropriate for game actions which are P2P and not submitted on-chain.
 */
export const MANAMESH_DOMAIN: TypedDataDomain = {
  name: "ManaMesh",
  version: "1",
  // chainId is omitted - signatures are chain-agnostic
  // verifyingContract is omitted - no on-chain contract
};

/**
 * Create a domain with a specific chain ID (for chain-specific actions)
 */
export function createChainSpecificDomain(chainId: number): TypedDataDomain {
  return { ...MANAMESH_DOMAIN, chainId: BigInt(chainId) };
}

/**
 * Create an on-chain-verifiable domain (must match OZ EIP712 in GameVault).
 */
export function createGameVaultDomain(
  chainId: number,
  verifyingContract: `0x${string}`,
): TypedDataDomain {
  return {
    name: "ManaMesh",
    version: "1",
    chainId: BigInt(chainId),
    verifyingContract,
  };
}

/**
 * Get the domain separator hash (for logging/debugging)
 */
export function getDomainSeparator(): string {
  // EIP-712 domain separator components
  return `ManaMesh v1 (chain-agnostic)`;
}
