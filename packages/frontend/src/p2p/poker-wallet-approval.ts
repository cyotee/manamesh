import { getAddress, recoverTypedDataAddress, type Hex } from 'viem';
import type { PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import type { InjectedEthereum } from '../blockchain/liveFromInjected';

/** Explicit user action only. Checks the selected wallet/chain and verifies its
 * signature; no transaction, chain switching, collection or peer send occurs.
 */
export async function approvePokerEnrollment(provider: InjectedEthereum, enrollment: PokerHistoryEnrollment,
  seat: number, signal?: AbortSignal): Promise<Hex> {
  const terms = enrollment.reviewTerms;
  const identity = terms.seats[seat];
  if (!Number.isInteger(seat) || !identity) throw new Error('poker_wallet:seat');
  if (!provider.on || !provider.removeListener) throw new Error('poker_wallet:events_required');
  let failure: Error | undefined;
  let rejectStopped!: (reason: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  void stopped.catch(() => {});
  const stop = (reason: string) => { if (!failure) { failure = new Error(`poker_wallet:${reason}`); rejectStopped(failure); } };
  const changed = () => stop('context_changed');
  const aborted = () => stop('aborted');
  const cleanups: (() => void)[] = [];
  const live = () => { if (signal?.aborted) aborted(); if (failure) throw failure; };
  const wait = async <T,>(work: Promise<T>) => { const value = await Promise.race([work, stopped]); live(); return value; };
  const timer = setTimeout(() => stop('timeout'), 120_000);
  async function context() {
    live();
    const accounts = await wait(provider.request({ method: 'eth_accounts' }));
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || getAddress(accounts[0]) !== identity.wallet) throw new Error('poker_wallet:account');
    const chain = await wait(provider.request({ method: 'eth_chainId' }));
    if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || Number(chain) !== terms.chainId) throw new Error('poker_wallet:chain');
  }
  try {
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
      provider.on(event, changed); cleanups.push(() => provider.removeListener!(event, changed));
    }
    signal?.addEventListener('abort', aborted, { once: true });
    cleanups.push(() => signal?.removeEventListener('abort', aborted));
    await context();
    const data = enrollment.typedData(seat);
    const wire = JSON.stringify({ ...data, types: { ...data.types, EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }, { name: 'salt', type: 'bytes32' },
    ] } });
    live();
    const signature = await wait(provider.request({ method: 'eth_signTypedData_v4', params: [identity.wallet, wire] }));
    if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(signature)) throw new Error('poker_wallet:signature');
    if (getAddress(await wait(recoverTypedDataAddress({ ...data, signature: signature as Hex }))) !== identity.wallet) throw new Error('poker_wallet:wrong_signer');
    await context(); live();
    return signature as Hex;
  } finally { clearTimeout(timer); cleanups.reverse().forEach(cleanup => cleanup()); }
}
