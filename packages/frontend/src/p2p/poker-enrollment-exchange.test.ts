import { afterEach, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
import { PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import { PokerEnrollmentExchange } from './poker-enrollment-exchange';
class Link {
  connected = true; peer!: Link;
  handlers = new Set<(value: unknown) => void>();
  sent: unknown[] = [];
  isConnected() { return this.connected; }
  onSignal(handler: (value: unknown) => void) { this.handlers.add(handler); }
  offSignal(handler: (value: unknown) => void) { this.handlers.delete(handler); }
  sendSignal(value: unknown) { this.sent.push(value); setTimeout(() => this.peer.handlers.forEach(handler => handler(value)), 0); }
}
const active: PokerEnrollmentExchange[] = [];
afterEach(() => active.splice(0).forEach(exchange => exchange.dispose()));
function fixture(seats: number) {
  const hash = (s: string) => keccak256(toHex(s));
  const wallets = Array.from({ length: seats }, () => privateKeyToAccount(generatePrivateKey()));
  const keys = wallets.map(() => privateKeyToAccount(generatePrivateKey()));
  const config = { nonce: hash('bootstrap'), handId: hash('hand'), rulesHash: hash('rules'), chainId: 31337, settler: wallets[0].address, roster: keys.map(key => key.address) };
  const admissions = wallets.map(() => new PokerHistoryEnrollment(config, '{}', state => state, wallets.map(wallet => wallet.address)));
  const links = wallets.map(() => new Map<number, Link>());
  for (let seat = 1; seat < seats; seat++) {
    const a = new Link(); const b = new Link(); a.peer = b; b.peer = a;
    links[0].set(seat, a); links[seat].set(0, b);
  }
  const start = (seat: number) => { const exchange = new PokerEnrollmentExchange(links[seat], admissions[seat], seat); active.push(exchange); return exchange; };
  return { wallets, admissions, links, start };
}
const wait = (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 10 });
it.each([2, 3, 4, 5])('exchanges independently verified wallet approvals before creating histories at %i seats', async seats => {
  const f = fixture(seats); const table = f.wallets.map((_, seat) => f.start(seat));
  await wait(() => expect(table.every(exchange => exchange.ready)).toBe(true));
  expect(table.every(exchange => exchange.missingSeats.length === seats)).toBe(true);
  for (let seat = 0; seat < seats; seat++) {
    expect(() => table[0].approvalEnvelope()).toThrow('incomplete');
    const signature = await f.wallets[seat].signTypedData(f.admissions[seat].typedData(seat));
    await table[seat].submitApproval(signature);
    await wait(() => expect(table.every(exchange => !exchange.missingSeats.includes(seat))).toBe(true));
  }
  expect(new Set(table.map(exchange => exchange.approvalEnvelope())).size).toBe(1);
  const completed = await Promise.all(table.map(exchange => exchange.completed));
  expect(new Set(completed)).toEqual(new Set(table.map(exchange => exchange.approvalEnvelope())));
  const histories = await Promise.all(f.admissions.map(admission => admission.admitCollected()));
  expect(new Set(histories.map(history => history.sessionId)).size).toBe(1);
  expect(histories.every(history => history.checkpoint.sequence === 0)).toBe(true);
});
it('holds early approvals until every relay link has registered', async () => {
  const f = fixture(3); const relay = f.start(0); const guest = f.start(1);
  await wait(() => expect(guest.ready).toBe(true));
  expect(relay.ready).toBe(false);
  await guest.submitApproval(await f.wallets[1].signTypedData(f.admissions[1].typedData(1)));
  await wait(() => expect(relay.missingSeats).toEqual([0, 2]));
  const late = f.start(2);
  await wait(() => expect(late.missingSeats).toEqual([0, 2]));
});
it('rejects a guest signature falsely attributed to another wallet before relay forwarding', async () => {
  const f = fixture(3); const table = [f.start(0), f.start(1), f.start(2)];
  await wait(() => expect(table.every(exchange => exchange.ready)).toBe(true));
  const signature = await f.wallets[1].signTypedData(f.admissions[1].typedData(1));
  f.links[1].get(0)!.sendSignal({ protocol: 'manamesh-poker-enrollment-v1', type: 'approval', sessionId: f.admissions[0].sessionId, seat: 2, signature });
  await wait(() => expect(table[0].closed).toBe(true));
  expect(table[0].closeReason).toContain('wrong_wallet');
  expect(table[2].missingSeats).toEqual([0, 1, 2]);
  expect(f.links[0].get(2)!.sent.some(value => (value as { type: string }).type === 'approval')).toBe(false);
});
it('refuses altered terms and removes signal handlers on failure', async () => {
  const f = fixture(2); const relay = f.start(0); const guest = f.start(1);
  await wait(() => expect(guest.ready).toBe(true));
  f.links[1].get(0)!.sendSignal({ protocol: 'manamesh-poker-enrollment-v1', type: 'registered', sessionId: `0x${'ff'.repeat(32)}`, seat: 1, peerSeat: 0 });
  await wait(() => expect(relay.closed).toBe(true));
  expect(relay.closeReason).toContain('terms');
  await expect(relay.completed).rejects.toThrow('terms');
  expect((await relay.whenClosed).message).toBe(relay.closeReason);
  expect(f.links[0].get(1)!.handlers.size).toBe(0);
});

it('removes earlier signal registrations when a later registration throws', () => {
  const f = fixture(3);
  f.links[0].get(2)!.onSignal = () => { throw new Error('registration_failed'); };
  expect(() => f.start(0)).toThrow('registration_failed');
  expect(f.links[0].get(1)!.handlers.size).toBe(0);
});
