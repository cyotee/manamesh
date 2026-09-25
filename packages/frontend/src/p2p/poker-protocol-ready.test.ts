import { afterEach, expect, it, vi } from 'vitest';
import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import { awaitPokerProtocolReady } from './poker-protocol-ready';
class Link {
  connected = true; peer!: Link; sent: unknown[] = [];
  handlers = new Set<(value: unknown) => void>();
  isConnected() { return this.connected; }
  onSignal(handler: (value: unknown) => void) { this.handlers.add(handler); }
  offSignal(handler: (value: unknown) => void) { this.handlers.delete(handler); }
  sendSignal(value: unknown) { this.sent.push(value); setTimeout(() => this.peer.handlers.forEach(handler => handler(value)), 0); }
}
const barriers: ReturnType<typeof awaitPokerProtocolReady>[] = [];
afterEach(() => { barriers.splice(0).forEach(barrier => barrier.dispose()); vi.useRealTimers(); });
function fixture(seats: number) {
  const history = { sessionId: `0x${'a'.repeat(64)}`, checkpoint: { head: `0x${'b'.repeat(64)}` }, seatCount: seats } as unknown as VerifiedPokerHistory;
  const links = Array.from({ length: seats }, () => new Map<number, Link>());
  for (let seat = 1; seat < seats; seat++) {
    const a = new Link(); const b = new Link(); a.peer = b; b.peer = a;
    links[0].set(seat, a); links[seat].set(0, b);
  }
  const start = (seat: number, scope = 'handlers') => {
    const barrier = awaitPokerProtocolReady(links[seat], history, seat, 0, scope);
    void barrier.ready.catch(() => {}); barriers.push(barrier); return barrier;
  };
  return { history, links, start };
}
it.each([2, 3, 4, 5])('releases every %i-seat peer only after all handler registrations are announced', async seats => {
  const f = fixture(seats); const values = Array.from({ length: seats }, (_, seat) => f.start(seat));
  await Promise.all(values.map(value => value.ready));
  expect(f.links.every(links => [...links.values()].every(link => link.handlers.size === 0))).toBe(true);
});
it('holds an early guest until the late guest and relay have installed handlers', async () => {
  const f = fixture(3); const early = f.start(1); let ready = false;
  void early.ready.then(() => { ready = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); expect(ready).toBe(false);
  const relay = f.start(0);
  await new Promise(resolve => setTimeout(resolve, 20)); expect(ready).toBe(false);
  const late = f.start(2);
  await Promise.all([early.ready, relay.ready, late.ready]); expect(ready).toBe(true);
});
it('rejects a replayed go message that does not echo this instance nonce', async () => {
  const f = fixture(2); const guest = f.start(1);
  const installed = f.links[1].get(0)!.sent[0] as Record<string, unknown>;
  f.links[0].get(1)!.sendSignal({ ...installed, type: 'go', seat: 0, peerSeat: 1, nonce: '1'.repeat(32), peerNonce: installed.nonce === '0'.repeat(32) ? '2'.repeat(32) : '0'.repeat(32) });
  await expect(guest.ready).rejects.toThrow('nonce_or_type');
  expect(f.links[1].get(0)!.handlers.size).toBe(0);
});
it('cleans up and rejects when disposed during startup', async () => {
  const f = fixture(2); const guest = f.start(1); guest.dispose();
  await expect(guest.ready).rejects.toThrow('disposed');
  expect(f.links[1].get(0)!.handlers.size).toBe(0);
});
it('times out missing readiness and removes retry timers', async () => {
  vi.useFakeTimers(); const f = fixture(2); const guest = f.start(1);
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(guest.ready).rejects.toThrow('timeout');
  expect(f.links[1].get(0)!.handlers.size).toBe(0);
  const sends = f.links[1].get(0)!.sent.length;
  // Drain the fake transport's already queued delivery, then prove no retry remains.
  await vi.advanceTimersByTimeAsync(500);
  expect(f.links[1].get(0)!.sent.length).toBe(sends); expect(vi.getTimerCount()).toBe(0);
});

it('ignores previous-stage traffic at the same head while waiting for local-stage peers', async () => {
  const f = fixture(2);
  await Promise.all([f.start(0, 'roster-approved').ready, f.start(1, 'roster-approved').ready]);
  const previous = f.links[1].get(0)!.sent[0];
  const relay = f.start(0, 'deck-approved');
  let released = false;
  void relay.ready.then(() => { released = true; });
  f.links[1].get(0)!.sendSignal(previous);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(released).toBe(false);
  const guest = f.start(1, 'deck-approved');
  await Promise.all([relay.ready, guest.ready]);
  expect(released).toBe(true);
});
it('does not release a guest on a different-stage go even with its current nonce', async () => {
  const f = fixture(2); const guest = f.start(1, 'private:0');
  const installed = f.links[1].get(0)!.sent[0] as Record<string, unknown>;
  let released = false;
  void guest.ready.then(() => { released = true; });
  f.links[0].get(1)!.sendSignal({ ...installed, scope: 'deck-approved', type: 'go', seat: 0, peerSeat: 1, nonce: '1'.repeat(32), peerNonce: installed.nonce });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(released).toBe(false);
  await Promise.all([guest.ready, f.start(0, 'private:0').ready]);
});
it.each(['', 'a'.repeat(65), 'Deck approved', 'private/0'])('rejects invalid local scope %s before installing handlers', scope => {
  const f = fixture(2);
  expect(() => f.start(1, scope)).toThrow('poker_ready:scope');
  expect(f.links[1].get(0)!.handlers.size).toBe(0);
  expect(f.links[1].get(0)!.sent).toHaveLength(0);
});
it('rejects a recognized packet with a missing scope', async () => {
  const f = fixture(2); const relay = f.start(0, 'deck-approved');
  f.links[1].get(0)!.sendSignal({ protocol: 'manamesh-poker-protocol-ready-v2', sessionId: f.history.sessionId, checkpoint: f.history.checkpoint.head, seat: 1, nonce: '1'.repeat(32), type: 'installed', peerSeat: 0 });
  await expect(relay.ready).rejects.toThrow('poker_ready:binding');
});
