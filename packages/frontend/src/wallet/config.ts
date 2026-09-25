/**
 * Wallet Configuration
 *
 * Chain configuration and wagmi setup for multi-chain Ethereum wallet support.
 * Supports: Ethereum Mainnet, Sepolia, Arbitrum, Base, Optimism, Polygon,
 * and Foundry/Anvil local (31337) for programmatic injected-wallet e2e.
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  mainnet,
  sepolia,
  arbitrum,
  base,
  optimism,
  polygon,
  foundry,
} from "wagmi/chains";
import { http } from "wagmi";
import type { Chain } from "viem";

/**
 * True when running Playwright / programmatic e2e (Vite env).
 * Also true for any non-production build when VITE_ENABLE_E2E_WALLET=1.
 */
export function isE2eWalletMode(): boolean {
  try {
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    return (
      env.VITE_E2E === "1" ||
      env.VITE_E2E === true ||
      env.VITE_ENABLE_E2E_WALLET === "1" ||
      env.VITE_ENABLE_E2E_WALLET === true
    );
  } catch {
    return false;
  }
}

/**
 * Local Anvil / Foundry chain with configurable RPC (default http://127.0.0.1:8545).
 * Chain id defaults to 31337; override with VITE_E2E_CHAIN_ID / VITE_POKER_CHAIN_ID.
 */
export function getLocalAnvilChain(): Chain {
  const env = import.meta.env as Record<string, string | undefined>;
  const chainId = Number(
    env.VITE_E2E_CHAIN_ID ?? env.VITE_POKER_CHAIN_ID ?? foundry.id,
  );
  const rpcUrl =
    env.VITE_E2E_RPC_URL ??
    env.VITE_RPC_URL ??
    env[`VITE_RPC_URL_${chainId}`] ??
    "http://127.0.0.1:8545";

  return {
    ...foundry,
    id: Number.isFinite(chainId) ? chainId : foundry.id,
    name: chainId === foundry.id ? "Anvil" : `Anvil (${chainId})`,
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  };
}

/**
 * Supported chains configuration (Anvil first when e2e so injected wallet matches).
 */
export const SUPPORTED_CHAINS = (() => {
  const production = [
    mainnet,
    sepolia,
    arbitrum,
    base,
    optimism,
    polygon,
  ] as const;
  if (isE2eWalletMode() || import.meta.env.DEV) {
    return [getLocalAnvilChain(), ...production] as const;
  }
  return production;
})();

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
  [foundry.id]: {
    name: "Anvil",
    shortName: "ANVIL",
    icon: "⚒️",
    color: "#F59E0B",
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

  const e2eRpc = import.meta.env.VITE_E2E_RPC_URL ?? import.meta.env.VITE_RPC_URL;
  if (e2eRpc && (chainId === foundry.id || chainId === Number(import.meta.env.VITE_E2E_CHAIN_ID))) {
    return e2eRpc as string;
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
    case foundry.id:
      return "http://127.0.0.1:8545";
    default:
      // Custom e2e chain ids still default to local anvil
      return (e2eRpc as string | undefined) ?? "http://127.0.0.1:8545";
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
 * Create wagmi configuration with RainbowKit defaults.
 * Includes local Anvil when e2e/dev so Playwright-injected window.ethereum matches.
 */
export function createWagmiConfig() {
  const chains = [...SUPPORTED_CHAINS] as unknown as [Chain, ...Chain[]];
  const transports: Record<number, ReturnType<typeof http>> = {};
  for (const chain of chains) {
    transports[chain.id] = http(getRpcUrl(chain.id));
  }

  return getDefaultConfig({
    appName: "ManaMesh",
    projectId: WALLETCONNECT_PROJECT_ID,
    chains,
    transports,
    // Prefer injected (Playwright EIP-1193) over WalletConnect in e2e.
    ssr: false,
  });
}

/**
 * Default chain to connect to (can be overridden by environment).
 * E2e / Anvil defaults to local chain when VITE_E2E=1.
 */
export const DEFAULT_CHAIN_ID = parseInt(
  import.meta.env.VITE_DEFAULT_CHAIN_ID ||
    import.meta.env.VITE_E2E_CHAIN_ID ||
    (isE2eWalletMode() ? String(foundry.id) : String(sepolia.id)),
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
export { mainnet, sepolia, arbitrum, base, optimism, polygon, foundry };
