/**
 * useWallet Hook
 *
 * Main wallet hook providing connection state and actions.
 * Wraps wagmi hooks with a simplified interface.
 */

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useMemo } from 'react';

/**
 * Wallet connection status
 */
export type WalletConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Connected wallet information
 */
export interface ConnectedWalletInfo {
  /** Ethereum address (checksummed) */
  address: `0x${string}`;
  /** Chain ID the wallet is connected to */
  chainId: number;
  /** Connector name (MetaMask, WalletConnect, etc.) */
  connectorName: string;
}

/**
 * useWallet hook return type
 */
export interface UseWalletReturn {
  /** Whether the wallet is connected */
  isConnected: boolean;
  /** Whether the wallet is connecting */
  isConnecting: boolean;
  /** Whether the wallet is reconnecting */
  isReconnecting: boolean;
  /** Connection status */
  status: WalletConnectionStatus;
  /** Connected wallet info (null if not connected) */
  wallet: ConnectedWalletInfo | null;
  /** Connected address (undefined if not connected) */
  address: `0x${string}` | undefined;
  /** Open the connect modal */
  connect: () => void;
  /** Disconnect the wallet */
  disconnect: () => void;
  /** Error from connection attempt */
  error: Error | null;
}

/**
 * Hook to access wallet connection state and actions.
 *
 * Usage:
 * ```tsx
 * const { isConnected, address, connect, disconnect } = useWallet();
 *
 * if (!isConnected) {
 *   return <button onClick={connect}>Connect Wallet</button>;
 * }
 *
 * return <div>Connected: {address}</div>;
 * ```
 */
export function useWallet(): UseWalletReturn {
  const {
    address,
    isConnected,
    isConnecting,
    isReconnecting,
    status,
    chainId,
    connector,
  } = useAccount();

  const { openConnectModal } = useConnectModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { error } = useConnect();

  // Derive connection status
  const connectionStatus: WalletConnectionStatus = useMemo(() => {
    if (isReconnecting) return 'reconnecting';
    if (isConnecting) return 'connecting';
    if (isConnected) return 'connected';
    return 'disconnected';
  }, [isConnected, isConnecting, isReconnecting]);

  // Build wallet info object
  const walletInfo: ConnectedWalletInfo | null = useMemo(() => {
    if (!isConnected || !address || !chainId) {
      return null;
    }

    return {
      address,
      chainId,
      connectorName: connector?.name ?? 'Unknown',
    };
  }, [isConnected, address, chainId, connector]);

  // Connect action - opens RainbowKit modal
  const connect = () => {
    if (openConnectModal) {
      openConnectModal();
    }
  };

  // Disconnect action
  const disconnect = () => {
    wagmiDisconnect();
  };

  return {
    isConnected,
    isConnecting,
    isReconnecting,
    status: connectionStatus,
    wallet: walletInfo,
    address,
    connect,
    disconnect,
    error: error ?? null,
  };
}

/**
 * Hook to get just the connected address
 * Convenience wrapper for components that only need the address
 */
export function useAddress(): `0x${string}` | undefined {
  const { address } = useAccount();
  return address;
}

/**
 * Hook to check if wallet is connected
 * Convenience wrapper for conditional rendering
 */
export function useIsConnected(): boolean {
  const { isConnected } = useAccount();
  return isConnected;
}
