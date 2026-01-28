/**
 * Blockchain Service Types
 *
 * Types for blockchain interactions in poker games.
 * These will be implemented with real smart contract calls later.
 */

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
 * Result of a completed hand for settlement
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
  /** Updated balances after settlement */
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

/**
 * Blockchain service interface
 */
export interface BlockchainService {
  /**
   * Get current balances for players
   */
  getBalances(playerIds: string[]): Promise<Record<string, number>>;

  /**
   * Register a new game session
   */
  registerSession(session: Omit<GameSession, 'sessionId' | 'createdAt' | 'isActive'>): Promise<GameSession>;

  /**
   * Settle a completed hand
   */
  settlePot(handResult: HandResult): Promise<SettlementResult>;

  /**
   * End a game session
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Get player's wallet address from their game ID
   */
  getPlayerAddress(playerId: string): string;
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
