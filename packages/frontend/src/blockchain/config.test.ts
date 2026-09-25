import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEOUT_SECONDS } from '@manamesh/poker/settlement';
import { getSettlementTableConfigFromEnv } from './config';

beforeEach(() => {
  vi.stubEnv('VITE_POKER_SETTLER_ADDRESS', '0x1111111111111111111111111111111111111111');
  vi.stubEnv('VITE_POKER_CHAIN_ID', '31337');
  vi.stubEnv('VITE_POKER_TIMEOUT_SECONDS', undefined);
});
afterEach(() => vi.unstubAllEnvs());

it('uses the shared contract-compatible timeout default', () => {
  expect(getSettlementTableConfigFromEnv()?.timeoutSeconds).toBe(DEFAULT_TIMEOUT_SECONDS);
});
it.each(['300', '86401'])('rejects timeout %s outside the supported range', value => {
  vi.stubEnv('VITE_POKER_TIMEOUT_SECONDS', value);
  expect(() => getSettlementTableConfigFromEnv()).toThrow('out of bounds');
});
it('accepts an explicit supported timeout', () => {
  vi.stubEnv('VITE_POKER_TIMEOUT_SECONDS', '900');
  expect(getSettlementTableConfigFromEnv()?.timeoutSeconds).toBe(900n);
});
