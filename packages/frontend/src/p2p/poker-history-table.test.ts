import { afterEach, expect, it, vi } from 'vitest';
import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import { connectPokerHistoryTable } from './poker-history-table';
import { POKER_HISTORY_CHANNEL } from './poker-history-channel';
class Channel extends EventTarget {
  label = POKER_HISTORY_CHANNEL; readyState = 'open'; ordered = true;
  maxPacketLifeTime = null; maxRetransmits = null; bufferedAmount = 0;
  sent: string[] = [];
  send(wire: string) { this.sent.push(wire); }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  receive(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
function link() {
  const channel = new Channel();
  let accept!: (channel: RTCDataChannel) => void;
  let signal!: (value: unknown) => void;
  const remove = vi.fn(() => channel.close());
  const value = {
    isConnected: vi.fn(() => true),
    registerReliableChannel: vi.fn((_label: string, handler: typeof accept) => { accept = handler; return remove; }),
    openReliableChannel: vi.fn(() => { accept(channel as unknown as RTCDataChannel); return channel as unknown as RTCDataChannel; }),
    onSignal: vi.fn((handler: typeof signal) => { signal = handler; }), offSignal: vi.fn(), sendSignal: vi.fn(),
  };
  function finish() {
    const local = value.sendSignal.mock.calls[0][0] as Record<string, unknown>;
    const remote = { ...local, seat: local.peerSeat, peerSeat: local.seat };
    signal(remote);
    const hello = JSON.parse(channel.sent[0]);
    channel.receive({ ...remote, type: 'hello', nonce: 'c'.repeat(32) });
    channel.receive({ ...remote, type: 'ack', nonce: hello.nonce });
  }
  return { value, channel, remove, finish };
}
const tables: ReturnType<typeof connectPokerHistoryTable>[] = [];
afterEach(() => { tables.splice(0).forEach(table => table.dispose()); });
const history = (seatCount: number) => ({ seatCount, sessionId: `0x${'a'.repeat(64)}`, checkpoint: { head: `0x${'b'.repeat(64)}` } } as unknown as VerifiedPokerHistory);
it.each([2, 3, 4, 5])('waits for all %i-seat relay links and terminates them together', async seats => {
  const peers = Array.from({ length: seats - 1 }, () => link());
  const table = connectPokerHistoryTable(new Map(peers.map((peer, index) => [index + 1, peer.value])), history(seats), 0);
  tables.push(table);
  let ready = false; void table.ready.then(() => { ready = true; });
  for (const peer of peers.slice(0, -1)) peer.finish();
  await Promise.resolve(); await Promise.resolve(); expect(ready).toBe(false);
  peers.at(-1)!.finish();
  const channels = await table.ready;
  expect(channels.map(entry => entry.seat)).toEqual(Array.from({ length: seats - 1 }, (_, index) => index + 1));
  expect(Object.isFrozen(channels)).toBe(true);
  peers[0].channel.close();
  expect((await table.closed).message).toContain('peer_1');
  for (const [index, peer] of peers.entries()) {
    expect(peer.remove).toHaveBeenCalledTimes(1);
    expect(channels[index].channel.closed).toBe(true);
    expect(() => channels[index].channel.sendBatch('[]')).toThrow('closed');
  }
});
it('rejects missing, extra and reused links before any registration', () => {
  const first = link(), second = link();
  for (const links of [new Map([[1, first.value]]), new Map([[1, first.value], [3, second.value]]), new Map([[1, first.value], [2, first.value]])]) {
    expect(() => connectPokerHistoryTable(links, history(3), 0)).toThrow('topology');
  }
  expect(first.value.registerReliableChannel).not.toHaveBeenCalled();
  expect(second.value.registerReliableChannel).not.toHaveBeenCalled();
});
it('guests accept only the designated relay link', () => {
  const peer = link();
  expect(() => connectPokerHistoryTable(new Map([[2, peer.value]]), history(3), 1)).toThrow('topology');
  expect(peer.value.registerReliableChannel).not.toHaveBeenCalled();
});
it('cleans up already-started peers when another link disconnects during startup', async () => {
  const first = link(), second = link();
  second.value.isConnected.mockReturnValueOnce(true).mockReturnValue(false);
  const table = connectPokerHistoryTable(new Map([[1, first.value], [2, second.value]]), history(3), 0); tables.push(table);
  await expect(table.ready).rejects.toThrow('not_connected');
  expect((await table.closed).message).toContain('not_connected');
  expect(first.remove).toHaveBeenCalledTimes(1);
  expect(second.value.registerReliableChannel).not.toHaveBeenCalled();
});
it('disposal during readiness rejects without leaving peer timers or registrations', async () => {
  const peer = link(); const table = connectPokerHistoryTable(new Map([[1, peer.value]]), history(2), 0); tables.push(table);
  table.dispose(); await expect(table.ready).rejects.toThrow('disposed');
  expect((await table.closed).message).toBe('poker_table:disposed');
  expect(peer.remove).toHaveBeenCalledTimes(1);
});
