import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { PokerHistoryEnrollment, PokerDealtBettingReplay } from '@manamesh/poker/verified-history';
import { PokerEnrollmentReview } from './PokerEnrollmentReview';
const address = (n: number) => privateKeyToAccount(`0x${n.toString(16).padStart(64, '0')}`).address;
function enrollment() {
  return new PokerHistoryEnrollment({ nonce: `0x${'1'.repeat(64)}`, handId: `0x${'2'.repeat(64)}`,
    rulesHash: `0x${'3'.repeat(64)}`, chainId: 31337, settler: address(8), roster: [address(1), address(2)] },
    '{"label":"<script>host text</script>"}', state => state, [address(3), address(4)]);
}
it('renders the exact bound identities and escapes public state without requesting approval', () => {
  const admission = enrollment();
  const html = renderToStaticMarkup(<PokerEnrollmentReview enrollment={admission} localSeat={1} />);
  for (const seat of admission.reviewTerms.seats) {
    expect(html).toContain(seat.wallet); expect(html).toContain(seat.signingKey);
  }
  expect(html).toContain(admission.sessionId); expect(html).toContain('2 (you)');
  expect(html).toContain('&lt;script&gt;host text&lt;/script&gt;');
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<button');
  expect(admission.missingSeats).toEqual([0, 1]);
});
it('refuses an invalid local seat rather than showing another player as the local signer', () => {
  const admission = enrollment();
  for (const localSeat of [-1, 2, 0.5]) expect(() => renderToStaticMarkup(
    <PokerEnrollmentReview enrollment={admission} localSeat={localSeat} />)).toThrow('poker_review:seat');
});

it('summarizes chip stacks and blinds only from an exactly reconstructed Poker genesis', () => {
  const replay = new PokerDealtBettingReplay({ stacks: [300, 500], dealer: 1, smallBlind: 2, bigBlind: 4 });
  const base = enrollment().reviewTerms;
  const { nonce, handId, rulesHash, chainId, settler } = base;
  const config = { nonce, handId, rulesHash, chainId, settler, roster: base.seats.map(seat => seat.signingKey) };
  const admission = new PokerHistoryEnrollment(config,
    replay.genesisJSON, replay.replay, base.seats.map(seat => seat.wallet));
  const html = renderToStaticMarkup(<PokerEnrollmentReview enrollment={admission} localSeat={0} />);
  expect(html).toContain('Starting chips by seat: 300 / 500');
  expect(html).toContain('Blinds: 2 / 4'); expect(html).toContain('Dealer: seat 2');
  const altered = JSON.parse(replay.genesisJSON); altered.betting.pot++;
  const lookalike = new PokerHistoryEnrollment(config,
    JSON.stringify(altered), state => state, base.seats.map(seat => seat.wallet));
  expect(renderToStaticMarkup(<PokerEnrollmentReview enrollment={lookalike} localSeat={0} />))
    .toContain('does not recognize the initial game state');
});
