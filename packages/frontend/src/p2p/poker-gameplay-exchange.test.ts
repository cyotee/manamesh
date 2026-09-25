import { afterEach, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
import { VerifiedPokerHistory, PokerHistorySigner, createPublicPokerBettingGenesis, replayPublicPokerBetting } from '@manamesh/poker/verified-history';
import { PokerHistoryChannel, POKER_HISTORY_CHANNEL } from './poker-history-channel';
import { PokerGameplayExchange } from './poker-gameplay-exchange';

class Wire extends EventTarget {
  label = POKER_HISTORY_CHANNEL; ordered = true; maxPacketLifeTime = null; maxRetransmits = null;
  readyState = 'open'; bufferedAmount = 0; peer!: Wire;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
    setTimeout(() => { if (this.peer.readyState === 'open') this.peer.dispatchEvent(new MessageEvent('message', { data })); }, 0);
  }
  close() {
    this.readyState = 'closed'; this.dispatchEvent(new Event('close'));
    if (this.peer.readyState !== 'closed') this.peer.close();
  }
}
const exchanges: PokerGameplayExchange[] = [];
afterEach(() => exchanges.splice(0).forEach(exchange => exchange.dispose()));
function fixture(seats: number) {
  const hash = (s: string) => keccak256(toHex(s));
  const accounts = Array.from({ length: seats }, () => privateKeyToAccount(generatePrivateKey()));
  const config = { nonce: hash('gameplay'), handId: hash('hand'), rulesHash: hash('rules'), chainId: 31337,
    settler: accounts[0].address, roster: accounts.map(account => account.address) };
  const genesis = createPublicPokerBettingGenesis({ stacks: Array(seats).fill(100), dealer: 0, smallBlind: 1, bigBlind: 2 });
  const histories = accounts.map(() => new VerifiedPokerHistory(config, genesis, replayPublicPokerBetting));
  const claims = accounts.map(() => vi.fn().mockResolvedValue(undefined));
  const signers = accounts.map((account, seat) => new PokerHistorySigner(histories[seat], seat, account,
    { claim: claims[seat] }, { sessionId: histories[seat].sessionId, signer: account.address, journalId: hash(String(seat)) }));
  const links = accounts.map(() => new Map<number, PokerHistoryChannel>());
  const wires: Wire[][] = [];
  for (let seat = 1; seat < seats; seat++) {
    const a = new Wire(); const b = new Wire(); a.peer = b; b.peer = a;
    links[0].set(seat, new PokerHistoryChannel(a as unknown as RTCDataChannel, histories[0]));
    links[seat].set(0, new PokerHistoryChannel(b as unknown as RTCDataChannel, histories[seat]));
    // The real join-session owner closes the physical link when its adapter
    // closes; reproduce that lifecycle around these in-memory wire endpoints.
    links[0].get(seat)!.addEventListener('closed', () => a.close());
    links[seat].get(0)!.addEventListener('closed', () => b.close());
    wires.push([a, b]);
  }
  const table = links.map((link, seat) => new PokerGameplayExchange(link, histories[seat], signers[seat], seat));
  exchanges.push(...table);
  return { table, histories, signers, claims, links, wires };
}
const wait = async (check: () => void) => vi.waitFor(check, { timeout: 10000, interval: 10 });

it.each([2, 3, 4, 5])('delivers successive actions and unanimous checkpoints across %i independent seats', async seats => {
  const f = fixture(seats);
  for (let round = 0; round < 2; round++) {
    const state = JSON.parse(f.histories[0].checkpoint.stateJSON);
    const actor = state.round.activeSeat;
    await wait(() => expect(f.table[actor].canPropose).toBe(true));
    await f.table[actor].propose(JSON.stringify({ move: state.players[actor].bet < state.round.currentBet ? 'call' : 'check' }));
    await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
    // Only the actor's explicitly requested proposal has touched a journal.
    if (!round) expect(f.claims.map(claim => claim.mock.calls.length)).toEqual(f.claims.map((_, seat) => seat === actor ? 1 : 0));
    for (let seat = 0; seat < seats - 1; seat++) await f.table[seat].acknowledge();
    await wait(() => expect(f.table[0].missingSeats).toEqual([seats - 1]));
    await expect(f.table[0].commit()).rejects.toThrow('missing_acknowledgments');
    expect(f.histories.every(history => history.checkpoint.sequence === round)).toBe(true);
    await f.table[seats - 1].acknowledge();
    await wait(() => expect(f.table[0].missingSeats).toEqual([]));
    await f.table[0].commit();
    await wait(() => expect(f.histories.every(history => history.checkpoint.sequence === round + 1)).toBe(true));
    expect(new Set(f.histories.map(history => history.checkpoint.head)).size).toBe(1);
    expect(f.table.every(exchange => !exchange.proposalReady)).toBe(true);
  }
});

it('requires a received proposal before acknowledgment and reserves commitment to the relay', async () => {
  const f = fixture(3);
  await expect(f.table[1].acknowledge()).rejects.toThrow('proposal_not_ready');
  await expect(f.table[1].commit()).rejects.toThrow('relay_only');
  expect(f.claims.every(claim => claim.mock.calls.length === 0)).toBe(true);
});

it('refuses a forged guest acknowledgment without forwarding or advancing a checkpoint', async () => {
  const f = fixture(3);
  await f.table[0].propose('{"move":"call"}');
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  const proposal = f.links[1].get(0)!.pendingProposal!;
  const acknowledgment = await f.signers[1].acknowledge(proposal.proposalJSON);
  f.links[1].get(0)!.sendAcknowledgment(JSON.stringify({ ...acknowledgment, seat: 2 }));
  await wait(() => expect(f.table.every(exchange => exchange.closed)).toBe(true));
  expect(f.histories.every(history => history.checkpoint.sequence === 0)).toBe(true);
  expect(f.claims[2]).not.toHaveBeenCalled();
});

it('does not sign after local disposal or allow simultaneous local signing operations', async () => {
  const f = fixture(3);
  const pending = f.table[0].propose('{"move":"call"}');
  await expect(f.table[0].propose('{"move":"call"}')).rejects.toThrow('busy');
  await pending;
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  f.table[1].dispose();
  await expect(f.table[1].acknowledge()).rejects.toThrow('closed');
  expect(f.claims[1]).not.toHaveBeenCalled();
});

it('holds an early next actor until a slow peer has persisted the previous checkpoint', async () => {
  const f = fixture(3);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const append = f.histories[2].append.bind(f.histories[2]);
  vi.spyOn(f.histories[2], 'append').mockImplementationOnce(async wire => { await gate; return append(wire); });
  await f.table[0].propose('{"move":"call"}');
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  for (const exchange of f.table) await exchange.acknowledge();
  await wait(() => expect(f.table[0].missingSeats).toEqual([]));
  await f.table[0].commit();
  await wait(() => expect(f.histories[1].checkpoint.sequence).toBe(1));
  await expect(f.table[0].propose('{"move":"call"}')).rejects.toThrow('awaiting_peer_checkpoint');
  await f.table[1].propose('{"move":"call"}');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.table[1].proposalReady).toBe(false);
  expect(f.histories[2].checkpoint.sequence).toBe(0);
  expect(f.table.every(exchange => !exchange.closed)).toBe(true);
  release();
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  for (const exchange of f.table) await exchange.acknowledge();
  await wait(() => expect(f.table[0].missingSeats).toEqual([]));
  await f.table[0].commit();
  await wait(() => expect(f.histories.every(history => history.checkpoint.sequence === 2)).toBe(true));
});

it('does not count a transport receipt as a vote and refuses substituted checkpoint terms', async () => {
  const f = fixture(3);
  await f.table[0].propose('{"move":"call"}');
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  f.links[1].get(0)!.sendCheckpointReceipt();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(f.table[0].missingSeats).toEqual([0, 1, 2]);
  expect(f.claims[1]).not.toHaveBeenCalled();
  f.links[1].get(0)!.sendBatch(JSON.stringify({ type: 'checkpoint-receipt', wireJSON: JSON.stringify({
    sessionId: f.histories[0].sessionId, sequence: 0, head: `0x${'ff'.repeat(32)}`,
  }) }));
  await wait(() => expect(f.table.every(exchange => exchange.closed)).toBe(true));
  expect(f.histories.every(history => history.checkpoint.sequence === 0)).toBe(true);
});

it('closes all links after a proposal is only partially queued and retains the send failure', async () => {
  const f = fixture(3);
  vi.spyOn(f.wires[1][0], 'send').mockImplementation(() => { throw new Error('simulated_send_failure'); });
  await expect(f.table[0].propose('{"move":"call"}')).rejects.toThrow('simulated_send_failure');
  await wait(() => expect(f.table.every(exchange => exchange.closed)).toBe(true));
  expect(f.table[0].closeReason).toBe('simulated_send_failure');
  expect(f.histories.every(history => history.checkpoint.sequence === 0)).toBe(true);
  expect(f.claims.slice(1).every(claim => claim.mock.calls.length === 0)).toBe(true);
  f.table[0].dispose();
  expect(f.table[0].closeReason).toBe('simulated_send_failure');
});

it('closes after an acknowledgment cannot be sent and prevents another signing call', async () => {
  const f = fixture(3);
  await f.table[0].propose('{"move":"call"}');
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  vi.spyOn(f.wires[0][1], 'send').mockImplementation(() => { throw new Error('ack_send_failure'); });
  await expect(f.table[1].acknowledge()).rejects.toThrow('ack_send_failure');
  const calls = f.claims[1].mock.calls.length;
  await expect(f.table[1].acknowledge()).rejects.toThrow('closed');
  expect(f.claims[1]).toHaveBeenCalledTimes(calls);
  expect(f.histories.every(history => history.checkpoint.sequence === 0)).toBe(true);
});

it('retains a committed local checkpoint when distribution fails and closes instead of continuing', async () => {
  const f = fixture(3);
  await f.table[0].propose('{"move":"call"}');
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  for (const exchange of f.table) await exchange.acknowledge();
  await wait(() => expect(f.table[0].missingSeats).toEqual([]));
  vi.spyOn(f.wires[1][0], 'send').mockImplementation(() => { throw new Error('batch_send_failure'); });
  await expect(f.table[0].commit()).rejects.toThrow('batch_send_failure');
  expect(f.histories[0].checkpoint.sequence).toBe(1);
  expect(f.table[0].closeReason).toBe('batch_send_failure');
  expect(f.table[0].canPropose).toBe(false);
  await wait(() => expect(f.table.every(exchange => exchange.closed)).toBe(true));
});

it('keeps recoverable local validation and persistence failures separate from delivery failure', async () => {
  const f = fixture(3);
  await expect(f.table[0].propose('{"move":"invented"}')).rejects.toThrow('action');
  expect(f.table[0].closed).toBe(false);
  expect(f.claims[0]).not.toHaveBeenCalled();
  await f.table[0].propose('{"move":"call"}');
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  for (const exchange of f.table) await exchange.acknowledge();
  await wait(() => expect(f.table[0].missingSeats).toEqual([]));
  vi.spyOn(f.histories[0], 'append').mockRejectedValueOnce(new Error('persistence_unavailable'));
  await expect(f.table[0].commit()).rejects.toThrow('persistence_unavailable');
  expect(f.histories.every(history => history.checkpoint.sequence === 0)).toBe(true);
  expect(f.table[0].closed).toBe(false);
  await f.table[0].commit();
  await wait(() => expect(f.histories.every(history => history.checkpoint.sequence === 1)).toBe(true));
});

it('binds UI reviews to exact proposals/checkpoints before claims or commits', async () => {
  const f = fixture(2);
  const actor = JSON.parse(f.histories[0].checkpoint.stateJSON).round.activeSeat;
  await expect(f.table[actor].propose('{"move":"call"}', 'stale-head')).rejects.toThrow('review_changed');
  expect(f.claims.every(claim => claim.mock.calls.length === 0)).toBe(true);
  await f.table[actor].propose('{"move":"call"}', f.histories[actor].checkpoint.head);
  await wait(() => expect(f.table.every(exchange => exchange.proposalReady)).toBe(true));
  const review = f.table[0].proposalForReview!;
  expect(review).toBe(f.table[1].proposalForReview);
  const before = f.claims.map(claim => claim.mock.calls.length);
  await expect(f.table[1].acknowledge(`${review} `)).rejects.toThrow('review_changed');
  expect(f.claims.map(claim => claim.mock.calls.length)).toEqual(before);
  for (const exchange of f.table) await exchange.acknowledge(review);
  await wait(() => expect(f.table[0].missingSeats).toEqual([]));
  await expect(f.table[0].commit(`${review} `)).rejects.toThrow('review_changed');
  expect(f.histories[0].checkpoint.sequence).toBe(0);
  await f.table[0].commit(review);
  await wait(() => expect(f.table.every(exchange => !exchange.proposalReady)).toBe(true));
  expect(f.table.every(exchange => exchange.proposalForReview === undefined)).toBe(true);
});
