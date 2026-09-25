import { expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import { approvePokerEnrollment } from './poker-wallet-approval';
const account = (n: number) => privateKeyToAccount(`0x${n.toString(16).padStart(64, '0')}`);
function fixture() {
  const wallet = account(1);
  const enrollment = new PokerHistoryEnrollment({ nonce: `0x${'1'.repeat(64)}`, handId: `0x${'2'.repeat(64)}`,
    rulesHash: `0x${'3'.repeat(64)}`, chainId: 31337, settler: wallet.address, roster: [account(2).address, account(3).address] },
    '{}', state => state, [wallet.address, account(4).address]);
  let signer = wallet; let chain = '0x7a69'; let selected = wallet.address;
  const calls: string[] = []; const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const provider = {
    on(event: string, handler: (...args: unknown[]) => void) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(handler); },
    removeListener(event: string, handler: (...args: unknown[]) => void) { handlers.get(event)?.delete(handler); },
    async request(input: { method: string; params?: unknown[] }) {
      calls.push(input.method);
      if (input.method === 'eth_accounts') return [selected];
      if (input.method === 'eth_chainId') return chain;
      if (input.method === 'eth_signTypedData_v4') return signer.signTypedData(enrollment.typedData(0));
      throw new Error('unexpected_method');
    },
  };
  return { enrollment, provider, calls, handlers, wrongChain: () => { chain = '0x1'; },
    wrongAccount: () => { selected = account(4).address; }, wrongSigner: () => { signer = account(4); } };
}
it('verifies the wallet signature without collecting or sending an approval', async () => {
  const f = fixture(); const signature = await approvePokerEnrollment(f.provider, f.enrollment, 0);
  expect(signature).toMatch(/^0x[0-9a-f]{130}$/); expect(f.enrollment.missingSeats).toEqual([0, 1]);
  expect(f.calls.filter(method => method === 'eth_signTypedData_v4')).toHaveLength(1);
  expect([...f.handlers.values()].every(set => set.size === 0)).toBe(true);
});
it.each(['wrongChain', 'wrongAccount'] as const)('refuses %s before requesting a signature', async mutation => {
  const f = fixture(); f[mutation]();
  await expect(approvePokerEnrollment(f.provider, f.enrollment, 0)).rejects.toThrow('poker_wallet:');
  expect(f.calls).not.toContain('eth_signTypedData_v4');
});
it('refuses a signature recovered to another wallet', async () => {
  const f = fixture(); f.wrongSigner();
  await expect(approvePokerEnrollment(f.provider, f.enrollment, 0)).rejects.toThrow('wrong_signer');
});
it('refuses a request already cancelled before any provider call', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await expect(approvePokerEnrollment(f.provider, f.enrollment, 0, controller.signal)).rejects.toThrow('aborted');
  expect(f.calls).toEqual([]); expect([...f.handlers.values()].every(set => set.size === 0)).toBe(true);
});
