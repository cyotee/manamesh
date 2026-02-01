/**
 * Wallet Hooks
 *
 * React hooks for wallet management, chain switching, and key derivation.
 */

export {
  useWallet,
  useAddress,
  useIsConnected,
  type WalletConnectionStatus,
  type ConnectedWalletInfo,
  type UseWalletReturn,
} from './useWallet';

export {
  useChain,
  useChainId,
  useIsChain,
  type ChainInfo,
  type UseChainReturn,
} from './useChain';

export {
  useGameKeys,
  useGameKeysForGame,
  type DerivedGameKeys,
  type UseGameKeysReturn,
} from './useGameKeys';
