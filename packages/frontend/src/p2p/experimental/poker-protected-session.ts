import type { PokerDealtBettingReplay, PokerPublicStreet } from '@manamesh/poker/verified-history';
import type { JoinCodeConnection } from '../discovery/join-code';
import type { openPokerLocalHistory } from '../poker-local-history';
import { connectPokerProtocolSession } from './poker-protocol-session';
import { ExperimentalPokerShuffleAdmission } from './poker-shuffle-admission';

/** Fresh admitted session only. Owns the local history, connections, worker
 * startup and protocol; supplies no host state, signing or recovery fallback.
 */
export function startPokerProtectedSession(links: ReadonlyMap<number, JoinCodeConnection>,
  local: Awaited<ReturnType<typeof openPokerLocalHistory>>, wasm: Uint8Array, dealer: number, relaySeat = 0) {
  const ownedLinks = new Map(links);
  const controller = new AbortController();
  let admission: ExperimentalPokerShuffleAdmission | undefined;
  let protocol: ReturnType<typeof connectPokerProtocolSession> | undefined;
  let terminal: Error | undefined;
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>(resolve => { resolveClosed = resolve; });
  function stop(reason: Error) {
    if (terminal) return; terminal = reason;
    local.dispose(reason); controller.abort(reason);
    protocol?.dispose(); admission?.dispose(reason);
    for (const link of ownedLinks.values()) link.close();
    resolveClosed(reason);
  }
  void local.whenClosed.then(stop);
  const ready = (async () => {
    try {
      if (local.closed) throw await local.whenClosed;
      const checkpoint = local.history.checkpoint;
      const genesis = JSON.parse(checkpoint.stateJSON);
      if (checkpoint.sequence !== 0 || genesis.version !== 5 || genesis.phase !== 'awaitingDeal' || genesis.dealer !== dealer) {
        throw new Error('poker_protected:genesis');
      }
      admission = await ExperimentalPokerShuffleAdmission.create(local.history, local.seat, wasm, dealer, controller.signal);
      if (terminal) { admission.dispose(terminal); throw terminal; }
      protocol = connectPokerProtocolSession(ownedLinks, local, admission, local.seat, relaySeat);
      void protocol.closed.then(stop);
      const runtime = await protocol.ready;
      if (terminal) throw terminal;
      const worker = admission;
      let announcements: Promise<ExperimentalPokerShuffleAdmission['roster']> | undefined;
      function exchangeAnnouncements() {
        if (terminal) return Promise.reject(terminal);
        if (!announcements) {
          announcements = (async () => {
            try {
              await runtime.proofs.announce();
              await runtime.proofs.waitForAnnouncements();
              await runtime.synchronize('announcements:reviewed');
              if (terminal) throw terminal;
              return worker.roster;
            } catch (error) {
              stop(error instanceof Error ? error : new Error('poker_protected:announcements_failed')); throw terminal;
            }
          })();
          void announcements.catch(() => {});
        }
        return announcements;
      }
      let shuffled: ReturnType<ExperimentalPokerShuffleAdmission['reviewDeck']> | undefined;
      function shuffleDeck() {
        if (terminal) return Promise.reject(terminal);
        if (shuffled) return shuffled;
        // A local missing-approval request does not start shuffling or close the session.
        let certificate: string;
        try { certificate = worker.approvalEnvelope('roster'); }
        catch (error) { return Promise.reject(error); }
        shuffled = (async () => {
          try {
            await worker.authorize(certificate);
            await runtime.synchronize('roster-approved');
            for (let step = 0; step < local.history.seatCount; step++) {
              if (step === local.seat) await runtime.proofs.shuffle();
              await runtime.proofs.waitForShuffle(step);
              await runtime.synchronize(`shuffle:${step}`);
            }
            const head = await worker.reviewDeck();
            await runtime.synchronize('shuffle:reviewed');
            if (terminal) throw terminal;
            return head;
          } catch (error) {
            stop(error instanceof Error ? error : new Error('poker_protected:shuffle_failed')); throw terminal;
          }
        })();
        void shuffled.catch(() => {});
        return shuffled;
      }
      let privateDeal: Promise<readonly Readonly<{ position: number; card: number }>[]> | undefined;
      function dealPrivateCards() {
        if (terminal) return Promise.reject(terminal);
        if (privateDeal) return privateDeal;
        privateDeal = (async () => {
          try {
            const head = local.history.checkpoint.head;
            if (JSON.parse(local.history.checkpoint.stateJSON).phase !== 'awaitingDeal') throw new Error('poker_protected:deal_phase');
            // Every caller has installed the reviewed deck authorization before
            // beginning. Barriers pace cards so the bounded worker queue cannot
            // be flooded by faster peers proceeding to the next position.
            await runtime.synchronize('private-deal:start');
            const cards: Readonly<{ position: number; card: number }>[] = [];
            for (const [position, owner] of worker.dealPlan.holeRecipients.entries()) {
              if (terminal) throw terminal;
              if (local.history.checkpoint.head !== head) throw new Error('poker_protected:stale_deal');
              if (owner !== local.seat) await runtime.proofs.sendPrivate(position);
              await runtime.proofs.waitForPrivate(position);
              if (owner === local.seat) {
                const card = await worker.openPrivateCard(position);
                cards.push(Object.freeze({ position, card: card[0] }));
              }
              await runtime.synchronize(`private-deal:${position}`);
            }
            if (terminal) throw terminal;
            if (local.history.checkpoint.head !== head) throw new Error('poker_protected:stale_deal');
            return Object.freeze(cards);
          } catch (error) {
            stop(error instanceof Error ? error : new Error('poker_protected:deal_failed'));
            throw terminal;
          }
        })();
        void privateDeal.catch(() => {});
        return privateDeal;
      }
      const reveals = new Map<string, { head: string; replay: PokerDealtBettingReplay; result: Promise<unknown> }>();
      function reveal<T>(replay: PokerDealtBettingReplay, kind: PokerPublicStreet | 'showdown', bind: () => T): Promise<T> {
        if (terminal) return Promise.reject(terminal);
        // Derive permissions locally before starting any worker or network work.
        let request: ReturnType<PokerDealtBettingReplay['communityRequest']> | ReturnType<PokerDealtBettingReplay['showdownRequest']>;
        try { request = kind === 'showdown' ? replay.showdownRequest(local.history) : replay.communityRequest(local.history, kind); }
        catch (error) { return Promise.reject(error); }
        const existing = reveals.get(kind);
        if (existing) {
          if (existing.head !== request.checkpoint || existing.replay !== replay) return Promise.reject(new Error('poker_protected:reveal_binding'));
          return existing.result as Promise<T>;
        }
        const result = (async () => {
          try {
            if (kind === 'showdown') await worker.authorizeShowdown(replay);
            else await worker.authorizePublicStreet(replay, kind);
            await runtime.synchronize(`public:${kind}:start`);
            for (const position of request.positions) {
              if (terminal) throw terminal;
              if (local.history.checkpoint.head !== request.checkpoint) throw new Error('poker_protected:stale_reveal');
              await runtime.proofs.preparePublic(position);
              runtime.proofs.sendPreparedPublic(position);
              await runtime.proofs.waitForPublic(position);
              await worker.openPublicCard(position);
              await runtime.synchronize(`public:${kind}:${position}`);
            }
            const evidence = bind(); // Binds only native-opened cards into local replay.
            await runtime.synchronize(`public:${kind}:bound`);
            if (terminal) throw terminal;
            if (local.history.checkpoint.head !== request.checkpoint) throw new Error('poker_protected:stale_reveal');
            return evidence;
          } catch (error) {
            stop(error instanceof Error ? error : new Error('poker_protected:reveal_failed'));
            throw terminal;
          }
        })();
        reveals.set(kind, { head: request.checkpoint, replay, result });
        void result.catch(() => {});
        return result;
      }
      const revealPublicStreet = (replay: PokerDealtBettingReplay, street: PokerPublicStreet) =>
        reveal(replay, street, () => Object.freeze(worker.bindPublicStreet(replay, street)));
      const revealShowdown = (replay: PokerDealtBettingReplay) =>
        reveal(replay, 'showdown', () => Object.freeze(worker.bindShowdown(replay).map(hand => hand === null ? null : Object.freeze(hand))));
      return Object.freeze({ ...runtime, admission, protocol, exchangeAnnouncements, shuffleDeck, dealPrivateCards, revealPublicStreet, revealShowdown });
    } catch (error) {
      stop(error instanceof Error ? error : new Error('poker_protected:startup_failed'));
      throw terminal;
    }
  })();
  void ready.catch(() => {});
  return Object.freeze({ ready, closed, get stage() { return terminal ? 'closed' : protocol?.stage ?? 'creatingWorker'; },
    dispose: (reason = new Error('poker_protected:disposed')) => stop(reason) });
}
