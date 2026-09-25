import React from 'react';
import { PokerDealtBettingReplay, type PokerHistoryEnrollment } from '@manamesh/poker/verified-history';

export function pokerTerms(genesisJSON: string, seats: number) {
  try {
    const value = JSON.parse(genesisJSON);
    if (value.version !== 5 || value.phase !== 'awaitingDeal' || !Array.isArray(value.betting?.players)
      || value.betting.players.length !== seats || !Number.isInteger(value.dealer) || value.dealer < 0 || value.dealer >= seats) return undefined;
    const smallSeat = seats === 2 ? value.dealer : (value.dealer + 1) % seats;
    const options = { dealer: value.dealer as number, smallBlind: value.betting.players[smallSeat].bet as number,
      bigBlind: value.betting.bigBlind as number,
      stacks: value.betting.players.map((player: { chips: number; bet: number }) => player.chips + player.bet) as number[] };
    // Show a poker summary only if recreating those terms gives the exact bound
    // genesis. A lookalike JSON object must not acquire a misleading summary.
    if (new PokerDealtBettingReplay(options).genesisJSON !== genesisJSON) return undefined;
    return options;
  } catch { return undefined; }
}

/** Read-only public review. No wallet request, signing, or peer input is performed. */
export function PokerEnrollmentReview({ enrollment, localSeat }: {
  enrollment: PokerHistoryEnrollment; localSeat: number;
}) {
  const terms = enrollment.reviewTerms;
  const game = pokerTerms(terms.genesisJSON, terms.seats.length);
  if (!Number.isInteger(localSeat) || !terms.seats[localSeat]) throw new Error('poker_review:seat');
  return <section aria-label="Poker session review">
    <h2>Review this Poker session</h2>
    <p>Check every wallet and signing identity with the other players before approving this session.</p>
    <p>You are seat {localSeat + 1}. Session approval authorizes an off-chain signing identity; it does not transfer funds or approve a settlement.</p>
    {game ? <p>Starting chips by seat: {game.stacks.join(' / ')}. Blinds: {game.smallBlind} / {game.bigBlind}.
      {' '}Dealer: seat {game.dealer + 1}.</p> : <p>This review does not recognize the initial game state. Inspect the exact state below.</p>}
    <dl>
      <dt>Chain ID</dt><dd>{terms.chainId}</dd>
      <dt>Settlement domain address</dt><dd><code>{terms.settler}</code></dd>
      <dt>Hand ID</dt><dd><code>{terms.handId}</code></dd>
      <dt>Session fingerprint</dt><dd><code>{terms.sessionId}</code></dd>
      <dt>Rules fingerprint</dt><dd><code>{terms.rulesHash}</code></dd>
    </dl>
    <table>
      <caption>Players and their session signing identities</caption>
      <thead><tr><th scope="col">Seat</th><th scope="col">Wallet</th><th scope="col">Session signing identity</th></tr></thead>
      <tbody>{terms.seats.map(seat => <tr key={seat.seat}>
        <th scope="row">{seat.seat + 1}{seat.seat === localSeat ? ' (you)' : ''}</th>
        <td><code>{seat.wallet}</code></td><td><code>{seat.signingKey}</code></td>
      </tr>)}</tbody>
    </table>
    <details><summary>Exact initial public state</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{terms.genesisJSON}</pre></details>
  </section>;
}
