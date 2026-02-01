/**
 * Wallet Context (Legacy)
 *
 * This module provides backward compatibility with the existing mock wallet.
 * For new code, use the real wallet module at `src/wallet/`.
 *
 * The mock wallet is used when:
 * - No wallet is connected via RainbowKit
 * - Running in test/demo mode without MetaMask
 *
 * For real wallet integration, wrap your app with `WalletProvider` from
 * `src/wallet/provider.tsx` and use the hooks from `src/wallet/hooks/`.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  createMockWallet,
  deriveGameKeys,
  type MockWalletProvider,
} from "./mock-wallet";
import type { ConnectedWallet, WalletStatus, DerivedGameKeys } from "./types";
import { walletDebug } from "../../wallet/debug";

interface WalletContextValue {
  /** Connected wallet info (null if not connected) */
  wallet: ConnectedWallet | null;
  /** Connection status */
  status: WalletStatus;
  /** Derive game keys for a specific game ID */
  deriveKeys: (gameId: string) => Promise<DerivedGameKeys>;
  /** Cache of derived keys by gameId */
  derivedKeys: Map<string, DerivedGameKeys>;
  /** The underlying wallet provider */
  provider: MockWalletProvider | null;
  /** Whether using mock wallet (for backward compat) */
  isMock: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

interface WalletContextProviderProps {
  /** Player name for mock wallet generation */
  playerName?: string;
  /** Force mock mode even if real wallet available */
  forceMock?: boolean;
  children: React.ReactNode;
}

/**
 * Legacy wallet context provider component.
 * Auto-connects a mock wallet on mount for demo purposes.
 *
 * @deprecated For new code, use WalletProvider from src/wallet/provider.tsx
 */
export const WalletContextProvider: React.FC<WalletContextProviderProps> = ({
  playerName,
  forceMock = false,
  children,
}) => {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [derivedKeys, setDerivedKeys] = useState<Map<string, DerivedGameKeys>>(
    new Map(),
  );

  const providerRef = useRef<MockWalletProvider | null>(null);

  // Generate a stable player name if not provided
  const stablePlayerName = useMemo(() => {
    return playerName || `Player_${Math.random().toString(36).slice(2, 8)}`;
  }, [playerName]);

  // Connect wallet on mount
  useEffect(() => {
    const provider = createMockWallet(stablePlayerName);
    providerRef.current = provider;

    setStatus("connecting");

    provider
      .connect()
      .then((connectedWallet) => {
        setWallet(connectedWallet);
        setStatus("connected");
        walletDebug(
          "[WalletContext] Connected (mock):",
          connectedWallet.address,
        );
      })
      .catch((err) => {
        console.error("[WalletContext] Connection failed:", err);
        setStatus("error");
      });

    return () => {
      provider.disconnect();
    };
  }, [stablePlayerName]);

  // Derive keys function with caching
  const deriveKeysForGame = async (
    gameId: string,
  ): Promise<DerivedGameKeys> => {
    // Check cache first
    const cached = derivedKeys.get(gameId);
    if (cached) {
      return cached;
    }

    if (!providerRef.current) {
      throw new Error("Wallet not connected");
    }

    const keys = await deriveGameKeys(providerRef.current, gameId);

    // Cache the derived keys
    setDerivedKeys((prev) => {
      const next = new Map(prev);
      next.set(gameId, keys);
      return next;
    });

    return keys;
  };

  const value: WalletContextValue = {
    wallet,
    status,
    deriveKeys: deriveKeysForGame,
    derivedKeys,
    provider: providerRef.current,
    isMock: true,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
};

/**
 * Hook to access legacy wallet context.
 *
 * @deprecated For new code, use useWallet from src/wallet/hooks/useWallet.ts
 */
export function useLegacyWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error(
      "useLegacyWallet must be used within a WalletContextProvider",
    );
  }
  return context;
}

// Keep old name for backward compatibility
export const useWallet = useLegacyWallet;

/**
 * Hook to get wallet-derived keys for a game.
 * Returns null while keys are being derived.
 *
 * @deprecated For new code, use useGameKeysForGame from src/wallet/hooks/useGameKeys.ts
 */
export function useLegacyGameKeys(
  gameId: string | null,
): DerivedGameKeys | null {
  const { deriveKeys, derivedKeys } = useLegacyWallet();
  const [keys, setKeys] = useState<DerivedGameKeys | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!gameId) {
      setKeys(null);
      return;
    }

    // Check cache first
    const cached = derivedKeys.get(gameId);
    if (cached) {
      setKeys(cached);
      return;
    }

    // Derive keys
    setIsLoading(true);
    deriveKeys(gameId)
      .then((derivedKeys) => {
        setKeys(derivedKeys);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("[useGameKeys] Failed to derive keys:", err);
        setIsLoading(false);
      });
  }, [gameId, deriveKeys, derivedKeys]);

  return keys;
}

// Keep old name for backward compatibility
export const useGameKeys = useLegacyGameKeys;
