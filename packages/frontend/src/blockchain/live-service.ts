/**
 * Live Blockchain Service
 *
 * Thin frontend adapter over `@manamesh/poker` LiveSettlementClient.
 * Accepts injected viem-like write/read ports (or real wallet/public clients).
 * Does not optimistically mutate balances on RPC/user reject.
 *
 * Residual for real deploy: wire App.tsx / PokerLobby with wallet addresses,
 * env settler config, and winner EIP-712 signatures from connected wallets.
 */

import type { Hex } from 'viem';
import {
  LiveSettlementClient,
  type LiveSettlementClientOptions,
  type SettlementTableConfig,
  type SettlementWriteClient,
  type SettlementReadClient,
} from '@manamesh/poker';
import type {
  BlockchainService,
  BlockchainMode,
  GameSession,
  HandResult,
  SettlementResult,
  AssertHandMembershipParams,
  SettleHandParams,
  SettleFromStateParams,
} from './types';
import type { TxCallResult } from './types';

export interface LiveBlockchainServiceOptions {
  write: SettlementWriteClient;
  read: SettlementReadClient;
  table: SettlementTableConfig;
  playerAddresses: Record<string, Hex>;
  account?: Hex;
}

/**
 * On-chain BlockchainService backed by PokerHandSettler.
 */
export class LiveBlockchainService implements BlockchainService {
  readonly mode: BlockchainMode = 'live';

  private readonly client: LiveSettlementClient;
  private sessions: Map<string, GameSession> = new Map();
  private sessionCounter = 0;

  constructor(opts: LiveBlockchainServiceOptions) {
    this.client = new LiveSettlementClient({
      write: opts.write,
      read: opts.read,
      table: opts.table,
      playerAddresses: opts.playerAddresses,
      account: opts.account,
    });
  }

  /** Escape hatch for advanced callers / tests. */
  getSettlementClient(): LiveSettlementClient {
    return this.client;
  }

  getTableConfig(): SettlementTableConfig {
    return this.client.getTableConfig();
  }

  setPlayerAddresses(addresses: Record<string, Hex>): void {
    this.client.setPlayerAddresses(addresses);
  }

  getPlayerAddress(playerId: string): string {
    return this.client.getPlayerAddress(playerId);
  }

  async getBalances(playerIds: string[]): Promise<Record<string, number>> {
    return this.client.getBalancesByPlayerIds(playerIds);
  }

  async registerSession(
    session: Omit<GameSession, 'sessionId' | 'createdAt' | 'isActive'>,
  ): Promise<GameSession> {
    const sessionId = `live-session-${++this.sessionCounter}`;
    const full: GameSession = {
      ...session,
      sessionId,
      createdAt: Date.now(),
      isActive: true,
    };
    this.sessions.set(sessionId, full);
    return full;
  }

  /**
   * Simplified HandResult path is not sufficient for live settlement
   * (needs HandInit, addresses, winner signatures). Callers must use
   * settleHand / settleFromState.
   */
  async settlePot(_handResult: HandResult): Promise<SettlementResult> {
    return {
      success: false,
      newBalances: {},
      error:
        'Live mode does not support settlePot(HandResult). Use settleFromState or settleHand with EIP-712 winner signatures and player address map.',
    };
  }

  async assertHandMembership(params: AssertHandMembershipParams): Promise<TxCallResult> {
    return this.client.assertHandMembership(params.handInit, params.signatures);
  }

  async settleHand(params: SettleHandParams): Promise<SettlementResult> {
    const result = await this.client.settleHand(
      params.handInit,
      params.settlement,
      params.winnerSignatures,
    );
    return {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
      newBalances: result.success
        ? (this.client.getConfirmedBalances() ?? {})
        : {},
    };
  }

  async settleFromState(params: SettleFromStateParams): Promise<SettlementResult> {
    const result = await this.client.settleFromState(params);
    return {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
      newBalances: result.success
        ? (this.client.getConfirmedBalances() ?? {})
        : {},
    };
  }

  async endSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) s.isActive = false;
  }
}

export type { LiveSettlementClientOptions, SettlementWriteClient, SettlementReadClient };
