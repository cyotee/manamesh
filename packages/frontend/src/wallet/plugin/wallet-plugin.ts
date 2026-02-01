/**
 * Wallet Plugin for boardgame.io
 *
 * Manages wallet state (addresses, public keys, signatures) within game state.
 * Integrates with EIP-712 signing for verifiable game actions.
 */

import type { Ctx } from "boardgame.io";
import type { SignedAction } from "../signing/sign";
import {
  hashTypedAction,
  verifySignedAction,
  type VerificationResult,
} from "../signing/verify";
import { walletDebug } from "../debug";

// =============================================================================
// Types
// =============================================================================

/**
 * Wallet plugin state stored in game state.
 */
export interface WalletPluginState {
  /** Player wallet addresses (playerId -> address) */
  playerAddresses: Record<string, string>;

  /** Player public keys for encryption (playerId -> publicKey hex) */
  playerPublicKeys: Record<string, string>;

  /** Signed game actions */
  actionSignatures: SerializedSignedAction[];

  /** Verification cache (signature hash -> result) */
  verificationCache: Record<string, boolean>;
}

/**
 * Serialized signed action for storage in game state.
 */
export interface SerializedSignedAction {
  actionType: string;
  data: string; // JSON stringified
  signature: string;
  signer: string;
  signedAt: number;
  verified: boolean;
}

/**
 * Game state with wallet plugin data.
 */
export interface WalletPluginGameState {
  /** Wallet plugin state */
  wallet: WalletPluginState;
}

/**
 * Wallet plugin API available in moves.
 */
export interface WalletPluginApi {
  /**
   * Register a player's wallet address and public key.
   * Called when a player joins with their wallet connected.
   */
  registerPlayer: (
    playerId: string,
    address: string,
    publicKey: string,
  ) => void;

  /**
   * Get a player's wallet address.
   */
  getPlayerAddress: (playerId: string) => string | null;

  /**
   * Get a player's public key.
   */
  getPlayerPublicKey: (playerId: string) => string | null;

  /**
   * Get all registered player addresses.
   */
  getAllPlayerAddresses: () => Record<string, string>;

  /**
   * Get player ID by wallet address.
   */
  getPlayerByAddress: (address: string) => string | null;

  /**
   * Add a signed action to the game log.
   * The action is verified before being added.
   */
  addSignedAction: (signedAction: SignedAction) => Promise<boolean>;

  /**
   * Get all signed actions for a player.
   */
  getSignedActionsForPlayer: (playerId: string) => SerializedSignedAction[];

  /**
   * Get all signed actions of a specific type.
   */
  getSignedActionsByType: (actionType: string) => SerializedSignedAction[];

  /**
   * Verify a signed action against a player.
   */
  verifyPlayerAction: (
    playerId: string,
    signedAction: SignedAction,
  ) => Promise<boolean>;

  /**
   * Check if all players have registered.
   */
  allPlayersRegistered: (playerIds: string[]) => boolean;

  /**
   * Get the count of registered players.
   */
  getRegisteredPlayerCount: () => number;

  /**
   * Clear all wallet state (for game reset).
   */
  reset: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create initial wallet plugin state.
 */
function createInitialWalletState(): WalletPluginState {
  return {
    playerAddresses: {},
    playerPublicKeys: {},
    actionSignatures: [],
    verificationCache: {},
  };
}

/**
 * Serialize a signed action for storage.
 */
function serializeSignedAction(
  action: SignedAction,
  verified: boolean,
): SerializedSignedAction {
  return {
    actionType: action.actionType,
    data: JSON.stringify(action.data, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    signature: action.signature,
    signer: action.signer,
    signedAt: action.signedAt,
    verified,
  };
}

/**
 * Compute a simple hash for caching verification results.
 */
function computeSignatureHash(signature: string, data: string): string {
  // Simple hash for caching - not cryptographically secure
  let hash = 0;
  const combined = signature + data;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

/**
 * Stable cache key for a signed action.
 *
 * IMPORTANT: Avoid JSON.stringify(data) because EIP-712 payloads use bigint.
 */
function getVerificationCacheKey(signedAction: SignedAction): string {
  const typedHash = hashTypedAction(signedAction.actionType, signedAction.data);
  return computeSignatureHash(signedAction.signature, typedHash);
}

// =============================================================================
// Plugin Implementation
// =============================================================================

/**
 * The Wallet Plugin for boardgame.io.
 *
 * Usage:
 * ```typescript
 * const game = {
 *   name: 'my-game',
 *   plugins: [WalletPlugin],
 *   setup: () => ({
 *     // ... game state
 *   }),
 *   moves: {
 *     joinGame: ({ G, playerID, ...plugins }) => {
 *       // Access wallet via plugins.wallet
 *       plugins.wallet.registerPlayer(playerID, address, publicKey);
 *     },
 *   },
 * };
 * ```
 */
export const WalletPlugin = {
  name: "wallet",

  /**
   * Initialize plugin state.
   */
  setup: (): WalletPluginState => createInitialWalletState(),

  /**
   * Plugin API factory.
   */
  api: ({
    G,
    ctx,
  }: {
    G: WalletPluginGameState;
    ctx: Ctx;
    data: WalletPluginState;
  }): WalletPluginApi => {
    // Ensure wallet state exists
    if (!G.wallet) {
      G.wallet = createInitialWalletState();
    }

    return {
      registerPlayer: (
        playerId: string,
        address: string,
        publicKey: string,
      ): void => {
        // Normalize address to lowercase for consistent comparison
        G.wallet.playerAddresses[playerId] = address.toLowerCase();
        G.wallet.playerPublicKeys[playerId] = publicKey;

        walletDebug(
          `[WalletPlugin] Registered player ${playerId}: ${address.slice(0, 10)}...`,
        );
      },

      getPlayerAddress: (playerId: string): string | null => {
        return G.wallet.playerAddresses[playerId] ?? null;
      },

      getPlayerPublicKey: (playerId: string): string | null => {
        return G.wallet.playerPublicKeys[playerId] ?? null;
      },

      getAllPlayerAddresses: (): Record<string, string> => {
        return { ...G.wallet.playerAddresses };
      },

      getPlayerByAddress: (address: string): string | null => {
        const normalizedAddress = address.toLowerCase();
        for (const [playerId, addr] of Object.entries(
          G.wallet.playerAddresses,
        )) {
          if (addr.toLowerCase() === normalizedAddress) {
            return playerId;
          }
        }
        return null;
      },

      addSignedAction: async (signedAction: SignedAction): Promise<boolean> => {
        // Verify the signature
        const result = await verifySignedAction(signedAction);

        if (!result.isValid) {
          console.warn(
            `[WalletPlugin] Invalid signature for action ${signedAction.actionType}:`,
            result.error,
          );
          return false;
        }

        // Check if signer is a registered player
        const playerId = Object.entries(G.wallet.playerAddresses).find(
          ([_, addr]) =>
            addr.toLowerCase() === signedAction.signer.toLowerCase(),
        )?.[0];

        if (!playerId) {
          console.warn(
            `[WalletPlugin] Signer ${signedAction.signer} is not a registered player`,
          );
          return false;
        }

        // Serialize and store
        const serialized = serializeSignedAction(signedAction, true);
        G.wallet.actionSignatures.push(serialized);

        // Cache verification result
        const cacheKey = getVerificationCacheKey(signedAction);
        G.wallet.verificationCache[cacheKey] = true;

        walletDebug(
          `[WalletPlugin] Added signed ${signedAction.actionType} from ${playerId}`,
        );

        return true;
      },

      getSignedActionsForPlayer: (
        playerId: string,
      ): SerializedSignedAction[] => {
        const playerAddress = G.wallet.playerAddresses[playerId];
        if (!playerAddress) return [];

        return G.wallet.actionSignatures.filter(
          (action) =>
            action.signer.toLowerCase() === playerAddress.toLowerCase(),
        );
      },

      getSignedActionsByType: (
        actionType: string,
      ): SerializedSignedAction[] => {
        return G.wallet.actionSignatures.filter(
          (action) => action.actionType === actionType,
        );
      },

      verifyPlayerAction: async (
        playerId: string,
        signedAction: SignedAction,
      ): Promise<boolean> => {
        const playerAddress = G.wallet.playerAddresses[playerId];
        if (!playerAddress) {
          console.warn(`[WalletPlugin] Player ${playerId} not registered`);
          return false;
        }

        // Check signer matches player
        if (signedAction.signer.toLowerCase() !== playerAddress.toLowerCase()) {
          console.warn(
            `[WalletPlugin] Signer mismatch: expected ${playerAddress}, got ${signedAction.signer}`,
          );
          return false;
        }

        // Check cache first
        const cacheKey = getVerificationCacheKey(signedAction);
        if (cacheKey in G.wallet.verificationCache) {
          return G.wallet.verificationCache[cacheKey];
        }

        // Verify signature
        const result = await verifySignedAction(signedAction);

        // Cache result
        G.wallet.verificationCache[cacheKey] = result.isValid;

        return result.isValid;
      },

      allPlayersRegistered: (playerIds: string[]): boolean => {
        return playerIds.every(
          (id) =>
            id in G.wallet.playerAddresses && id in G.wallet.playerPublicKeys,
        );
      },

      getRegisteredPlayerCount: (): number => {
        return Object.keys(G.wallet.playerAddresses).length;
      },

      reset: (): void => {
        G.wallet = createInitialWalletState();
        walletDebug("[WalletPlugin] State reset");
      },
    };
  },
};

// =============================================================================
// Integration Helpers
// =============================================================================

/**
 * Type helper to add wallet state to existing game state.
 */
export type WithWalletState<T> = T & WalletPluginGameState;

/**
 * Check if a game state has wallet plugin data.
 */
export function hasWalletState<T>(
  state: T,
): state is T & WalletPluginGameState {
  return (
    typeof state === "object" &&
    state !== null &&
    "wallet" in state &&
    typeof (state as WalletPluginGameState).wallet === "object"
  );
}

/**
 * Initialize wallet state in an existing game state.
 */
export function initWalletState<T extends object>(
  state: T,
): T & WalletPluginGameState {
  return {
    ...state,
    wallet: createInitialWalletState(),
  };
}
