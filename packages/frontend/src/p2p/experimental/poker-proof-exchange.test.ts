import { afterEach, expect, it, vi } from 'vitest';
import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { PokerHistoryChannel } from '../poker-history-channel';
import type { ExperimentalPokerShuffleAdmission } from './poker-shuffle-admission';
import { PokerProofExchange } from './poker-proof-exchange';
class Channel extends EventTarget {
  closed = false;
  verify!: (wire: string) => Promise<void>;
  sendArtifact = vi.fn();
  setArtifactVerifier(verify: typeof this.verify) { this.verify = verify; }
  dispose() { if (this.closed) return; this.closed = true; this.dispatchEvent(new CustomEvent('closed', { detail: new Error('link_closed') })); }
  async receive(packet: unknown) { const wire = JSON.stringify(packet); await this.verify(wire); this.dispatchEvent(new CustomEvent('artifact', { detail: wire })); }
}
afterEach(() => vi.useRealTimers());
class Admission extends EventTarget {
  missingAnnouncements = [0, 1, 2];
  dealPlan = { holeRecipients: [0, 1, 2, 0, 1, 2] };
  closed = false;
  ownAnnouncement = `0x${'01'.repeat(98)}` as const;
  receiveAnnouncement = vi.fn().mockResolvedValue(undefined);
  receiveApproval = vi.fn().mockResolvedValue(undefined);
  receiveShuffle = vi.fn().mockResolvedValue(undefined);
  receivePublicContribution = vi.fn().mockResolvedValue(undefined);
  acceptPrivateContribution = vi.fn().mockResolvedValue(undefined);
  makePrivateContribution = vi.fn().mockResolvedValue(new Uint8Array(131));
  makePublicContribution = vi.fn().mockResolvedValue(new Uint8Array(131));
  makeShuffle = vi.fn().mockResolvedValue(new Uint8Array(8979));
  dispose = vi.fn((reason = new Error('worker_closed')) => { if (this.closed) return; this.closed = true; this.dispatchEvent(new CustomEvent('closed', { detail: reason })); });
}
function fixture() {
  const channels = [new Channel(), new Channel()]; const admission = new Admission();
  const history = { sessionId: `0x${'a'.repeat(64)}`, checkpoint: { head: `0x${'b'.repeat(64)}` }, seatCount: 3 };
  const exchange = new PokerProofExchange(new Map(channels.map((channel, index) => [index + 1, channel as unknown as PokerHistoryChannel])), history as unknown as VerifiedPokerHistory, admission as unknown as ExperimentalPokerShuffleAdmission, 0);
  const packet = { type: 'public-contribution-v1', sessionId: history.sessionId, checkpoint: history.checkpoint.head, seat: 1, position: 7, proof: `0x${'00'.repeat(131)}` };
  return { channels, admission, history, exchange, packet };
}
it('forwards only after local verification, excluding the source link', async () => {
  const f = fixture(); let finish!: () => void;
  f.admission.receivePublicContribution.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = f.channels[0].receive(f.packet);
  expect(f.channels[1].sendArtifact).not.toHaveBeenCalled(); expect(f.exchange.hasPublic(7, 1)).toBe(false);
  finish(); await pending;
  expect(f.channels[0].sendArtifact).not.toHaveBeenCalled();
  expect(f.channels[1].sendArtifact).toHaveBeenCalledWith(JSON.stringify(f.packet));
  expect(f.exchange.hasPublic(7, 1)).toBe(true); f.exchange.dispose();
});
it('closes the worker and sibling links on channel failure, preserving the first reason', () => {
  const f = fixture(); f.channels[0].dispatchEvent(new CustomEvent('rejected', { detail: new Error('bad_proof') }));
  expect(f.exchange.closeReason).toBe('bad_proof'); expect(f.admission.closed).toBe(true);
  expect(f.channels.every(channel => channel.closed)).toBe(true); f.exchange.dispose();
  expect(f.exchange.closeReason).toBe('bad_proof'); expect(f.admission.dispose).toHaveBeenCalledTimes(1);
});
it('closes protocol links when the worker fails independently of a send', () => {
  const f = fixture(); f.admission.dispose(new Error('worker_timeout'));
  expect(f.exchange.closed).toBe(true); expect(f.exchange.closeReason).toBe('worker_timeout');
  expect(f.channels.every(channel => channel.closed)).toBe(true);
});
it('refuses further worker operations after disposal', async () => {
  const f = fixture(); f.exchange.dispose();
  await expect(f.exchange.announce()).rejects.toThrow('closed');
  await expect(f.exchange.sendPrivate(0)).rejects.toThrow('closed');
  expect(f.admission.receiveAnnouncement).not.toHaveBeenCalled(); expect(f.admission.makePrivateContribution).not.toHaveBeenCalled();
});
it('scopes receipts and prepared proofs to the current checkpoint and snapshots cached bytes', async () => {
  const f = fixture(); const proof = await f.exchange.preparePublic(7); proof[0] = 255;
  f.exchange.sendPreparedPublic(7);
  expect(JSON.parse(f.channels[0].sendArtifact.mock.calls[0][0]).proof).toBe(`0x${'00'.repeat(131)}`);
  expect(f.exchange.hasPublic(7, 0)).toBe(true);
  f.history.checkpoint.head = `0x${'c'.repeat(64)}`;
  expect(f.exchange.hasPublic(7, 0)).toBe(false);
  expect(() => f.exchange.sendPreparedPublic(7)).toThrow('unprepared'); f.exchange.dispose();
});
it('terminates the worker when forwarding fails after verification', async () => {
  const f = fixture(); f.channels[1].sendArtifact.mockImplementationOnce(() => { throw new Error('send_failed'); });
  await f.channels[0].receive(f.packet);
  expect(f.exchange.closeReason).toBe('send_failed'); expect(f.admission.closed).toBe(true);
  expect(f.exchange.hasPublic(7, 1)).toBe(true);
});

it('waits for all non-owner private contributions to finish verification', async () => {
  const f = fixture(); let released = false;
  const wait = f.exchange.waitForPrivate(0).then(() => { released = true; });
  const packet = { ...f.packet, type: 'private-contribution-v1', position: 0 };
  let finish!: () => void;
  f.admission.acceptPrivateContribution.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const receiving = f.channels[0].receive(packet);
  await Promise.resolve(); expect(released).toBe(false);
  finish(); await receiving; expect(released).toBe(false);
  await f.channels[1].receive({ ...packet, seat: 2 });
  await wait; expect(released).toBe(true);
  await f.exchange.waitForPrivate(0); // Already verified receipts complete immediately.
  f.exchange.dispose();
});
it('rejects pending private waits on closure with the original error', async () => {
  const f = fixture(); const wait = f.exchange.waitForPrivate(0);
  f.admission.dispose(new Error('worker_failed'));
  await expect(wait).rejects.toThrow('worker_failed');
});
it('bounds missing private contributions and cleans every timer on timeout', async () => {
  vi.useFakeTimers(); const f = fixture();
  const wait = f.exchange.waitForPrivate(0);
  const rejection = expect(wait).rejects.toThrow('private_timeout');
  await vi.advanceTimersByTimeAsync(20_000); await rejection;
  expect(f.exchange.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('refuses private waits outside the hole-card plan', async () => {
  const f = fixture();
  for (const position of [-1, 0.5, 6, 52]) await expect(f.exchange.waitForPrivate(position)).rejects.toThrow('position');
  f.exchange.dispose();
});

it('waits for every public contribution, including locally generated evidence', async () => {
  const f = fixture(); let released = false;
  const wait = f.exchange.waitForPublic(7).then(() => { released = true; });
  await f.channels[0].receive(f.packet);
  await f.channels[1].receive({ ...f.packet, seat: 2 });
  expect(released).toBe(false);
  await f.exchange.preparePublic(7); await wait;
  expect(released).toBe(true); f.exchange.dispose();
});
it('rejects a public wait if verified receipts arrive at a different history head', async () => {
  const f = fixture(); const wait = f.exchange.waitForPublic(7);
  f.history.checkpoint.head = `0x${'c'.repeat(64)}`;
  await f.exchange.preparePublic(7);
  await expect(wait).rejects.toThrow('stale_public'); f.exchange.dispose();
});
it('closes and clears all contribution waits if public evidence is withheld', async () => {
  vi.useFakeTimers(); const f = fixture();
  const publicWait = expect(f.exchange.waitForPublic(7)).rejects.toThrow('public_timeout');
  const privateWait = expect(f.exchange.waitForPrivate(0)).rejects.toThrow('public_timeout');
  await vi.advanceTimersByTimeAsync(20_000); await Promise.all([publicWait, privateWait]);
  expect(f.exchange.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('completes announcement readiness only after all native admission work finishes', async () => {
  const f = fixture();
  f.admission.receiveAnnouncement.mockImplementation(async (seat: number) => { f.admission.missingAnnouncements = f.admission.missingAnnouncements.filter(value => value !== seat); });
  let released = false;
  const wait = f.exchange.waitForAnnouncements().then(() => { released = true; });
  await f.exchange.announce(); expect(released).toBe(false);
  const packet = { type: 'announcement-v1', sessionId: f.history.sessionId, checkpoint: f.history.checkpoint.head, announcement: f.admission.ownAnnouncement };
  await f.channels[0].receive({ ...packet, seat: 1 }); expect(released).toBe(false);
  await f.channels[1].receive({ ...packet, seat: 2 }); await wait;
  expect(released).toBe(true); f.exchange.dispose();
});
it('does not release a shuffle step before its native proof verifier completes', async () => {
  const f = fixture(); let finish!: () => void; let released = false;
  f.admission.receiveShuffle.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const wait = f.exchange.waitForShuffle(1).then(() => { released = true; });
  const receiving = f.channels[0].receive({ type: 'shuffle-proof-v1', sessionId: f.history.sessionId, checkpoint: f.history.checkpoint.head, step: 1, proof: `0x${'00'.repeat(8979)}` });
  await Promise.resolve(); expect(released).toBe(false);
  finish(); await receiving; await wait; expect(released).toBe(true); f.exchange.dispose();
});
it('wakes local shuffle waits and rejects missing steps on closure', async () => {
  const f = fixture(); const local = f.exchange.waitForShuffle(0);
  await f.exchange.shuffle(); await local;
  const missing = f.exchange.waitForShuffle(2);
  f.exchange.dispose(new Error('cancel_setup'));
  await expect(missing).rejects.toThrow('cancel_setup');
});
