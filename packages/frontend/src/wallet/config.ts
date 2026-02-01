/**
 * Wallet Configuration
 *
 * Chain configuration and wagmi setup for multi-chain Ethereum wallet support.
 * Supports: Ethereum Mainnet, Sepolia, Arbitrum, Base, Optimism, Polygon
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  mainnet,
  sepolia,
  arbitrum,
  base,
  optimism,
  polygon,
} from "wagmi/chains";
import { http } from "wagmi";

/**
 * Supported chains configuration
 */
export const SUPPORTED_CHAINS = [
  mainnet,
  sepolia,
  arbitrum,
  base,
  optimism,
  polygon,
] as const;

/**
 * Chain metadata for display purposes
 */
export const CHAIN_METADATA: Record<
  number,
  {
    name: string;
    shortName: string;
    icon: string;
    color: string;
  }
> = {
  [mainnet.id]: {
    name: "Ethereum",
    shortName: "ETH",
    icon: "⟠",
    color: "#627EEA",
  },
  [sepolia.id]: {
    name: "Sepolia",
    shortName: "SEP",
    icon: "⟠",
    color: "#CFB5F0",
  },
  [arbitrum.id]: {
    name: "Arbitrum One",
    shortName: "ARB",
    icon: "🔵",
    color: "#28A0F0",
  },
  [base.id]: {
    name: "Base",
    shortName: "BASE",
    icon: "🔵",
    color: "#0052FF",
  },
  [optimism.id]: {
    name: "Optimism",
    shortName: "OP",
    icon: "🔴",
    color: "#FF0420",
  },
  [polygon.id]: {
    name: "Polygon",
    shortName: "MATIC",
    icon: "🟣",
    color: "#8247E5",
  },
};

/**
 * Get RPC URLs from environment or use defaults
 */
function getRpcUrl(chainId: number): string {
  // Check for environment-configured RPC URLs
  const envKey = `VITE_RPC_URL_${chainId}`;
  const envUrl = import.meta.env[envKey];
  if (envUrl) {
    return envUrl;
  }

  // Default to public RPCs (for development - production should use private RPCs)
  switch (chainId) {
    case mainnet.id:
      return "https://eth.llamarpc.com";
    case sepolia.id:
      return "https://rpc.sepolia.org";
    case arbitrum.id:
      return "https://arb1.arbitrum.io/rpc";
    case base.id:
      return "https://mainnet.base.org";
    case optimism.id:
      return "https://mainnet.optimism.io";
    case polygon.id:
      return "https://polygon-rpc.com";
    default:
      throw new Error(`Unknown chain ID: ${chainId}`);
  }
}

/**
 * WalletConnect project ID
 * Get one at: https://cloud.walletconnect.com
 */
const WALLETCONNECT_PROJECT_ID =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "demo-project-id";

if (WALLETCONNECT_PROJECT_ID === "demo-project-id") {
  // RainbowKit requires a WalletConnect projectId for most connectors.
  // Keep a placeholder for local dev, but warn loudly so prod builds don’t silently break.
  console.warn(
    "[wallet] VITE_WALLETCONNECT_PROJECT_ID is not set; using demo-project-id. WalletConnect may not work.",
  );
}

/**
 * Create wagmi configuration with RainbowKit defaults
 */
export function createWagmiConfig() {
  return getDefaultConfig({
    appName: "ManaMesh",
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: SUPPORTED_CHAINS,
    transports: {
      [mainnet.id]: http(getRpcUrl(mainnet.id)),
      [sepolia.id]: http(getRpcUrl(sepolia.id)),
      [arbitrum.id]: http(getRpcUrl(arbitrum.id)),
      [base.id]: http(getRpcUrl(base.id)),
      [optimism.id]: http(getRpcUrl(optimism.id)),
      [polygon.id]: http(getRpcUrl(polygon.id)),
    },
  });
}

/**
 * Default chain to connect to (can be overridden by environment)
 */
export const DEFAULT_CHAIN_ID = parseInt(
  import.meta.env.VITE_DEFAULT_CHAIN_ID || String(sepolia.id),
  10,
);

/**
 * Get chain by ID
 */
export function getChainById(chainId: number) {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
}

/**
 * Check if a chain is supported
 */
export function isChainSupported(chainId: number): boolean {
  return SUPPORTED_CHAINS.some((chain) => chain.id === chainId);
}

/**
 * Get chain metadata
 */
export function getChainMetadata(chainId: number) {
  return CHAIN_METADATA[chainId];
}

// Re-export chain objects for convenience
export { mainnet, sepolia, arbitrum, base, optimism, polygon };
