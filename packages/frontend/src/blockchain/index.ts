/**
 * Blockchain Service Module
 *
 * Mock (offline) + live (PokerHandSettler via injected viem ports).
 * Core settlement builders live in @manamesh/poker settlementClient.
 */

export * from './types';
export * from './mock-service';
export * from './live-service';
export * from './config';
export * from './wallet';

import type { Hex } from 'viem';
import type { BlockchainMode, BlockchainService } from './types';
import { MockBlockchainService, setBlockchainService } from './mock-service';
import { LiveBlockchainService, type LiveBlockchainServiceOptions } from './live-service';
import { getSettlementMode, getSettlementTableConfigFromEnv } from './config';

export interface CreateBlockchainServiceOptions {
  mode?: BlockchainMode;
  initialBalances?: Record<string, number>;
  /** Required when mode is live (write/read/table/addresses). */
  live?: LiveBlockchainServiceOptions;
  /** Optional addresses for mock settleFromState. */
  playerAddresses?: Record<string, Hex>;
}

/**
 * Factory: mock vs live. Does not install global singleton unless
 * callers use installBlockchainService.
 */
export function createBlockchainService(
  options: CreateBlockchainServiceOptions = {},
): BlockchainService {
  const mode = options.mode ?? getSettlementMode();

  if (mode === 'live') {
    if (!options.live) {
      throw new Error(
        'Live BlockchainService requires options.live { write, read, table, playerAddresses }. ' +
          'Inject viem wallet/public clients (or test mocks).',
      );
    }
    return new LiveBlockchainService(options.live);
  }

  return new MockBlockchainService(options.initialBalances, {
    playerAddresses: options.playerAddresses,
    tableConfig: getSettlementTableConfigFromEnv() ?? undefined,
  });
}

/**
 * Create and install as global service (used by App entry when switching modes).
 */
export function installBlockchainService(
  options: CreateBlockchainServiceOptions = {},
): BlockchainService {
  const service = createBlockchainService(options);
  setBlockchainService(service);
  return service;
}
