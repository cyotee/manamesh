/**
 * useChain Hook
 *
 * Chain management hook for multi-chain support.
 * Provides current chain info and chain switching capabilities.
 */

import { useAccount, useSwitchChain } from 'wagmi';
import { useMemo, useCallback } from 'react';
import {
  SUPPORTED_CHAINS,
  CHAIN_METADATA,
  getChainById,
  isChainSupported,
  type SUPPORTED_CHAINS as SupportedChainsType,
} from '../config';

/**
 * Chain information with metadata
 */
export interface ChainInfo {
  /** Chain ID */
  id: number;
  /** Chain name */
  name: string;
  /** Short name for display */
  shortName: string;
  /** Icon emoji */
  icon: string;
  /** Brand color */
  color: string;
  /** Native currency symbol */
  nativeCurrency: string;
  /** Whether this is a testnet */
  isTestnet: boolean;
}

/**
 * useChain hook return type
 */
export interface UseChainReturn {
  /** Current chain ID (undefined if not connected) */
  chainId: number | undefined;
  /** Current chain info (null if not connected or unsupported) */
  chain: ChainInfo | null;
  /** Whether the current chain is supported */
  isSupported: boolean;
  /** List of all supported chains */
  supportedChains: ChainInfo[];
  /** Switch to a different chain */
  switchChain: (chainId: number) => Promise<void>;
  /** Whether a chain switch is in progress */
  isSwitching: boolean;
  /** Error from chain switch attempt */
  error: Error | null;
}

/**
 * Build chain info with metadata
 */
function buildChainInfo(chainId: number): ChainInfo | null {
  const chain = getChainById(chainId);
  if (!chain) return null;

  const metadata = CHAIN_METADATA[chainId] ?? {
    name: chain.name,
    shortName: chain.name.slice(0, 4).toUpperCase(),
    icon: '⟠',
    color: '#627EEA',
  };

  return {
    id: chain.id,
    name: metadata.name,
    shortName: metadata.shortName,
    icon: metadata.icon,
    color: metadata.color,
    nativeCurrency: chain.nativeCurrency.symbol,
    isTestnet: chain.testnet ?? false,
  };
}

/**
 * Hook to access chain state and switching.
 *
 * Usage:
 * ```tsx
 * const { chain, switchChain, supportedChains } = useChain();
 *
 * return (
 *   <select
 *     value={chain?.id}
 *     onChange={(e) => switchChain(Number(e.target.value))}
 *   >
 *     {supportedChains.map((c) => (
 *       <option key={c.id} value={c.id}>{c.name}</option>
 *     ))}
 *   </select>
 * );
 * ```
 */
export function useChain(): UseChainReturn {
  const { chainId } = useAccount();
  const {
    switchChainAsync,
    isPending: isSwitching,
    error,
  } = useSwitchChain();

  // Current chain info
  const chain = useMemo(() => {
    if (!chainId) return null;
    return buildChainInfo(chainId);
  }, [chainId]);

  // Whether current chain is supported
  const isSupported = useMemo(() => {
    if (!chainId) return false;
    return isChainSupported(chainId);
  }, [chainId]);

  // Build list of all supported chains
  const supportedChains = useMemo(() => {
    return SUPPORTED_CHAINS.map((c) => buildChainInfo(c.id)).filter(
      (c): c is ChainInfo => c !== null
    );
  }, []);

  // Switch chain action
  const switchChain = useCallback(
    async (targetChainId: number) => {
      if (!switchChainAsync) {
        throw new Error('Chain switching not available');
      }

      if (!isChainSupported(targetChainId)) {
        throw new Error(`Chain ${targetChainId} is not supported`);
      }

      await switchChainAsync({ chainId: targetChainId });
    },
    [switchChainAsync]
  );

  return {
    chainId,
    chain,
    isSupported,
    supportedChains,
    switchChain,
    isSwitching,
    error: error ?? null,
  };
}

/**
 * Hook to get just the current chain ID
 * Convenience wrapper for components that only need the ID
 */
export function useChainId(): number | undefined {
  const { chainId } = useAccount();
  return chainId;
}

/**
 * Hook to check if connected to a specific chain
 */
export function useIsChain(targetChainId: number): boolean {
  const { chainId } = useAccount();
  return chainId === targetChainId;
}
