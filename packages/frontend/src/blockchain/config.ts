/**
 * Poker settlement frontend config (live mode).
 *
 * Env (Vite):
 * - VITE_POKER_SETTLEMENT_MODE=mock|live
 * - VITE_POKER_SETTLER_ADDRESS
 * - VITE_POKER_CHAIN_ID
 * - VITE_POKER_TOKEN_SCALE (optional, default 1)
 * - VITE_POKER_RAKE_BPS (optional, default 0)
 * - VITE_POKER_SMALL_BLIND / VITE_POKER_BIG_BLIND / VITE_POKER_TIMEOUT_SECONDS
 *
 * Residual: contracts must be deployed and oracle configured before live mode works.
 */

import type { Hex } from 'viem';
import type { BlockchainMode } from './types';
import type { SettlementTableConfig } from '@manamesh/poker';

function env(key: string): string | undefined {
  try {
    // Vite injects import.meta.env
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return meta.env?.[key];
  } catch {
    return undefined;
  }
}

export function getSettlementMode(): BlockchainMode {
  const m = (env('VITE_POKER_SETTLEMENT_MODE') ?? 'mock').toLowerCase();
  return m === 'live' ? 'live' : 'mock';
}

/**
 * Build SettlementTableConfig from env. Returns null when live config incomplete.
 */
export function getSettlementTableConfigFromEnv(): SettlementTableConfig | null {
  const settler = env('VITE_POKER_SETTLER_ADDRESS');
  const chainIdRaw = env('VITE_POKER_CHAIN_ID');
  if (!settler || !chainIdRaw) return null;

  const chainId = Number(chainIdRaw);
  if (!Number.isFinite(chainId)) return null;

  const scaleRaw = env('VITE_POKER_TOKEN_SCALE');
  const scale = scaleRaw ? BigInt(scaleRaw) : 1n;
  const rakeBps = Number(env('VITE_POKER_RAKE_BPS') ?? '0');
  const smallBlind = BigInt(env('VITE_POKER_SMALL_BLIND') ?? '1');
  const bigBlind = BigInt(env('VITE_POKER_BIG_BLIND') ?? '2');
  const timeoutSeconds = BigInt(env('VITE_POKER_TIMEOUT_SECONDS') ?? '300');

  const address = settler as Hex;
  return {
    chainId,
    settlerAddress: address,
    vault: address,
    smallBlind,
    bigBlind,
    timeoutSeconds,
    scale,
    rakeBps,
  };
}
