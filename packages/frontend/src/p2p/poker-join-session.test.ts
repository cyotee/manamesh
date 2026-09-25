import { afterEach, expect, it, vi } from 'vitest';
import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import { connectPokerHistory } from './poker-join-session';
import { POKER_HISTORY_CHANNEL } from './poker-history-channel';
class Channel extends EventTarget {
  label = POKER_HISTORY_CHANNEL;
  readyState = 'open'; ordered = true;
  maxPacketLifeTime = null; maxRetransmits = null; bufferedAmount = 0;
  sent: string[] = [];
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  receive(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
const sessions: ReturnType<typeof connectPokerHistory>[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); vi.useRealTimers(); });
function fixture(seat = 0) {
  let accept!: (channel: RTCDataChannel) => void;
  let signal!: (value: unknown) => void;
  const channel = new Channel();
  const remove = vi.fn(() => channel.close());
  const link = {
    isConnected: vi.fn(() => true),
    registerReliableChannel: vi.fn((_label: string, handler: typeof accept) => { accept = handler; return remove; }),
    openReliableChannel: vi.fn(() => { accept(channel as unknown as RTCDataChannel); return channel as unknown as RTCDataChannel; }),
    onSignal: vi.fn((handler: typeof signal) => { signal = handler; }), offSignal: vi.fn(), sendSignal: vi.fn(),
  };
  const state = { seatCount: 2, sessionId: `0x${'a'.repeat(64)}`, checkpoint: { head: `0x${'b'.repeat(64)}` }, append: vi.fn() };
  const session = connectPokerHistory(link, state as unknown as VerifiedPokerHistory, seat, 1 - seat);
  sessions.push(session);
  const registered = { ...link.sendSignal.mock.calls[0][0] as object, seat: 1 - seat, peerSeat: seat };
  const hello = { ...registered, type: 'hello', nonce: 'c'.repeat(32) };
  return { session, channel, link, state, remove, hello, registered, signal: (value: unknown) => signal(value), accept: () => accept(channel as unknown as RTCDataChannel) };
}
it('opens only after matching registration and resolves only after a two-way channel handshake', async () => {
  const f = fixture();
  f.signal({ ...f.registered, sessionId: 'wrong' });
  f.signal({ ...f.registered, seat: 0 });
  expect(f.link.openReliableChannel).not.toHaveBeenCalled();
  f.signal(f.registered);
  const localHello = JSON.parse(f.channel.sent[0]);
  f.channel.dispatchEvent(new Event('open'));
  expect(f.channel.sent).toHaveLength(1);
  let ready = false; void f.session.ready.then(() => { ready = true; });
  f.channel.receive(f.hello); await Promise.resolve(); expect(ready).toBe(false);
  f.channel.receive({ ...f.hello, type: 'ack', nonce: localHello.nonce });
  expect(await f.session.ready).toBeDefined();
  expect(f.state.append).not.toHaveBeenCalled();
  expect(f.link.offSignal).toHaveBeenCalled();
});
it('the responder never opens a second channel', async () => {
  const f = fixture(1); f.signal(f.registered);
  expect(f.link.openReliableChannel).not.toHaveBeenCalled();
  f.accept(); const localHello = JSON.parse(f.channel.sent[0]);
  f.channel.receive(f.hello); f.channel.receive({ ...f.hello, type: 'ack', nonce: localHello.nonce });
  await f.session.ready;
});
it.each(['sessionId', 'checkpoint', 'seat', 'nonce', 'extra'])('rejects mismatched or malformed %s before history processing', async field => {
  const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('handshake');
  f.signal(f.registered); f.channel.receive({ ...f.hello, [field]: 'invalid' });
  await rejected; expect(f.channel.readyState).toBe('closed'); expect(f.state.append).not.toHaveBeenCalled();
});
it('refuses an acknowledgment before receiving the peer hello', async () => {
  const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('handshake');
  f.signal(f.registered); const local = JSON.parse(f.channel.sent[0]);
  f.channel.receive({ ...f.hello, type: 'ack', nonce: local.nonce }); await rejected;
});
it('bounds waiting, stops retries on timeout and removes its registration', async () => {
  vi.useFakeTimers(); const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(20_000); await rejected;
  const count = f.link.sendSignal.mock.calls.length;
  expect(count).toBeLessThanOrEqual(41); await vi.advanceTimersByTimeAsync(20_000);
  expect(f.link.sendSignal).toHaveBeenCalledTimes(count); expect(f.remove).toHaveBeenCalledTimes(1);
});
it('fails when the local checkpoint changes during startup', async () => {
  vi.useFakeTimers(); const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('stale_or_closed');
  f.state.checkpoint.head = 'changed'; await vi.advanceTimersByTimeAsync(500); await rejected;
});
it('disposal while waiting closes the protocol and rejects readiness', async () => {
  const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('disposed');
  f.session.dispose(); await rejected; expect(f.remove).toHaveBeenCalledTimes(1);
});
it('rejects a replayed acknowledgment even after a valid hello', async () => {
  const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('handshake');
  f.signal(f.registered); f.channel.receive(f.hello);
  f.channel.receive({ ...f.hello, type: 'ack', nonce: 'd'.repeat(32) }); await rejected;
  expect(f.state.append).not.toHaveBeenCalled();
});
it('rejects ordinary history frames before readiness instead of processing them', async () => {
  const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('handshake');
  f.signal(f.registered); f.channel.receive([]); await rejected;
  expect(f.state.append).not.toHaveBeenCalled();
});
it('closing the dedicated channel before readiness rejects and cleans up', async () => {
  const f = fixture(); const rejected = expect(f.session.ready).rejects.toThrow('closed');
  f.signal(f.registered); f.channel.close(); await rejected;
  expect(f.remove).toHaveBeenCalledTimes(1);
});
it.each(['close', 'error', 'adapter', 'dispose'])('reports %s after readiness and disables further history sends', async mode => {
  const f = fixture(); f.signal(f.registered);
  const hello = JSON.parse(f.channel.sent[0]);
  f.channel.receive(f.hello); f.channel.receive({ ...f.hello, type: 'ack', nonce: hello.nonce });
  const adapter = await f.session.ready;
  expect(adapter.closed).toBe(false);
  if (mode === 'adapter') adapter.dispose();
  else if (mode === 'dispose') f.session.dispose();
  else f.channel.dispatchEvent(new Event(mode));
  const reason = await f.session.closed;
  expect(reason.message).toContain(mode === 'adapter' || mode === 'dispose' ? 'disposed' : mode === 'close' ? 'closed' : 'error');
  expect(adapter.closed).toBe(true);
  expect(() => adapter.sendBatch('[]')).toThrow('closed');
  expect(f.channel.readyState).toBe('closed');
  expect(f.remove).toHaveBeenCalledTimes(1);
  f.session.dispose(); expect(f.remove).toHaveBeenCalledTimes(1);
});
it('reports the same terminal timeout through readiness and the non-rejecting closed promise', async () => {
  vi.useFakeTimers(); const f = fixture();
  const rejected = f.session.ready.catch(error => error);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await f.session.closed).toBe(await rejected);
});

it('sends its hello before acknowledging a peer message delivered before the open callback', async () => {
  const f = fixture(1); void f.session.ready.catch(() => {});
  f.channel.readyState = 'connecting'; f.accept();
  expect(f.channel.sent).toEqual([]);
  // The underlying channel has opened, but its queued open callback has not run.
  f.channel.readyState = 'open'; f.channel.receive(f.hello);
  expect(f.channel.sent.map(wire => JSON.parse(wire).type)).toEqual(['hello', 'ack']);
  f.channel.dispatchEvent(new Event('open'));
  expect(f.channel.sent).toHaveLength(2);
  f.channel.receive({ ...f.hello, type: 'ack', nonce: JSON.parse(f.channel.sent[0]).nonce });
  await f.session.ready;
});
