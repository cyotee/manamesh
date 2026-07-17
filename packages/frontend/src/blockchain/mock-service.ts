/**
 * Mock Blockchain Service
 *
 * Simulates blockchain interactions for development and testing.
 * Offline path — no RPC. Live path: see live-service.ts + @manamesh/poker settlementClient.
 */

import type { Hex } from 'viem';
import { getAddress } from 'viem';
import {
  prepareSettlementPayload,
  deriveHandId,
  type SettlementTableConfig,
} from '@manamesh/poker';
import type {
  BlockchainService,
  BlockchainEvent,
  BlockchainEventListener,
  BlockchainMode,
  GameSession,
  HandResult,
  SettlementResult,
  AssertHandMembershipParams,
  SettleHandParams,
  SettleFromStateParams,
} from './types';
import type { TxCallResult } from './types';

/**
 * Default starting balance for new players
 */
const DEFAULT_STARTING_BALANCE = 1000;

/**
 * Simulated network delay (ms)
 */
const SIMULATED_DELAY = 100;

/**
 * Mock blockchain service implementation
 */
export class MockBlockchainService implements BlockchainService {
  readonly mode: BlockchainMode = 'mock';

  private balances: Map<string, number> = new Map();
  private sessions: Map<string, GameSession> = new Map();
  private listeners: Set<BlockchainEventListener> = new Set();
  private handCounter = 0;
  private sessionCounter = 0;
  private playerAddresses: Record<string, Hex> = {};
  private assertedHands = new Set<string>();
  private tableConfig?: SettlementTableConfig;

  constructor(
    initialBalances?: Record<string, number>,
    opts?: {
      playerAddresses?: Record<string, Hex>;
      tableConfig?: SettlementTableConfig;
    },
  ) {
    if (initialBalances) {
      for (const [playerId, balance] of Object.entries(initialBalances)) {
        this.balances.set(playerId, balance);
      }
    }
    if (opts?.playerAddresses) {
      this.playerAddresses = { ...opts.playerAddresses };
    }
    this.tableConfig = opts?.tableConfig;
  }

  /**
   * Simulate network delay
   */
  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY));
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: BlockchainEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[MockBlockchain] Event listener error:', error);
      }
    }
  }

  /**
   * Generate a mock transaction hash
   */
  private generateTxHash(): string {
    return `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;
  }

  setPlayerAddresses(addresses: Record<string, Hex>): void {
    this.playerAddresses = { ...addresses };
  }

  getTableConfig(): SettlementTableConfig | undefined {
    return this.tableConfig;
  }

  /**
   * Get current balances for players
   */
  async getBalances(playerIds: string[]): Promise<Record<string, number>> {
    await this.delay();

    const result: Record<string, number> = {};
    for (const playerId of playerIds) {
      // Initialize with default balance if not exists
      if (!this.balances.has(playerId)) {
        this.balances.set(playerId, DEFAULT_STARTING_BALANCE);
        console.log(`[MockBlockchain] Initialized balance for ${playerId}: ${DEFAULT_STARTING_BALANCE}`);
      }
      result[playerId] = this.balances.get(playerId)!;
    }

    console.log('[MockBlockchain] getBalances:', result);
    return result;
  }

  /**
   * Register a new game session
   */
  async registerSession(
    session: Omit<GameSession, 'sessionId' | 'createdAt' | 'isActive'>
  ): Promise<GameSession> {
    await this.delay();

    const sessionId = `session-${++this.sessionCounter}`;
    const fullSession: GameSession = {
      ...session,
      sessionId,
      createdAt: Date.now(),
      isActive: true,
    };

    this.sessions.set(sessionId, fullSession);
    console.log('[MockBlockchain] Session registered:', fullSession);

    this.emit({ type: 'sessionCreated', session: fullSession });
    return fullSession;
  }

  /**
   * Settle a completed hand (legacy HandResult path)
   */
  async settlePot(handResult: HandResult): Promise<SettlementResult> {
    await this.delay();

    console.log('[MockBlockchain] Settling pot:', handResult);

    // Validate contributions match total pot
    const totalContributions = Object.values(handResult.contributions).reduce((a, b) => a + b, 0);
    if (totalContributions !== handResult.totalPot) {
      return {
        success: false,
        newBalances: {},
        error: `Contribution mismatch: ${totalContributions} !== ${handResult.totalPot}`,
      };
    }

    // Validate payouts match total pot
    const totalPayouts = Object.values(handResult.payouts).reduce((a, b) => a + b, 0);
    if (totalPayouts !== handResult.totalPot) {
      return {
        success: false,
        newBalances: {},
        error: `Payout mismatch: ${totalPayouts} !== ${handResult.totalPot}`,
      };
    }

    // Apply contributions (subtract from balances)
    for (const [playerId, contribution] of Object.entries(handResult.contributions)) {
      const currentBalance = this.balances.get(playerId) || 0;
      this.balances.set(playerId, currentBalance - contribution);
    }

    // Apply payouts (add to balances)
    for (const [playerId, payout] of Object.entries(handResult.payouts)) {
      const currentBalance = this.balances.get(playerId) || 0;
      this.balances.set(playerId, currentBalance + payout);
    }

    // Collect new balances
    const newBalances: Record<string, number> = {};
    for (const playerId of Object.keys(handResult.contributions)) {
      newBalances[playerId] = this.balances.get(playerId) || 0;

      // Emit balance update event
      this.emit({
        type: 'balanceUpdate',
        playerId,
        newBalance: newBalances[playerId],
      });
    }

    const result: SettlementResult = {
      success: true,
      txHash: this.generateTxHash(),
      newBalances,
    };

    console.log('[MockBlockchain] Settlement complete:', result);
    this.emit({ type: 'settlementComplete', handId: handResult.handId, result });

    return result;
  }

  async assertHandMembership(params: AssertHandMembershipParams): Promise<TxCallResult> {
    await this.delay();
    const handId = deriveHandId(params.handInit);
    if (this.assertedHands.has(handId)) {
      return { success: false, error: `Hand already asserted: ${handId}` };
    }
    if (params.signatures.length !== params.handInit.players.length) {
      return {
        success: false,
        error: `signatures length ${params.signatures.length} != players ${params.handInit.players.length}`,
      };
    }
    this.assertedHands.add(handId);
    return { success: true, txHash: this.generateTxHash() as Hex };
  }

  async settleHand(params: SettleHandParams): Promise<SettlementResult> {
    await this.delay();
    const { handInit, settlement } = params;
    const handId = deriveHandId(handInit);

    // Map address-sorted finalStacks back to playerIds when addresses are known
    const newBalances: Record<string, number> = {};
    const scale = this.tableConfig?.scale ?? 1n;

    if (Object.keys(this.playerAddresses).length > 0) {
      const addrToId = new Map<string, string>();
      for (const [id, addr] of Object.entries(this.playerAddresses)) {
        addrToId.set(getAddress(addr).toLowerCase(), id);
      }
      handInit.players.forEach((addr, i) => {
        const id = addrToId.get(getAddress(addr).toLowerCase());
        if (id) {
          const stack = Number(settlement.outcome.finalStacks[i] / scale);
          // Set absolute post-hand stack as balance for offline continuity
          this.balances.set(id, stack);
          newBalances[id] = stack;
        }
      });
    }

    this.assertedHands.delete(handId);

    const result: SettlementResult = {
      success: true,
      txHash: this.generateTxHash(),
      newBalances,
    };
    this.emit({ type: 'settlementComplete', handId, result });
    return result;
  }

  async settleFromState(params: SettleFromStateParams): Promise<SettlementResult> {
    if (!this.tableConfig) {
      return {
        success: false,
        newBalances: {},
        error:
          'Mock settleFromState requires tableConfig (settler domain params). Use settlePot for simple offline play.',
      };
    }
    try {
      const prepared = prepareSettlementPayload({
        state: params.state,
        addresses: this.playerAddresses,
        table: this.tableConfig,
        playerHandNonces: params.playerHandNonces,
        handId: params.handId,
      });
      return this.settleHand({
        handInit: prepared.handInit,
        settlement: prepared.settlement,
        winnerSignatures: params.winnerSignatures,
      });
    } catch (e) {
      return {
        success: false,
        newBalances: {},
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * End a game session
   */
  async endSession(sessionId: string): Promise<void> {
    await this.delay();

    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      console.log('[MockBlockchain] Session ended:', sessionId);
      this.emit({ type: 'sessionEnded', sessionId });
    }
  }

  /**
   * Get player's wallet address from their game ID
   * (Mock returns configured map or a deterministic fake address)
   */
  getPlayerAddress(playerId: string): string {
    if (this.playerAddresses[playerId]) {
      return getAddress(this.playerAddresses[playerId]);
    }
    // Generate a deterministic mock address from player ID
    const hash = Array.from(playerId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return `0x${hash.toString(16).padStart(40, '0')}`;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: BlockchainEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Set balance directly (for testing)
   */
  setBalance(playerId: string, balance: number): void {
    this.balances.set(playerId, balance);
    this.emit({ type: 'balanceUpdate', playerId, newBalance: balance });
  }

  /**
   * Get current balance (synchronous, for testing)
   */
  getBalance(playerId: string): number {
    return this.balances.get(playerId) || DEFAULT_STARTING_BALANCE;
  }

  /**
   * Generate a unique hand ID
   */
  generateHandId(): string {
    return `hand-${++this.handCounter}-${Date.now()}`;
  }
}

/**
 * Singleton instance for the app
 */
let globalInstance: BlockchainService | null = null;
let globalMode: BlockchainMode = 'mock';

/**
 * Get or create the global blockchain service instance (mock by default).
 * For live mode use `createBlockchainService({ mode: 'live', ... })` then
 * `setBlockchainService`, or pass mode via `getBlockchainService` options.
 */
export function getBlockchainService(initialBalances?: Record<string, number>): BlockchainService {
  if (!globalInstance) {
    globalInstance = new MockBlockchainService(initialBalances);
    globalMode = 'mock';
  }
  return globalInstance;
}

/**
 * Install a service instance as the global (used for live mode switch).
 */
export function setBlockchainService(service: BlockchainService): void {
  globalInstance = service;
  globalMode = service.mode;
}

/**
 * Reset the global instance (for testing)
 */
export function resetBlockchainService(): void {
  globalInstance = null;
  globalMode = 'mock';
}

export function getBlockchainServiceMode(): BlockchainMode {
  return globalInstance?.mode ?? globalMode;
}
