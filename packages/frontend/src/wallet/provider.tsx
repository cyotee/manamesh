/**
 * Wallet Provider
 *
 * React context provider that wraps wagmi and RainbowKit for Ethereum wallet management.
 * Provides wallet connection, multi-chain support, and game key derivation.
 */

import React from "react";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient } from "@tanstack/query-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { createWagmiConfig } from "./config";

// Import RainbowKit styles
import "@rainbow-me/rainbowkit/styles.css";

/**
 * Create a singleton QueryClient for react-query
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Wallet state should be fresh
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Create a singleton wagmi config
 */
const wagmiConfig = createWagmiConfig();

/**
 * Get the wagmi config (for use outside React components)
 */
export function getWagmiConfig() {
  return wagmiConfig;
}

/**
 * Props for WalletProvider
 */
interface WalletProviderProps {
  children: React.ReactNode;
}

/**
 * RainbowKit theme customization to match ManaMesh dark theme
 */
const manaMeshTheme = darkTheme({
  accentColor: "#4CAF50", // ManaMesh green
  accentColorForeground: "white",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});

/**
 * WalletProvider component
 *
 * Wraps the application with:
 * - QueryClientProvider (for react-query, required by wagmi)
 * - WagmiProvider (for wallet state management)
 * - RainbowKitProvider (for wallet connection UI)
 *
 * Usage:
 * ```tsx
 * <WalletProvider>
 *   <App />
 * </WalletProvider>
 * ```
 */
export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={manaMeshTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

/**
 * Re-export config for convenience
 */
export { wagmiConfig, queryClient };
