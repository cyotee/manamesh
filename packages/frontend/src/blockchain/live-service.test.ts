import { expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { LiveBlockchainService } from './live-service';
import type { SettleFromStateParams } from './types';

const address = (digit: string) => `0x${digit.repeat(40)}` as Hex;
type Card = SettleFromStateParams['state']['community'][number];
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ id: `${suit}-${rank}`, name: `${rank} of ${suit}`, rank, suit });
const state: SettleFromStateParams['state'] = {
  players: {
    '0': { chips: 200, folded: false, hand: [card('A', 'hearts'), card('K', 'hearts')] },
    '1': { chips: 0, folded: true, hand: [card('2', 'clubs'), card('3', 'diamonds')] },
  },
  startingChips: { '0': 100, '1': 100 }, winners: ['0'],
  community: [card('Q', 'hearts'), card('J', 'hearts'), card('10', 'hearts'), card('2', 'spades'), card('3', 'spades')],
};
function fixture() {
  const writeContract = vi.fn().mockResolvedValue('0xab');
  const service = new LiveBlockchainService({
    write: { writeContract }, read: { readContract: vi.fn().mockResolvedValue(200n) },
    table: { chainId: 31337, settlerAddress: address('3'), vault: address('3'), smallBlind: 1n,
      bigBlind: 2n, timeoutSeconds: 3600n, scale: 1n, rakeBps: 0 },
    playerAddresses: { '0': address('1'), '1': address('2') },
  });
  // Distinct markers exercise forwarding only. Contract signature verification
  // is covered by Foundry; this test never submits a transaction to a chain.
  const params = { state, playerHandNonces: { '0': 1n, '1': 1n },
    claimantSignatures: ['0x11', '0x22'] as Hex[], handEndSignatures: ['0x33', '0x44'] as Hex[] };
  return { service, writeContract, params };
}

it.each(['prebuilt', 'fromState'])('forwards both signature sets through the %s settlement entry', async entry => {
  const { service, writeContract, params } = fixture();
  const prepared = service.getSettlementClient().prepareFromState(state, params.playerHandNonces);
  const result = entry === 'prebuilt'
    ? await service.settleHand({ handInit: prepared.handInit, settlement: prepared.settlement,
      claimantSignatures: params.claimantSignatures, handEndSignatures: params.handEndSignatures })
    : await service.settleFromState(params);
  expect(result.success).toBe(true);
  expect(writeContract).toHaveBeenCalledTimes(1);
  expect(writeContract.mock.calls[0][0].args).toEqual([
    prepared.handInit, prepared.settlement.outcome, params.claimantSignatures,
    prepared.settlement.handEnd, params.handEndSignatures,
  ]);
});

it('does not submit settlement when the hand-end signature set is absent', async () => {
  const { service, writeContract, params } = fixture();
  const { handEndSignatures: _, ...incomplete } = params;
  expect((await service.settleFromState(incomplete as never)).success).toBe(false);
  expect(writeContract).not.toHaveBeenCalled();
});
