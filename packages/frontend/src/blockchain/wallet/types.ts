/**
 * Wallet Types
 *
 * Types for Ethereum wallet connection and key derivation.
 */

/**
 * Wallet connection status
 */
export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Connected wallet information
 */
export interface ConnectedWallet {
  /** Ethereum address (checksummed) */
  address: string;
  /** Chain ID the wallet is connected to */
  chainId: number;
  /** Wallet provider name (MetaMask, WalletConnect, etc.) */
  providerName: string;
}

/**
 * Game keys derived from wallet signature
 */
export interface DerivedGameKeys {
  /** Private key for SRA encryption (hex) */
  privateKey: string;
  /** Public key for SRA encryption (hex) */
  publicKey: string;
  /** Game ID these keys are derived for */
  gameId: string;
  /** Wallet address that signed */
  walletAddress: string;
}

/**
 * Wallet connection options
 */
export interface WalletConnectionOptions {
  /** Preferred chain ID (default: 1 for mainnet) */
  chainId?: number;
  /** Whether to request signature immediately */
  autoSign?: boolean;
}

/**
 * Wallet provider interface (abstraction over different wallet types)
 */
export interface WalletProvider {
  /** Connect to wallet */
  connect(): Promise<ConnectedWallet>;
  /** Disconnect wallet */
  disconnect(): Promise<void>;
  /** Sign a message */
  signMessage(message: string): Promise<string>;
  /** Get current connection status */
  getStatus(): WalletStatus;
  /** Get connected wallet info (null if not connected) */
  getWallet(): ConnectedWallet | null;
  /** Listen for account changes */
  onAccountChange(callback: (address: string | null) => void): () => void;
  /** Listen for chain changes */
  onChainChange(callback: (chainId: number) => void): () => void;
}

/**
 * EIP-1193 Provider (MetaMask, etc.)
 */
export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  removeListener(event: string, callback: (...args: unknown[]) => void): void;
}

/**
 * Window with ethereum provider
 */
declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
