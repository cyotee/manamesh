import React, { useEffect, useRef, useState } from 'react';
import { hashTypedData } from 'viem';
import { pokerCardAt, type PokerApprovalKind } from '@manamesh/poker/verified-history';
import type { openPokerLocalHistory } from '../../p2p/poker-local-history';
import type { startPokerProtectedSession } from '../../p2p/experimental/poker-protected-session';
import type { startPokerHandController } from '../../p2p/experimental/poker-hand-controller';

type Props = {
  local: Awaited<ReturnType<typeof openPokerLocalHistory>>;
  runtime: Awaited<ReturnType<typeof startPokerProtectedSession>['ready']>;
  controller: ReturnType<typeof startPokerHandController>;
  relaySeat?: number;
};
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);

/** The caller owns session lifetime. Rendering never signs; every signing call
 * follows an explicit click bound to the review shown in this component. */
export function PokerProtectedTable(props: Props) {
  return <Table key={`${props.local.history.sessionId}:${props.local.seat}`} {...props} />;
}
function Table({ local, runtime, controller, relaySeat = 0 }: Props) {
  const [, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState<string>();
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<{ key: string; text: string }>();
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => refresh(value => value + 1), 100);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  const snapshot = controller.snapshot;
  const checkpoint = local.history.checkpoint;
  const state = JSON.parse(checkpoint.stateJSON);
  const kind = ({ rosterApproval: 'roster', deckApproval: 'deck', dealApproval: 'deal' } as Record<string, PokerApprovalKind>)[snapshot.stage];
  const closed = local.closed || snapshot.stage === 'closed';
  async function approvalData(kind: PokerApprovalKind) {
    const roster = runtime.admission.roster;
    if (kind === 'roster') return roster.typedData(local.seat);
    const head = await runtime.admission.reviewDeck();
    return kind === 'deck' ? roster.deckTypedData(local.seat, head) : roster.dealTypedData(local.seat, head);
  }
  function fingerprint(data: Awaited<ReturnType<typeof approvalData>>) {
    if (data.primaryType === 'PokerEncryptionRoster') return hashTypedData(data);
    if (data.primaryType === 'PokerShuffledDeck') return hashTypedData(data);
    return hashTypedData(data);
  }
  useEffect(() => {
    let cancelled = false; setReview(undefined); setChecked(undefined);
    if (kind && !closed) void approvalData(kind).then(data => {
      if (!cancelled) setReview({ key: fingerprint(data), text: json(data) });
    }, () => { if (!cancelled) setError('The approval could not be prepared. Check the table connection.'); });
    return () => { cancelled = true; };
  }, [kind, closed, local, runtime]);
  async function run(work: () => Promise<unknown>) {
    if (busy.current || local.closed) return;
    busy.current = true; setPending(true); setError(undefined);
    try { await work(); }
    catch { if (mounted.current) setError('The action could not be completed. Review the current table state before trying again.'); }
    finally { busy.current = false; if (mounted.current) { setPending(false); refresh(value => value + 1); } }
  }
  async function approve() {
    if (!kind || !review || checked !== review.key) return;
    const expectedStage = snapshot.stage;
    const current = await approvalData(kind);
    if (!mounted.current || fingerprint(current) !== review.key || controller.snapshot.stage !== expectedStage) throw new Error('poker_ui:review_changed');
    const reference = await local.prepareEncryptionSigning(runtime.admission.roster);
    if (!mounted.current || controller.snapshot.stage !== expectedStage) throw new Error('poker_ui:review_changed');
    const signature = kind === 'roster'
      ? await runtime.admission.signRoster(local.signingAccount, local.journal, reference)
      : kind === 'deck' ? await runtime.admission.signDeck(local.signingAccount, local.journal, reference)
        : await runtime.admission.signDeal(local.signingAccount, local.journal, reference);
    await runtime.proofs.approve(kind, signature);
  }
  const proposal = runtime.gameplay.proposalForReview;
  const proposed = proposal ? JSON.parse(proposal) : undefined;
  const canAct = !closed && !pending && runtime.gameplay.canPropose;
  const canBet = canAct && snapshot.stage === 'playing' && state.phase === 'betting'
    && !state.betting.round.isComplete && state.betting.round.activeSeat === local.seat;
  const labels = { roster: 'encryption roster', deck: 'encrypted deck', deal: 'private deal' };
  return <main style={{ maxWidth: 900, margin: 'auto', padding: 24 }}>
    <h1>Protected Poker table</h1>
    <p>Seat {local.seat + 1} · {snapshot.stage} · Checkpoint {checkpoint.sequence}</p>
    <p>Session {local.history.sessionId}</p>
    <p>Your cards: {snapshot.privateCards.length ? snapshot.privateCards.map(card => pokerCardAt(card.card).name).join(', ') : 'Waiting for the private deal'}</p>
    <p>Community cards: {state.community.length ? state.community.map((card: number) => pokerCardAt(card).name).join(', ') : 'None'}</p>
    <p>Pot: {state.betting.pot}</p>
    <table><thead><tr><th>Seat</th><th>Chips</th><th>Bet</th><th>Status</th></tr></thead><tbody>
      {state.betting.players.map((player: { chips: number; bet: number; folded: boolean; isAllIn: boolean }, seat: number) =>
        <tr key={seat}><td>{seat + 1}{seat === local.seat ? ' (you)' : ''}</td><td>{player.chips}</td><td>{player.bet}</td><td>{player.folded ? 'Folded' : player.isAllIn ? 'All in' : 'Playing'}</td></tr>)}
    </tbody></table>
    {kind && !closed && <section>
      <h2>Review {labels[kind]}</h2>
      {review && <><p>Approval fingerprint: {review.key}</p><details><summary>Exact approval data</summary><pre>{review.text}</pre></details></>}
      <label><input type="checkbox" aria-label="Review protocol approval" disabled={!review || pending}
        checked={Boolean(review && checked === review.key)} onChange={event => setChecked(event.target.checked ? review?.key : undefined)} />
        I reviewed this {labels[kind]}.</label>
      <p><button disabled={!review || checked !== review.key || pending || !runtime.admission.approvalProgress[kind].includes(local.seat)}
        onClick={() => void run(approve)}>Approve {labels[kind]}</button></p>
    </section>}
    {snapshot.action && snapshot.action.actor === local.seat && <section>
      <h2>Next table transition</h2><pre>{json(JSON.parse(snapshot.action.payloadJSON))}</pre>
      <button disabled={!canAct} onClick={() => void run(() => runtime.gameplay.propose(snapshot.action!.payloadJSON, snapshot.action!.checkpoint))}>Propose table transition</button>
    </section>}
    {canBet && <section aria-label="Betting actions">
      {['fold', 'check', 'call', 'allIn'].map(move => <button key={move} onClick={() => void run(() => runtime.gameplay.propose(JSON.stringify({ move }), checkpoint.head))}>Propose {move}</button>)}
      <label>Chip amount <input inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {['bet', 'raise'].map(move => <button key={move} disabled={!/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0}
        onClick={() => void run(() => runtime.gameplay.propose(JSON.stringify({ move, amount: Number(amount) }), checkpoint.head))}>Propose {move}</button>)}
    </section>}
    {proposed && !closed && <section>
      <h2>Proposed action from seat {proposed.actor + 1}</h2><pre>{json(JSON.parse(proposed.payloadJSON))}</pre>
      <p>Checkpoint {proposed.sequence}, parent {proposed.parent}</p>
      <label><input type="checkbox" aria-label="Review proposed action" checked={checked === proposal} disabled={pending}
        onChange={event => setChecked(event.target.checked ? proposal : undefined)} />I reviewed this action.</label>
      <p><button disabled={pending || checked !== proposal || !runtime.gameplay.missingSeats.includes(local.seat)}
        onClick={() => void run(() => runtime.gameplay.acknowledge(proposal))}>Approve proposed action</button>
      {local.seat === relaySeat && <button disabled={pending || runtime.gameplay.missingSeats.length !== 0}
        onClick={() => void run(() => runtime.gameplay.commit(proposal))}>Commit approved action</button>}</p>
    </section>}
    {state.result && <p>Hand complete: {state.result.reason}</p>}
    {error && <p role="alert">{error}</p>}
    {closed && <p role="status">This table is closed.</p>}
    <button disabled={closed} onClick={() => controller.dispose()}>Leave table</button>
  </main>;
}
