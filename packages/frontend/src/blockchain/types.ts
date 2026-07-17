/**
 * Blockchain Service Types
 *
 * Types for blockchain interactions in poker games.
 * Mock mode is offline in-memory; live mode uses PokerHandSettler via
 * @manamesh/poker settlement client (injected viem-like ports).
 */

import type { Hex } from 'viem';
import type {
  BuiltSettlement,
  HandInit,
  HandOutcome,
  SettleableHandState,
  SettlementTableConfig,
  TxCallResult,
} from '@manamesh/poker';

/** Service backend: offline mock ledger vs on-chain settler. */
export type BlockchainMode = 'mock' | 'live';

/**
 * Player balance information from blockchain
 */
export interface PlayerBalance {
  playerId: string;
  /** On-chain wallet address */
  address: string;
  /** Current chip balance (in smallest unit) */
  balance: number;
  /** Whether the player has enough stake to play */
  canPlay: boolean;
}

/**
 * Result of a completed hand for settlement (game-layer / mock path)
 */
export interface HandResult {
  /** Unique identifier for this hand */
  handId: string;
  /** Player IDs who won the pot */
  winners: string[];
  /** Amount each player receives from the pot */
  payouts: Record<string, number>;
  /** Amount each player contributed to the pot */
  contributions: Record<string, number>;
  /** Total pot size */
  totalPot: number;
  /** Timestamp of hand completion */
  timestamp: number;
}

/**
 * Settlement transaction result
 */
export interface SettlementResult {
  /** Whether settlement succeeded */
  success: boolean;
  /** Transaction hash (when using real blockchain) */
  txHash?: string;
  /** Updated balances after settlement (playerId → chips) */
  newBalances: Record<string, number>;
  /** Error message if settlement failed */
  error?: string;
}

/**
 * Game session registered on blockchain
 */
export interface GameSession {
  /** Unique session identifier */
  sessionId: string;
  /** Player addresses participating */
  players: string[];
  /** Buy-in amount */
  buyIn: number;
  /** Small blind amount */
  smallBlind: number;
  /** Big blind amount */
  bigBlind: number;
  /** Session creation timestamp */
  createdAt: number;
  /** Whether session is active */
  isActive: boolean;
}

/** Params for on-chain assertHandMembership. */
export interface AssertHandMembershipParams {
  handInit: HandInit;
  signatures: readonly Hex[];
}

/** Params for on-chain settleHand (full settlement path). */
export interface SettleHandParams {
  handInit: HandInit;
  settlement: BuiltSettlement;
  winnerSignatures: readonly Hex[];
}

/** Params for building + settling from finished game state. */
export interface SettleFromStateParams {
  state: SettleableHandState;
  playerHandNonces: Record<string, bigint>;
  winnerSignatures: readonly Hex[];
  handId?: Hex;
}

/**
 * Blockchain service interface (mock + live dual path).
 */
export interface BlockchainService {
  /** Active backend mode. */
  readonly mode: BlockchainMode;

  /**
   * Get current balances for players
   */
  getBalances(playerIds: string[]): Promise<Record<string, number>>;

  /**
   * Register a new game session
   */
  registerSession(session: Omit<GameSession, 'sessionId' | 'createdAt' | 'isActive'>): Promise<GameSession>;

  /**
   * Settle a completed hand (mock path / simplified HandResult).
   * Live mode: prefer settleHand / settleFromState with full EIP-712 payloads.
   */
  settlePot(handResult: HandResult): Promise<SettlementResult>;

  /**
   * Assert hand membership on-chain (locks buy-ins).
   * Mock mode: records hand as asserted without RPC.
   */
  assertHandMembership(params: AssertHandMembershipParams): Promise<TxCallResult>;

  /**
   * Settle with pre-built HandInit + BuiltSettlement + winner sigs.
   * Mock mode: applies finalStacks to local ledger by playerId mapping.
   */
  settleHand(params: SettleHandParams): Promise<SettlementResult>;

  /**
   * Build settlement from game state and settle (live or mock).
   */
  settleFromState(params: SettleFromStateParams): Promise<SettlementResult>;

  /**
   * End a game session
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Get player's wallet address from their game ID
   */
  getPlayerAddress(playerId: string): string;

  /**
   * Optional: set/update playerID → address map (required for live).
   */
  setPlayerAddresses?(addresses: Record<string, Hex>): void;

  /**
   * Optional: table / settler config when live.
   */
  getTableConfig?(): SettlementTableConfig | undefined;
}

/**
 * Events emitted by blockchain service
 */
export type BlockchainEvent =
  | { type: 'balanceUpdate'; playerId: string; newBalance: number }
  | { type: 'settlementComplete'; handId: string; result: SettlementResult }
  | { type: 'sessionCreated'; session: GameSession }
  | { type: 'sessionEnded'; sessionId: string };

/**
 * Blockchain service event listener
 */
export type BlockchainEventListener = (event: BlockchainEvent) => void;

// Re-export poker types used at the service boundary
export type {
  HandInit,
  HandOutcome,
  BuiltSettlement,
  SettleableHandState,
  SettlementTableConfig,
  TxCallResult,
};
