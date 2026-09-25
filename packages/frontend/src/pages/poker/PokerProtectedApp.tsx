import React, { useEffect, useRef, useState } from 'react';
import { getAddress } from 'viem';
import type { InjectedEthereum } from '../../blockchain/liveFromInjected';
import { JoinCodeConnection } from '../../p2p/discovery/join-code';
import { createPokerInvitation, createPokerParticipant, reviewPokerInvitation } from '../../p2p/experimental/poker-session-invitation';
import { loadPokerVerificationModule } from '../../p2p/experimental/poker-module-loader';
import { connectPokerEnrollmentSession } from '../../p2p/poker-enrollment-session';
import { startPokerProtectedSession } from '../../p2p/experimental/poker-protected-session';
import { startPokerHandController } from '../../p2p/experimental/poker-hand-controller';
import { PokerEnrollmentApproval } from './PokerEnrollmentApproval';
import { PokerProtectedTable } from './PokerProtectedTable';

function freshOwner() {
  return { closed: false, abort: new AbortController(), links: new Map<number, JoinCodeConnection>(),
    participant: undefined as ReturnType<typeof createPokerParticipant> | undefined,
    review: undefined as ReturnType<typeof reviewPokerInvitation> | undefined,
    enrollment: undefined as ReturnType<typeof connectPokerEnrollmentSession> | undefined,
    session: undefined as ReturnType<typeof startPokerProtectedSession> | undefined,
    controller: undefined as ReturnType<typeof startPokerHandController> | undefined,
    wasm: undefined as Uint8Array | undefined };
}
type Table = React.ComponentProps<typeof PokerProtectedTable>;

/** Explicit preview entry until independent review and interrupted-hand policy
 * are complete. All identities and lifetime state originate in this browser. */
export function PokerProtectedApp() {
  const owner = useRef(freshOwner());
  const [phase, setPhase] = useState<'identity' | 'invitation' | 'connections' | 'enrollment' | 'starting' | 'table' | 'closed'>('identity');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const working = useRef(false);
  const [, refresh] = useState(0);
  const [chainId, setChainId] = useState(0);
  const [settler, setSettler] = useState('');
  const [wallets, setWallets] = useState('');
  const [participants, setParticipants] = useState('');
  const [wire, setWire] = useState('');
  const [stack, setStack] = useState('100');
  const [smallBlind, setSmallBlind] = useState('1');
  const [bigBlind, setBigBlind] = useState('2');
  const [offers, setOffers] = useState<Record<number, string>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [guestOffer, setGuestOffer] = useState('');
  const [guestAnswer, setGuestAnswer] = useState('');
  const [table, setTable] = useState<Table>();
  const provider = (window as unknown as { ethereum?: InjectedEthereum }).ethereum;
  function close(current = owner.current, update = true) {
    if (current.closed) return;
    current.closed = true; current.abort.abort(); current.participant?.dispose();
    current.controller?.dispose(); current.session?.dispose(); current.enrollment?.dispose();
    for (const link of current.links.values()) link.close();
    if (update) setPhase('closed');
  }
  useEffect(() => {
    // StrictMode's initial cleanup owns no user-created resources.
    if (owner.current.closed) owner.current = freshOwner();
    const current = owner.current;
    const timer = setInterval(() => {
      if (current.closed) return;
      refresh(value => value + 1);
      if (current.review && !current.enrollment && current.links.size === (current.review.seat === 0 ? current.review.enrollment.seatCount - 1 : 1)
        && [...current.links.values()].every(link => link.isConnected())) void beginEnrollment(current);
    }, 100);
    return () => { clearInterval(timer); close(current, false); };
  }, []);
  async function run(work: () => Promise<unknown>) {
    if (working.current || owner.current.closed) return;
    working.current = true; setPending(true); setError(undefined);
    try { await work(); }
    catch { if (!owner.current.closed) setError('This step could not be completed. Check the supplied details, wallet, and connection.'); }
    finally { working.current = false; if (!owner.current.closed) setPending(false); }
  }
  async function identity() {
    const current = owner.current;
    if (!provider) throw new Error('wallet_missing');
    getAddress(settler);
    current.wasm = await loadPokerVerificationModule(current.abort.signal);
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const chain = await provider.request({ method: 'eth_chainId' });
    if (current.closed) return;
    if (!Array.isArray(accounts) || !accounts.length || typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain)
      || !Number.isSafeInteger(Number(chain)) || Number(chain) <= 0) throw new Error('wallet_context');
    const wallet = getAddress(accounts[0]);
    current.participant = createPokerParticipant(wallet);
    setChainId(Number(chain)); setWallets(wallet);
    setParticipants(JSON.stringify([current.participant.publicIdentity])); setPhase('invitation');
  }
  async function connect() {
    const current = owner.current;
    current.review = reviewPokerInvitation(wire.trim(), { wallets: wallets.split(/[\s,]+/).filter(Boolean).map(wallet => getAddress(wallet)),
      chainId, settler: getAddress(settler), participant: current.participant!.publicIdentity });
    setPhase('connections');
    if (current.review.seat === 0) {
      for (let seat = 1; seat < current.review.enrollment.seatCount; seat++) {
        const link = connection(current); current.links.set(seat, link);
        const offer = await link.createGame();
        if (current.closed) return;
        setOffers(values => ({ ...values, [seat]: offer }));
      }
    }
  }
  function connection(current: ReturnType<typeof freshOwner>) {
    return new JoinCodeConnection({ onMessage: () => {}, onStateChange: state => {
      if (state.phase === 'error' && !current.closed) { setError('The peer connection failed. Start a fresh preview.'); close(current); }
    }, onConnectionStateChange: () => {} });
  }
  async function join() {
    const current = owner.current;
    if (current.links.size) throw new Error('already_joining');
    const link = connection(current); current.links.set(0, link);
    const answer = await link.joinGame(guestOffer.trim());
    if (!current.closed) setGuestAnswer(answer);
  }
  async function beginEnrollment(current: ReturnType<typeof freshOwner>) {
    try {
      const reviewed = current.review!;
      current.enrollment = connectPokerEnrollmentSession(current.links, reviewed.enrollment, reviewed.seat, current.participant!.signingAccount);
      setPhase('enrollment');
      void current.enrollment.closed.then(() => close(current));
      const local = await current.enrollment.ready;
      if (current.closed) { local.dispose(); return; }
      setPhase('starting');
      current.session = startPokerProtectedSession(current.links, local, current.wasm!, reviewed.invitation.dealer);
      void current.session.closed.then(() => close(current));
      const runtime = await current.session.ready;
      if (current.closed) return;
      current.controller = startPokerHandController(current.session, local, reviewed.replay);
      setTable({ local, runtime, controller: current.controller }); setPhase('table');
    } catch { if (!current.closed) { setError('The protected session could not start. Start a fresh preview.'); close(current); } }
  }
  const current = owner.current;
  if (phase === 'table' && table) return <><p style={{ padding: 12 }}>Experimental protocol preview — not approved for real-money play.</p><PokerProtectedTable {...table} /></>;
  return <main style={{ maxWidth: 900, margin: 'auto', padding: 24 }}>
    <h1>Protected Poker preview</h1>
    <p>This protocol is awaiting independent cryptographic review and interrupted-hand settlement support.</p>
    {phase === 'identity' && <section>
      <label>Agreed domain address <input aria-label="Agreed domain address" value={settler} onChange={event => setSettler(event.target.value)} /></label>
      <p>This identifies the agreed signing domain; connecting does not send a transaction.</p>
      <button disabled={pending || !provider} onClick={() => void run(identity)}>Connect wallet and create identity</button>
      {!provider && <p>Open this page with an injected Ethereum wallet.</p>}
    </section>}
    {phase === 'invitation' && <section>
      <p>Wallet chain: {chainId}</p>
      <label>Your public identity<textarea aria-label="Your public identity" readOnly value={JSON.stringify(current.participant!.publicIdentity)} /></label>
      <p>Share only this public identity with the other players.</p>
      <label>Expected wallets in seat order<textarea aria-label="Expected wallets in seat order" value={wallets} onChange={event => setWallets(event.target.value)} /></label>
      <p>Check these wallet addresses independently with the players, not just against the invitation.</p>
      <details><summary>Create an invitation</summary>
        <label>Public participant identities<textarea aria-label="Public participant identities" value={participants} onChange={event => setParticipants(event.target.value)} /></label>
        <label>Chips per player<input aria-label="Chips per player" value={stack} onChange={event => setStack(event.target.value)} /></label>
        <label>Small blind<input aria-label="Small blind" value={smallBlind} onChange={event => setSmallBlind(event.target.value)} /></label>
        <label>Big blind<input aria-label="Big blind" value={bigBlind} onChange={event => setBigBlind(event.target.value)} /></label>
        <button disabled={pending} onClick={() => void run(async () => setWire(createPokerInvitation({ chainId, settler: getAddress(settler), dealer: 0,
          smallBlind: Number(smallBlind), bigBlind: Number(bigBlind), seats: JSON.parse(participants).map((participant: object) => ({ ...participant, stack: Number(stack) })) })))}>Create invitation</button>
      </details>
      <label>Public invitation<textarea aria-label="Public invitation" value={wire} onChange={event => setWire(event.target.value)} /></label>
      <button disabled={pending || !wire} onClick={() => void run(connect)}>Review invitation and connect</button>
    </section>}
    {phase === 'connections' && current.review && <section>
      <p>Your seat: {current.review.seat + 1}. Seat 1 relays the connection.</p>
      {current.review.seat === 0 ? Array.from({ length: current.review.enrollment.seatCount - 1 }, (_, index) => index + 1).map(seat => <div key={seat}>
        <label>Offer for seat {seat + 1}<textarea aria-label={`Offer for seat ${seat + 1}`} readOnly value={offers[seat] ?? ''} /></label>
        <label>Answer from seat {seat + 1}<textarea aria-label={`Answer from seat ${seat + 1}`} value={answers[seat] ?? ''} onChange={event => setAnswers(values => ({ ...values, [seat]: event.target.value }))} /></label>
        <button disabled={pending || !answers[seat] || current.links.get(seat)?.isConnected()} onClick={() => void run(() => current.links.get(seat)!.acceptAnswer(answers[seat].trim()))}>Connect seat {seat + 1}</button>
      </div>) : <div>
        <label>Your join offer<textarea aria-label="Your join offer" value={guestOffer} onChange={event => setGuestOffer(event.target.value)} /></label>
        <button disabled={pending || !guestOffer || Boolean(guestAnswer)} onClick={() => void run(join)}>Accept join offer</button>
        <label>Your join answer<textarea aria-label="Your join answer" readOnly value={guestAnswer} /></label>
      </div>}
    </section>}
    {phase === 'enrollment' && current.enrollment?.registered && provider && <PokerEnrollmentApproval enrollment={current.review!.enrollment}
      localSeat={current.review!.seat} provider={provider} onApproval={signature => current.enrollment!.submitApproval(signature)} />}
    {(phase === 'starting' || phase === 'enrollment' && !current.enrollment?.registered) && <p>Waiting for the other players…</p>}
    {phase === 'closed' && <p>This preview is closed. Reload to create a fresh session.</p>}
    {error && <p role="alert">{error}</p>}
    {phase !== 'closed' && <button onClick={() => close()}>Cancel preview</button>}
  </main>;
}
