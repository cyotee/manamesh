import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
import { afterEach, expect, it, vi } from 'vitest';
import { VerifiedPokerHistory, PokerHistorySigner, createPublicPokerBettingGenesis, replayPublicPokerBetting } from '@manamesh/poker/verified-history';
import { PokerHistoryChannel, POKER_HISTORY_CHANNEL } from './poker-history-channel';

class Channel extends EventTarget {
  label = POKER_HISTORY_CHANNEL;
  ordered = true;
  maxPacketLifeTime = null;
  maxRetransmits = null;
  readyState = 'open';
  bufferedAmount = 0;
  sent: string[] = [];
  send(wire: string) { this.sent.push(wire); }
  receive(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
}
const adapters: PokerHistoryChannel[] = [];
afterEach(() => { adapters.splice(0).forEach(adapter => adapter.dispose()); vi.useRealTimers(); });
function fixture(append = vi.fn().mockResolvedValue({ sequence: 1, head: '0x00', stateJSON: '{}' })) {
  const channel = new Channel();
  const adapter = new PokerHistoryChannel(channel as unknown as RTCDataChannel, { append, checkpoint: { head: '0x00' } } as unknown as VerifiedPokerHistory);
  adapters.push(adapter);
  const rejected: string[] = [];
  adapter.addEventListener('rejected', event => rejected.push((event as CustomEvent<Error>).detail.message));
  return { channel, adapter, append, rejected };
}
const frame = (chunk: string, index = 0, count = 1) => JSON.stringify({ version: 1, id: 'a'.repeat(32), index, count, chunk });

it('reassembles Unicode exactly when a surrogate pair crosses the chunk boundary', () => {
  const sender = fixture(); const receiver = fixture();
  const wire = JSON.stringify([{ x: 'a'.repeat(4088) + '😀'.repeat(3000) }]);
  sender.adapter.sendBatch(wire);
  expect(sender.channel.sent.length).toBeGreaterThan(1);
  sender.channel.sent.forEach(part => receiver.channel.receive(part));
  expect(receiver.append).toHaveBeenCalledTimes(1);
  expect(receiver.append).toHaveBeenCalledWith(wire);
});

it('times out an incomplete transfer and accepts a new complete transfer', () => {
  vi.useFakeTimers();
  const f = fixture();
  f.channel.receive(frame(' '.repeat(4096), 0, 2));
  vi.advanceTimersByTime(30_000);
  expect(f.rejected).toEqual(['poker_channel:fragment_timeout']);
  expect(f.append).not.toHaveBeenCalled();
  f.channel.receive(frame('[]'));
  expect(f.append).toHaveBeenCalledTimes(1);
  expect(f.append).toHaveBeenCalledWith('[]');
});

it('queues honest consecutive messages and verifies them in wire order', async () => {
  let finish!: (value: unknown) => void;
  const append = vi.fn().mockResolvedValue({ sequence: 2 }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const f = fixture(append);
  f.channel.receive(frame('[1]')); f.channel.receive(frame('[2]')); f.channel.receive(frame('[3]'));
  expect(append).toHaveBeenCalledTimes(1);
  expect(f.rejected).toEqual([]);
  finish({ sequence: 1 });
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(3));
  expect(append.mock.calls.map(call => call[0])).toEqual(['[1]', '[2]', '[3]']);
});

it('bounds queued message count and drops pending work on overflow', async () => {
  let finish!: (value: unknown) => void;
  const append = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const f = fixture(append);
  f.channel.receive(frame('[]'));
  for (let i = 0; i < 8; i++) f.channel.receive(frame('[]'));
  expect(f.rejected).toEqual([]);
  f.channel.receive(frame('[]'));
  expect(f.rejected).toEqual(['poker_channel:receive_overflow']);
  expect(f.adapter.closed).toBe(true);
  finish({ sequence: 1 });
  await Promise.resolve(); await Promise.resolve();
  expect(append).toHaveBeenCalledTimes(1);
});

it('bounds queued UTF-8 bytes independently of message count', () => {
  const sender = fixture(); const receiver = fixture(vi.fn(() => new Promise(() => {})));
  receiver.channel.receive(frame('[]'));
  const wire = JSON.stringify(['a'.repeat(600_000)]);
  for (let batch = 0; batch < 2; batch++) {
    sender.channel.sent.length = 0; sender.adapter.sendBatch(wire);
    sender.channel.sent.forEach(part => receiver.channel.receive(part));
  }
  expect(receiver.rejected).toEqual(['poker_channel:receive_overflow']);
  expect(receiver.append).toHaveBeenCalledTimes(1);
  expect(receiver.adapter.closed).toBe(true);
});

it('does not run queued verification after disposal', async () => {
  let finish!: (value: unknown) => void;
  const f = fixture(vi.fn(() => new Promise(resolve => { finish = resolve; })));
  f.channel.receive(frame('[1]')); f.channel.receive(frame('[2]'));
  f.adapter.dispose(); finish({ sequence: 1 });
  await Promise.resolve(); await Promise.resolve();
  expect(f.append).toHaveBeenCalledTimes(1);
});

it('rejects oversized, binary, out-of-order and unknown-field input before verification', () => {
  const f = fixture();
  for (const data of ['x'.repeat(32 * 1024 + 1), new ArrayBuffer(4), frame('[]', 1, 2),
    JSON.stringify({ ...JSON.parse(frame('[]')), state: {} }),
    JSON.stringify({ ...JSON.parse(frame('[]')), count: 257 })]) {
    f.channel.receive(data);
  }
  expect(f.rejected).toHaveLength(5);
  expect(f.append).not.toHaveBeenCalled();
});

it('applies send backpressure before queuing any frames', () => {
  const f = fixture();
  f.channel.bufferedAmount = 4 * 1024 * 1024;
  expect(() => f.adapter.sendBatch('[]')).toThrow('backpressure');
  expect(f.channel.sent).toHaveLength(0);
});

it('cleans up partial input on channel close and rejects subsequent sends', () => {
  vi.useFakeTimers();
  const f = fixture();
  f.channel.receive(frame(' '.repeat(4096), 0, 2));
  f.channel.dispatchEvent(new Event('close'));
  expect(f.rejected).toEqual(['poker_channel:incomplete_on_close']);
  expect(vi.getTimerCount()).toBe(0);
  expect(() => f.adapter.sendBatch('[]')).toThrow('closed');
  f.channel.receive(frame('[]'));
  expect(f.append).not.toHaveBeenCalled();
});


it('rejects unsolicited acknowledgments and unknown message types without advancing history', async () => {
  const f = fixture();
  f.channel.receive(frame(JSON.stringify({ type: 'acknowledgment', wireJSON: '{}' })));
  await vi.waitFor(() => expect(f.rejected).toContain('poker_channel:no_proposal'));
  f.channel.receive(frame(JSON.stringify({ type: 'snapshot', wireJSON: '{}' })));
  await vi.waitFor(() => expect(f.rejected).toContain('poker_channel:message_type'));
  expect(f.append).not.toHaveBeenCalled();
});

it('bounds outbound acknowledgment envelopes before writing to the channel', () => {
  const f = fixture();
  expect(() => f.adapter.sendAcknowledgment('😀'.repeat(1025))).toThrow('ack_size');
  expect(f.channel.sent).toHaveLength(0);
});


it.each([3, 4, 5])('collects all %i seats across separate peer links to the same local history', async seats => {
  const hash = (text: string) => keccak256(toHex(text));
  const accounts = Array.from({ length: seats }, () => privateKeyToAccount(generatePrivateKey()));
  const config = { nonce: hash('links'), handId: hash('hand'), rulesHash: hash('rules'), chainId: 31337,
    settler: accounts[0].address, roster: accounts.map(account => account.address) };
  const genesis = createPublicPokerBettingGenesis({ stacks: Array(seats).fill(100), dealer: 0, smallBlind: 1, bigBlind: 2 });
  const histories = accounts.map(() => new VerifiedPokerHistory(config, genesis, replayPublicPokerBetting));
  const signers = accounts.map((account, seat) => new PokerHistorySigner(histories[seat], seat, account,
    { claim: vi.fn().mockResolvedValue(undefined) }, { sessionId: histories[seat].sessionId, signer: account.address, journalId: hash(String(seat)) }));
  const links = accounts.slice(1).map(() => {
    const wire = new Channel();
    const adapter = new PokerHistoryChannel(wire as unknown as RTCDataChannel, histories[0]);
    adapters.push(adapter);
    return { wire, adapter };
  });
  const actor = JSON.parse(genesis).round.activeSeat;
  const proposal = JSON.stringify(await signers[actor].propose('{"move":"call"}'));
  // Test journal intentionally allows this hostile actor to sign a rival action.
  const rival = JSON.stringify(await signers[actor].propose('{"move":"fold"}'));
  const concurrent = await Promise.allSettled([
    links[0].adapter.sendProposal(proposal), links[1].adapter.sendProposal(rival),
  ]);
  expect(concurrent[0].status).toBe('fulfilled');
  expect(concurrent[1].status).toBe('rejected');
  if (concurrent[1].status === 'rejected') expect(concurrent[1].reason.message).toContain('proposal_pending');
  const rounds = await Promise.all(links.map(link => link.adapter.sendProposal(proposal)));
  expect(rounds.every(round => round === rounds[0])).toBe(true);
  const otherWire = new Channel();
  const other = new PokerHistoryChannel(otherWire as unknown as RTCDataChannel, histories[1]);
  adapters.push(other);
  expect(await other.sendProposal(proposal)).not.toBe(rounds[0]);
  const votes = await Promise.all(signers.map(signer => signer.acknowledge(proposal)));
  await rounds[0].addAcknowledgment(JSON.stringify(votes[0]));
  for (let seat = 1; seat < seats; seat++) {
    links[seat - 1].wire.receive(frame(JSON.stringify({ type: 'acknowledgment', wireJSON: JSON.stringify(votes[seat]) })));
  }
  await vi.waitFor(() => expect(rounds[0].missingSeats).toEqual([]));
  // Losing one socket must not erase votes accepted through the other sockets.
  links[0].adapter.dispose();
  expect(links[1].adapter.pendingProposal).toBe(rounds[0]);
  const batch = rounds[0].batchJSON();
  const checkpoint = await rounds[0].commit();
  expect(links[1].adapter.pendingProposal).toBeUndefined();
  for (const history of histories.slice(1)) expect(await history.append(batch)).toEqual(checkpoint);
});
it.each(['close', 'error', 'dispose'])('emits one terminal event on %s and refuses subsequent sends', mode => {
  const f = fixture(); const closed = vi.fn();
  f.adapter.addEventListener('closed', closed);
  if (mode === 'dispose') f.adapter.dispose(); else f.channel.dispatchEvent(new Event(mode));
  expect(f.adapter.closed).toBe(true);
  expect(closed).toHaveBeenCalledTimes(1);
  expect((closed.mock.calls[0][0] as CustomEvent<Error>).detail.message).toBe(`poker_channel:${mode === 'close' ? 'closed' : mode === 'dispose' ? 'disposed' : 'error'}`);
  f.adapter.dispose(); f.channel.dispatchEvent(new Event('close'));
  expect(closed).toHaveBeenCalledTimes(1);
  expect(() => f.adapter.sendBatch('[]')).toThrow('closed');
  f.channel.receive(frame('[]')); expect(f.append).not.toHaveBeenCalled();
});
it('emits artifact acceptance only after the registered verifier finishes', async () => {
  const sender = fixture(), receiver = fixture();
  let finish!: () => void;
  sender.adapter.setArtifactVerifier(async () => {});
  const verify = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  receiver.adapter.setArtifactVerifier(verify);
  const accepted = vi.fn(); receiver.adapter.addEventListener('artifact', accepted);
  const wire = JSON.stringify({ proof: 'a'.repeat(18000) });
  sender.adapter.sendArtifact(wire);
  sender.channel.sent.forEach(part => receiver.channel.receive(part));
  expect(verify).toHaveBeenCalledWith(wire); expect(accepted).not.toHaveBeenCalled();
  finish(); await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
  expect(receiver.append).not.toHaveBeenCalled();
});
it('closes on failed artifact verification without emitting acceptance or importing history', async () => {
  const sender = fixture(), receiver = fixture();
  sender.adapter.setArtifactVerifier(async () => {});
  receiver.adapter.setArtifactVerifier(async () => { throw new Error('invalid_proof'); });
  const accepted = vi.fn(); receiver.adapter.addEventListener('artifact', accepted);
  sender.adapter.sendArtifact('{}'); sender.channel.sent.forEach(part => receiver.channel.receive(part));
  await vi.waitFor(() => expect(receiver.adapter.closed).toBe(true));
  expect(receiver.rejected).toEqual(['invalid_proof']); expect(accepted).not.toHaveBeenCalled();
  expect(receiver.append).not.toHaveBeenCalled();
});
it('refuses artifact traffic without a verifier and bounds outgoing artifacts', async () => {
  const f = fixture(); expect(() => f.adapter.sendArtifact('{}')).toThrow('artifact_unavailable');
  f.adapter.setArtifactVerifier(async () => {});
  expect(() => f.adapter.setArtifactVerifier(async () => {})).toThrow('artifact_registration');
  expect(() => f.adapter.sendArtifact(JSON.stringify('x'.repeat(32768)))).toThrow('artifact_size');
  expect(f.channel.sent).toHaveLength(0);
  const receiver = fixture();
  f.adapter.sendArtifact('{}'); f.channel.sent.forEach(part => receiver.channel.receive(part));
  await vi.waitFor(() => expect(receiver.adapter.closed).toBe(true));
});
it('does not accept a verified artifact after its local checkpoint changes', async () => {
  const sender = fixture(); sender.adapter.setArtifactVerifier(async () => {});
  const raw = new Channel();
  const state = { checkpoint: { head: 'before' } };
  const receiver = new PokerHistoryChannel(raw as unknown as RTCDataChannel, state as unknown as VerifiedPokerHistory);
  adapters.push(receiver);
  let finish!: () => void;
  receiver.setArtifactVerifier(() => new Promise<void>(resolve => { finish = resolve; }));
  const accepted = vi.fn(); receiver.addEventListener('artifact', accepted);
  const rejected = vi.fn(); receiver.addEventListener('rejected', rejected);
  sender.adapter.sendArtifact('{}'); sender.channel.sent.forEach(part => raw.receive(part));
  state.checkpoint.head = 'after'; finish();
  await vi.waitFor(() => expect(receiver.closed).toBe(true));
  expect(accepted).not.toHaveBeenCalled();
  expect((rejected.mock.calls[0][0] as CustomEvent<Error>).detail.message).toContain('stale_artifact');
});
