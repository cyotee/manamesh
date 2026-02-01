/**
 * Wallet Module
 *
 * Ethereum wallet integration for ManaMesh.
 * Provides wallet connection, multi-chain support, key derivation, and EIP-712 signing.
 *
 * Usage:
 * ```tsx
 * import { WalletProvider, useWallet, useChain, useGameKeys } from './wallet';
 *
 * // Wrap your app with WalletProvider
 * <WalletProvider>
 *   <App />
 * </WalletProvider>
 *
 * // Use hooks in components
 * const { isConnected, connect } = useWallet();
 * const { chain, switchChain } = useChain();
 * const { deriveKeys } = useGameKeys();
 * ```
 */

// Provider
export { WalletProvider, getWagmiConfig } from './provider';

// Configuration
export {
  SUPPORTED_CHAINS,
  CHAIN_METADATA,
  DEFAULT_CHAIN_ID,
  createWagmiConfig,
  getChainById,
  isChainSupported,
  getChainMetadata,
  mainnet,
  sepolia,
  arbitrum,
  base,
  optimism,
  polygon,
} from './config';

// Hooks
export {
  useWallet,
  useAddress,
  useIsConnected,
  type WalletConnectionStatus,
  type ConnectedWalletInfo,
  type UseWalletReturn,
} from './hooks/useWallet';

export {
  useChain,
  useChainId,
  useIsChain,
  type ChainInfo,
  type UseChainReturn,
} from './hooks/useChain';

export {
  useGameKeys,
  useGameKeysForGame,
  type DerivedGameKeys,
  type UseGameKeysReturn,
} from './hooks/useGameKeys';

// Signing
export {
  MANAMESH_DOMAIN,
  createChainSpecificDomain,
  getDomainSeparator,
  GameActionTypes,
  JoinGameTypes,
  CommitShuffleTypes,
  RevealCardTypes,
  SubmitResultTypes,
  AllActionTypes,
  getTypesForAction,
  type GameActionData,
  type JoinGameData,
  type CommitShuffleData,
  type RevealCardData,
  type SubmitResultData,
  type ActionData,
  type ActionTypeName,
  useSignAction,
  useSignJoinGame,
  useSignCommitShuffle,
  useSignRevealCard,
  useSignSubmitResult,
  createJoinGameData,
  createCommitShuffleData,
  createRevealCardData,
  createSubmitResultData,
  type SignedAction,
  type UseSignActionReturn,
  verifySignedAction,
  verifyTypedSignature,
  hashTypedAction,
  verifySignedActions,
  areAllActionsValid,
  filterValidActions,
  type VerificationResult,
} from './signing';

// Plugin
export {
  WalletPlugin,
  hasWalletState,
  initWalletState,
  type WithWalletState,
  type WalletPluginState,
  type WalletPluginGameState,
  type WalletPluginApi,
  type SerializedSignedAction,
} from './plugin';

// Components
export {
  ConnectButton,
  CustomConnectButton,
  AccountDisplay,
  AddressDisplay,
  ChainSelector,
  ChainBadge,
  WalletModal,
  WalletButton,
} from './components';
