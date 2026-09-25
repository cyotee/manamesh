import type { PokerDealtBettingReplay, PokerPublicStreet } from '@manamesh/poker/verified-history';
import type { openPokerLocalHistory } from '../poker-local-history';
import type { startPokerProtectedSession } from './poker-protected-session';

type Stage = 'connecting' | 'announcements' | 'rosterApproval' | 'shuffling' | 'deckApproval'
  | 'dealing' | 'dealApproval' | 'playing' | 'revealing' | 'actionReady' | 'complete' | 'closed';

/** Own automatic protocol dispatch for a fresh protected hand. Only verified
 * local approvals/history trigger work. Suggestions are unsigned: the UI must
 * still explicitly propose, acknowledge and commit every gameplay transition.
 */
export function startPokerHandController(session: ReturnType<typeof startPokerProtectedSession>,
  local: Awaited<ReturnType<typeof openPokerLocalHistory>>, replay: PokerDealtBettingReplay) {
  let stage: Stage = 'connecting';
  let runtime: Awaited<typeof session.ready> | undefined;
  let busy = false;
  let reason: Error | undefined;
  let privateCards: readonly Readonly<{ position: number; card: number }>[] = Object.freeze([]);
  let action: Readonly<{ checkpoint: string; actor: number; payloadJSON: string }> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  function stop(error: Error) {
    if (reason) return;
    reason = error; stage = 'closed'; action = undefined; clearInterval(timer);
    session.dispose(error);
  }
  function suggest(payload: unknown) {
    action = Object.freeze({ checkpoint: local.history.checkpoint.head,
      actor: JSON.parse(local.history.checkpoint.stateJSON).dealer, payloadJSON: JSON.stringify(payload) });
    stage = 'actionReady';
  }
  async function step() {
    if (busy || reason || stage === 'complete') return;
    busy = true;
    try {
      if (local.closed) throw await local.whenClosed;
      if (stage === 'connecting') {
        if (local.history.checkpoint.sequence !== 0 || local.history.checkpoint.stateJSON !== replay.genesisJSON) throw new Error('poker_hand:genesis');
        runtime = await session.ready;
        stage = 'announcements'; await runtime.exchangeAnnouncements();
        if (!reason) stage = 'rosterApproval';
        return;
      }
      const active = runtime!;
      if (stage === 'rosterApproval') {
        if (active.admission.approvalProgress.roster.length) return;
        stage = 'shuffling'; await active.shuffleDeck();
        if (!reason) stage = 'deckApproval';
        return;
      }
      if (stage === 'deckApproval') {
        if (active.admission.approvalProgress.deck.length) return;
        stage = 'dealing';
        await active.admission.authorizeDeck(active.admission.approvalEnvelope('deck'));
        replay.bindDeck(local.history, active.admission.roster, await active.admission.reviewDeck());
        await active.synchronize('deck-approved');
        privateCards = await active.dealPrivateCards();
        if (!reason) stage = 'dealApproval';
        return;
      }
      if (stage === 'dealApproval' && local.history.checkpoint.sequence === 0) {
        if (active.admission.approvalProgress.deal.length) return;
        suggest({ move: 'beginBetting', certificate: active.admission.approvalEnvelope('deal') });
        return;
      }
      if (action?.checkpoint === local.history.checkpoint.head) return;
      action = undefined;
      const state = JSON.parse(local.history.checkpoint.stateJSON);
      if (state.phase === 'complete') { stage = 'complete'; clearInterval(timer); return; }
      if (state.phase !== 'betting') throw new Error('poker_hand:phase');
      stage = 'playing';
      if (!state.betting.round.isComplete) return;
      if (state.betting.players.filter((player: { folded: boolean }) => !player.folded).length === 1) {
        suggest({ move: 'finishUncontested' }); return;
      }
      stage = 'revealing';
      const revealHead = local.history.checkpoint.head;
      if (state.street === 'river') {
        const hands = await active.revealShowdown(replay);
        if (!reason && local.history.checkpoint.head === revealHead) suggest({ move: 'finishShowdown', hands });
      } else {
        const street = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as Record<string, PokerPublicStreet>)[state.street];
        if (!street) throw new Error('poker_hand:street');
        const cards = await active.revealPublicStreet(replay, street);
        if (!reason && local.history.checkpoint.head === revealHead) suggest({ move: { flop: 'revealFlop', turn: 'revealTurn', river: 'revealRiver' }[street], cards });
      }
    } catch (error) { stop(error instanceof Error ? error : new Error('poker_hand:failed')); }
    finally { busy = false; }
  }
  // Poll only bounded local state. No network retries, signing, or overlapping
  // worker operations are introduced while users review approvals.
  timer = setInterval(() => { void step(); }, 100);
  void session.closed.then(stop);
  void step();
  return Object.freeze({ get snapshot() {
      const currentAction = action?.checkpoint === local.history.checkpoint.head ? action : undefined;
      return Object.freeze({ stage: stage === 'actionReady' && !currentAction ? 'playing' as const : stage, action: currentAction, privateCards, reason: reason?.message });
    },
    dispose: () => stop(new Error('poker_hand:disposed')) });
}
