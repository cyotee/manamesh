/**
 * Wallet Context
 *
 * React context for accessing wallet state throughout the app.
 * Provides mock wallet connection for demo purposes.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { createMockWallet, deriveGameKeys, type MockWalletProvider } from './mock-wallet';
import type { ConnectedWallet, WalletStatus, DerivedGameKeys } from './types';

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
}

const WalletContext = createContext<WalletContextValue | null>(null);

interface WalletContextProviderProps {
  /** Player name for mock wallet generation */
  playerName?: string;
  children: React.ReactNode;
}

/**
 * Wallet context provider component.
 * Auto-connects a mock wallet on mount for demo purposes.
 */
export const WalletContextProvider: React.FC<WalletContextProviderProps> = ({
  playerName,
  children,
}) => {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState<WalletStatus>('disconnected');
  const [derivedKeys, setDerivedKeys] = useState<Map<string, DerivedGameKeys>>(new Map());

  const providerRef = useRef<MockWalletProvider | null>(null);

  // Generate a stable player name if not provided
  const stablePlayerName = useMemo(() => {
    return playerName || `Player_${Math.random().toString(36).slice(2, 8)}`;
  }, [playerName]);

  // Connect wallet on mount
  useEffect(() => {
    const provider = createMockWallet(stablePlayerName);
    providerRef.current = provider;

    setStatus('connecting');

    provider.connect().then((connectedWallet) => {
      setWallet(connectedWallet);
      setStatus('connected');
      console.log('[WalletContext] Connected:', connectedWallet.address);
    }).catch((err) => {
      console.error('[WalletContext] Connection failed:', err);
      setStatus('error');
    });

    return () => {
      provider.disconnect();
    };
  }, [stablePlayerName]);

  // Derive keys function with caching
  const deriveKeysForGame = async (gameId: string): Promise<DerivedGameKeys> => {
    // Check cache first
    const cached = derivedKeys.get(gameId);
    if (cached) {
      return cached;
    }

    if (!providerRef.current) {
      throw new Error('Wallet not connected');
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
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};

/**
 * Hook to access wallet context.
 */
export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

/**
 * Hook to get wallet-derived keys for a game.
 * Returns null while keys are being derived.
 */
export function useGameKeys(gameId: string | null): DerivedGameKeys | null {
  const { deriveKeys, derivedKeys } = useWallet();
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
    deriveKeys(gameId).then((derivedKeys) => {
      setKeys(derivedKeys);
      setIsLoading(false);
    }).catch((err) => {
      console.error('[useGameKeys] Failed to derive keys:', err);
      setIsLoading(false);
    });
  }, [gameId, deriveKeys, derivedKeys]);

  return keys;
}
