import React, { useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import type { PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import type { InjectedEthereum } from '../../blockchain/liveFromInjected';
import { approvePokerEnrollment } from '../../p2p/poker-wallet-approval';
import { PokerEnrollmentReview, pokerTerms } from './PokerEnrollmentReview';

function approvalError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : '';
  if (message.includes('context_changed')) return 'Your wallet changed during approval. Check the account and chain, then try again.';
  if (message === 'poker_wallet:account') return 'Connect the wallet listed for your seat before approving.';
  if (message === 'poker_wallet:chain') return 'Select the chain shown in this review before approving.';
  if (message === 'poker_wallet:timeout') return 'The wallet request timed out. Check your wallet before trying again.';
  if (message === 'poker_wallet:events_required') return 'This wallet does not provide the connection updates required for session approval.';
  return 'Approval could not be submitted. Check your wallet and peer connection, then try again.';
}

type Props = { enrollment: PokerHistoryEnrollment; localSeat: number; provider: InjectedEthereum;
  onApproval: (signature: Hex) => Promise<void> };
export function PokerEnrollmentApproval(props: Props) {
  return <Approval key={`${props.enrollment.sessionId}:${props.enrollment.reviewTerms.walletRosterHash}:${props.localSeat}`} {...props} />;
}
function Approval({ enrollment, localSeat, provider, onApproval }: Props) {
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<'review' | 'pending' | 'approved'>('review');
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const request = useRef<AbortController>();
  useEffect(() => {
    request.current?.abort(); request.current = undefined; pending.current = false;
    setChecked(false); setStatus('review'); setError(undefined);
    return () => request.current?.abort();
  }, [enrollment, provider, localSeat]);
  const supported = Boolean(pokerTerms(enrollment.reviewTerms.genesisJSON, enrollment.seatCount));
  async function approve() {
    if (!checked || !supported || pending.current || status === 'approved') return;
    pending.current = true; setStatus('pending'); setError(undefined);
    const controller = new AbortController(); request.current = controller;
    try {
      const signature = await approvePokerEnrollment(provider, enrollment, localSeat, controller.signal);
      if (controller.signal.aborted) return;
      await onApproval(signature);
      if (!controller.signal.aborted) setStatus('approved');
    } catch (reason) {
      if (!controller.signal.aborted) { setStatus('review'); setError(approvalError(reason)); }
    } finally { if (request.current === controller) pending.current = false; }
  }
  return <div>
    <PokerEnrollmentReview enrollment={enrollment} localSeat={localSeat} />
    <label><input type="checkbox" checked={checked} disabled={status !== 'review'} onChange={event => setChecked(event.target.checked)} />
      I checked the wallets, signing identities and game terms with the other players.</label>
    <p><button type="button" disabled={!checked || !supported || status !== 'review'} onClick={() => void approve()}>
      {status === 'pending' ? 'Waiting for wallet approval…' : status === 'approved' ? 'Approval submitted' : 'Approve session identity'}
    </button></p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
