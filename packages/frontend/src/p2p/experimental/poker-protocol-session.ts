import type { openPokerLocalHistory } from '../poker-local-history';
import { connectPokerHistoryTable } from '../poker-history-table';
import { PokerGameplayExchange } from '../poker-gameplay-exchange';
import { awaitPokerProtocolReady } from '../poker-protocol-ready';
import { PokerProofExchange } from './poker-proof-exchange';
import type { ExperimentalPokerShuffleAdmission } from './poker-shuffle-admission';

/** Own transport, proof and gameplay lifetimes for an already admitted local
 * history/worker. This does not create journals, sign, or recover private keys.
 * On construction the supplied local history and worker become owned by this
 * session. Ending either local owner also terminates the protocol.
 */
export function connectPokerProtocolSession(links: Parameters<typeof connectPokerHistoryTable>[0],
  local: Awaited<ReturnType<typeof openPokerLocalHistory>>, admission: ExperimentalPokerShuffleAdmission,
  seat: number, relaySeat = 0) {
  const { history, signer } = local;
  const ownedLinks = new Map(links);
  let table: ReturnType<typeof connectPokerHistoryTable> | undefined;
  let barrier: ReturnType<typeof awaitPokerProtocolReady> | undefined;
  let proofs: PokerProofExchange | undefined;
  let gameplay: PokerGameplayExchange | undefined;
  let terminal: Error | undefined;
  let scopeHead = history.checkpoint.head;
  const scopes = new Map<string, Promise<void>>();
  let activeScope: string | undefined;
  // Call only after local verification/authorization. Peer readiness never
  // authorizes a signature or a reveal. Exact retries share the same barrier.
  function synchronize(scope: string): Promise<void> {
    if (terminal) return Promise.reject(terminal);
    if (stage !== 'ready' || !/^[a-z0-9:-]{1,64}$/.test(scope) || scope === 'handlers') return Promise.reject(new Error('poker_session:scope'));
    if (activeScope && (activeScope !== scope || scopeHead !== history.checkpoint.head)) return Promise.reject(new Error('poker_session:scope_pending'));
    if (scopeHead !== history.checkpoint.head) { scopes.clear(); scopeHead = history.checkpoint.head; }
    const existing = scopes.get(scope);
    if (existing) return existing;
    if (scopes.size >= 64) return Promise.reject(new Error('poker_session:scope_limit'));
    activeScope = scope;
    const pending = (async () => {
      try {
        barrier = awaitPokerProtocolReady(ownedLinks, history, seat, relaySeat, scope);
        await barrier.ready;
        if (terminal) throw terminal;
      } catch (error) {
        stop(error instanceof Error ? error : new Error('poker_session:failed'));
        throw terminal;
      } finally { activeScope = undefined; }
    })();
    scopes.set(scope, pending);
    void pending.catch(() => {});
    return pending;
  }
  let stage: 'connecting' | 'installing' | 'waitingPeers' | 'ready' | 'closed' = 'connecting';
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>(resolve => { resolveClosed = resolve; });
  const workerClosed = (event: Event) => stop((event as CustomEvent<Error>).detail);
  function stop(reason: Error) {
    if (terminal) return; terminal = reason; stage = 'closed';
    // Revoke account use before transport/worker cleanup can settle pending work.
    local.dispose(reason);
    admission.removeEventListener('closed', workerClosed);
    barrier?.dispose(); proofs?.dispose(reason); gameplay?.dispose(); table?.dispose(); admission.dispose(reason);
    resolveClosed(reason);
  }
  admission.addEventListener('closed', workerClosed);
  void local.whenClosed.then(stop);
  const ready = (async () => {
    try {
      if (admission.closed) throw new Error('poker_session:worker_closed');
      if (local.closed) throw await local.whenClosed;
      if (seat !== local.seat) throw new Error('poker_session:local_seat');
      table = connectPokerHistoryTable(ownedLinks, history, seat, relaySeat);
      void table.closed.then(reason => stop(reason));
      const channels = await table.ready;
      if (terminal) throw terminal;
      stage = 'installing';
      const connected = new Map(channels.map(entry => [entry.seat, entry.channel]));
      proofs = new PokerProofExchange(connected, history, admission, seat, relaySeat);
      gameplay = new PokerGameplayExchange(connected, history, signer, seat, relaySeat);
      // An early guest must not send artifacts while a relay is still waiting
      // for another link and has not installed its proof verifier yet.
      stage = 'waitingPeers';
      barrier = awaitPokerProtocolReady(ownedLinks, history, seat, relaySeat);
      await barrier.ready;
      if (terminal) throw terminal;
      stage = 'ready';
      return Object.freeze({ channels, proofs, gameplay, synchronize });
    } catch (error) {
      const reason = error instanceof Error ? error : new Error('poker_session:failed');
      stop(reason); throw terminal;
    }
  })();
  return { ready, closed, get stage() { return stage; }, dispose: () => stop(new Error('poker_session:disposed')) };
}
