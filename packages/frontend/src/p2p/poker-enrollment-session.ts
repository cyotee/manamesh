import { getAddress, type Hex, type LocalAccount } from 'viem';
import type { PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import type { JoinCodeConnection } from './discovery/join-code';
import { PokerEnrollmentExchange } from './poker-enrollment-exchange';
import { openPokerLocalHistory } from './poker-local-history';

/** Own connected enrollment links and the resulting fresh local history.
 * Terms and the local session account must be established independently before
 * construction. No wallet signing, term replacement or recovery is performed.
 */
export function connectPokerEnrollmentSession(links: ReadonlyMap<number, JoinCodeConnection>,
  enrollment: PokerHistoryEnrollment, seat: number, account: Pick<LocalAccount, 'address' | 'signTypedData'>, relaySeat = 0) {
  if (!Number.isInteger(seat) || enrollment.reviewTerms.seats[seat]?.signingKey !== getAddress(account.address)) {
    throw new Error('poker_enrollment_session:identity');
  }
  const ownedLinks = new Map(links);
  let exchange: PokerEnrollmentExchange;
  try { exchange = new PokerEnrollmentExchange(ownedLinks, enrollment, seat, relaySeat); }
  catch (error) { for (const link of ownedLinks.values()) link.close(); throw error; }
  let stage: 'enrolling' | 'opening' | 'ready' | 'closed' = 'enrolling';
  let local: Awaited<ReturnType<typeof openPokerLocalHistory>> | undefined;
  let terminal: Error | undefined;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>(resolve => { resolveClosed = resolve; });
  function stop(reason: Error) {
    if (terminal) return;
    terminal = reason; stage = 'closed'; clearInterval(monitor);
    exchange.dispose(); local?.dispose(reason);
    for (const link of ownedLinks.values()) link.close();
    resolveClosed(reason);
  }
  // The bootstrap exchange stops after admission; keep connection ownership
  // alive while storage/worker startup has not installed protocol channels yet.
  monitor = setInterval(() => {
    if ([...ownedLinks.values()].some(link => !link.isConnected())) stop(new Error('poker_enrollment_session:disconnected'));
  }, 500);
  void exchange.whenClosed.then(reason => { if (stage === 'enrolling') stop(reason); });
  const ready = (async () => {
    try {
      const wire = await exchange.completed;
      if (terminal) throw terminal;
      stage = 'opening'; exchange.dispose();
      local = await openPokerLocalHistory({ admit: () => enrollment.admit(wire), seat, account });
      if (terminal) { local.dispose(terminal); throw terminal; }
      void local.whenClosed.then(stop);
      stage = 'ready'; return local;
    } catch (error) {
      stop(error instanceof Error ? error : new Error('poker_enrollment_session:failed'));
      throw terminal;
    }
  })();
  void ready.catch(() => {});
  return Object.freeze({ ready, closed, get stage() { return stage; }, get registered() { return exchange.ready; },
    get missingSeats() { return exchange.missingSeats; },
    submitApproval: (signature: Hex) => exchange.submitApproval(signature),
    dispose: () => stop(new Error('poker_enrollment_session:disposed')) });
}
