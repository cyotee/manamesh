/**
 * useGameKeys Hook
 *
 * Derives deterministic cryptographic keys from wallet signatures.
 * Same wallet + gameId always produces the same keys (for mental poker fairness).
 */

import { useSignMessage, useAccount } from "wagmi";
import { useState, useCallback, useRef, useEffect } from "react";
import { keccak256, toHex, hexToBytes } from "viem";
import { walletDebug } from "../debug";

/**
 * Game keys derived from wallet signature
 */
export interface DerivedGameKeys {
  /** Private key for SRA encryption (hex, without 0x prefix) */
  privateKey: string;
  /** Public key for SRA encryption (hex, without 0x prefix) */
  publicKey: string;
  /** Game ID these keys are derived for */
  gameId: string;
  /** Wallet address that signed */
  walletAddress: string;
}

/**
 * Key derivation message format (as specified in TASK.md)
 */
const KEY_DERIVATION_MESSAGE_TEMPLATE = `ManaMesh Game Key
Game ID: {gameId}
Version: 1`;

/**
 * Create the signing message for a game ID
 */
function createKeyDerivationMessage(gameId: string): string {
  return KEY_DERIVATION_MESSAGE_TEMPLATE.replace("{gameId}", gameId);
}

/**
 * Derive seed bytes from a signature using keccak256
 */
function deriveSeedFromSignature(signature: `0x${string}`): Uint8Array {
  // Hash the signature to get a 32-byte seed
  const hash = keccak256(signature);
  return hexToBytes(hash);
}

/**
 * useGameKeys hook return type
 */
export interface UseGameKeysReturn {
  /** Derived keys (null if not yet derived) */
  keys: DerivedGameKeys | null;
  /** Whether keys are being derived */
  isDerivingKeys: boolean;
  /** Derive keys for a game ID */
  deriveKeys: (gameId: string) => Promise<DerivedGameKeys>;
  /** Clear cached keys */
  clearKeys: () => void;
  /** Error from key derivation */
  error: Error | null;
}

/**
 * Hook to derive game keys from wallet signature.
 *
 * Key derivation flow:
 * 1. User signs a message containing the game ID
 * 2. Signature is hashed with keccak256 to get a 32-byte seed
 * 3. Seed is used to generate a secp256k1 key pair (for SRA encryption)
 *
 * The same wallet + gameId always produces the same keys (deterministic).
 *
 * Usage:
 * ```tsx
 * const { keys, isDerivingKeys, deriveKeys } = useGameKeys();
 *
 * // When joining a game:
 * const gameKeys = await deriveKeys('game-123');
 * console.log(gameKeys.publicKey); // Share with other players
 * ```
 */
export function useGameKeys(): UseGameKeysReturn {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [keys, setKeys] = useState<DerivedGameKeys | null>(null);
  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Cache for derived keys (keyed by gameId)
  const keysCache = useRef<Map<string, DerivedGameKeys>>(new Map());

  // Clear cache when wallet changes
  useEffect(() => {
    keysCache.current.clear();
    setKeys(null);
  }, [address]);

  /**
   * Derive keys for a game ID
   */
  const deriveKeys = useCallback(
    async (gameId: string): Promise<DerivedGameKeys> => {
      if (!isConnected || !address) {
        throw new Error("Wallet not connected");
      }

      // Check cache first
      const cached = keysCache.current.get(gameId);
      if (cached && cached.walletAddress === address) {
        setKeys(cached);
        return cached;
      }

      setIsDerivingKeys(true);
      setError(null);

      try {
        // Create the signing message
        const message = createKeyDerivationMessage(gameId);

        // Sign the message
        const signature = await signMessageAsync({ message });

        // Derive seed from signature
        const seed = deriveSeedFromSignature(signature);

        // Import SRA key generation (uses elliptic secp256k1)
        const { generateKeyPair } =
          await import("../../crypto/mental-poker/sra");

        // Generate deterministic key pair from seed
        const keyPair = generateKeyPair(seed);

        const derivedKeys: DerivedGameKeys = {
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
          gameId,
          walletAddress: address,
        };

        // Cache the keys
        keysCache.current.set(gameId, derivedKeys);
        setKeys(derivedKeys);

        walletDebug(
          `[useGameKeys] Derived keys for game ${gameId} from ${address}`,
        );

        return derivedKeys;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsDerivingKeys(false);
      }
    },
    [address, isConnected, signMessageAsync],
  );

  /**
   * Clear cached keys
   */
  const clearKeys = useCallback(() => {
    keysCache.current.clear();
    setKeys(null);
  }, []);

  return {
    keys,
    isDerivingKeys,
    deriveKeys,
    clearKeys,
    error,
  };
}

/**
 * Hook to derive keys for a specific game ID (auto-derives on mount)
 *
 * Usage:
 * ```tsx
 * const { keys, isLoading } = useGameKeysForGame('game-123');
 *
 * if (isLoading) return <div>Deriving keys...</div>;
 * if (!keys) return <div>Please sign to derive keys</div>;
 * return <div>Your public key: {keys.publicKey}</div>;
 * ```
 */
export function useGameKeysForGame(gameId: string | null): {
  keys: DerivedGameKeys | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { deriveKeys } = useGameKeys();
  const { isConnected } = useAccount();

  const [keys, setKeys] = useState<DerivedGameKeys | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track if derivation has been attempted for current gameId
  const derivedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gameId || !isConnected) {
      setKeys(null);
      return;
    }

    // Only derive once per gameId
    if (derivedForRef.current === gameId) {
      return;
    }

    derivedForRef.current = gameId;
    setIsLoading(true);
    setError(null);

    deriveKeys(gameId)
      .then((derivedKeys) => {
        setKeys(derivedKeys);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
        // Reset so user can try again
        derivedForRef.current = null;
      });
  }, [gameId, isConnected, deriveKeys]);

  return { keys, isLoading, error };
}
