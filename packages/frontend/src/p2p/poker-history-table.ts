import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { PokerHistoryChannel } from './poker-history-channel';
import { connectPokerHistory } from './poker-join-session';

type Link = Parameters<typeof connectPokerHistory>[0];
/** Own a star table's local history links. This is transport readiness, not
 * unanimous game authorization; every transition still needs every seat's vote.
 */
export function connectPokerHistoryTable(links: ReadonlyMap<number, Link>, history: VerifiedPokerHistory, seat: number, relaySeat = 0) {
  const validSeat = (value: number) => Number.isInteger(value) && value >= 0 && value < history.seatCount;
  if (!validSeat(seat) || !validSeat(relaySeat)) throw new Error('poker_table:seat');
  const expected = seat === relaySeat
    ? Array.from({ length: history.seatCount }, (_, index) => index).filter(index => index !== seat)
    : [relaySeat];
  // Validate the complete topology before registering anything on a live link.
  if (links.size !== expected.length || expected.some(peer => !links.has(peer))
    || new Set(links.values()).size !== links.size) throw new Error('poker_table:topology');
  const entries = expected.map(peer => ({ peer, link: links.get(peer)! }));
  if (entries.some(({ link }) => !link.isConnected())) throw new Error('poker_table:not_connected');
  const sessions: ReturnType<typeof connectPokerHistory>[] = [];
  let terminal: Error | undefined;
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>(resolve => { resolveClosed = resolve; });
  function stop(reason: Error) {
    if (terminal) return;
    terminal = reason;
    for (const session of sessions) session.dispose();
    resolveClosed(reason);
  }
  const pending: Promise<Readonly<{ seat: number; channel: PokerHistoryChannel }>>[] = [];
  try {
    for (const { peer, link } of entries) {
      const session = connectPokerHistory(link, history, seat, peer);
      sessions.push(session);
      void session.closed.then(reason => stop(new Error(`poker_table:peer_${peer}:${reason.message}`)));
      pending.push(session.ready.then(channel => Object.freeze({ seat: peer, channel })));
    }
  } catch (error) {
    const reason = error instanceof Error ? error : new Error(String(error));
    stop(reason);
    pending.push(Promise.reject(reason));
  }
  const ready = Promise.all(pending).then(channels => {
    if (terminal) throw terminal;
    return Object.freeze(channels);
  }).catch(error => {
    stop(error instanceof Error ? error : new Error(String(error)));
    throw terminal;
  });
  return { ready, closed, dispose: () => stop(new Error('poker_table:disposed')) };
}
