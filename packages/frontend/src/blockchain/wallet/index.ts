/**
 * Wallet Module (Legacy)
 *
 * Provides wallet connection and key derivation for blockchain poker.
 * Uses mock implementation for demo/testing purposes.
 *
 * For real wallet integration with MetaMask/RainbowKit, see:
 * - src/wallet/provider.tsx - WalletProvider component
 * - src/wallet/hooks/ - React hooks for wallet state
 * - src/wallet/signing/ - EIP-712 signing utilities
 */

export * from './types';
export * from './mock-wallet';
export * from './context';

// Re-export key items from new wallet module for convenience
export {
  WalletProvider,
  useWallet as useRealWallet,
  useChain,
  useGameKeys as useRealGameKeys,
  useGameKeysForGame,
  ConnectButton,
  AccountDisplay,
  ChainSelector,
  WalletButton,
} from '../../wallet';
