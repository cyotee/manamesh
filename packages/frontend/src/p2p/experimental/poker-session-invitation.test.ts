import { afterEach, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { pokerHistoryJSON } from '@manamesh/poker/verified-history';
import { createPokerInvitation, createPokerParticipant, parsePokerInvitation, reviewPokerInvitation } from './poker-session-invitation';
const identities: ReturnType<typeof createPokerParticipant>[] = [];
afterEach(() => identities.splice(0).forEach(identity => identity.dispose()));
function fixture(seats = 2) {
  const wallets = Array.from({ length: seats }, () => privateKeyToAccount(generatePrivateKey()));
  const participants = wallets.map(wallet => createPokerParticipant(wallet.address)); identities.push(...participants);
  const domain = { chainId: 31337, settler: privateKeyToAccount(generatePrivateKey()).address };
  const wire = createPokerInvitation({ ...domain, dealer: 0, smallBlind: 1, bigBlind: 2,
    seats: participants.map(participant => ({ ...participant.publicIdentity, stack: 100 })) });
  const expected = (seat: number) => ({ ...domain, wallets: wallets.map(wallet => wallet.address), participant: participants[seat].publicIdentity });
  return { wire, wallets, participants, expected };
}
it.each([2, 3, 4, 5])('reconstructs identical local rules and enrollment for %i independent identities', seats => {
  const f = fixture(seats); const reviews = f.participants.map((_, seat) => reviewPokerInvitation(f.wire, f.expected(seat)));
  expect(new Set(reviews.map(review => review.enrollment.sessionId)).size).toBe(1);
  expect(new Set(reviews.map(review => review.replay.genesisJSON)).size).toBe(1);
  expect(reviews.map(review => review.seat)).toEqual(Array.from({ length: seats }, (_, seat) => seat));
  expect(Object.isFrozen(reviews[0].invitation.seats[0])).toBe(true);
  expect(reviews[0].enrollment.missingSeats).toHaveLength(seats);
});
it('requires independently expected wallets, domain and the local session key', () => {
  const f = fixture();
  for (const expected of [
    { ...f.expected(0), chainId: 1 },
    { ...f.expected(0), settler: f.wallets[0].address },
    { ...f.expected(0), wallets: f.expected(0).wallets.slice().reverse() },
    { ...f.expected(0), participant: { ...f.participants[0].publicIdentity, signingKey: f.participants[1].publicIdentity.signingKey } },
  ]) expect(() => reviewPokerInvitation(f.wire, expected)).toThrow();
});
it('rejects extra host state/key fields, unsupported rules, duplicate identities and invalid chip terms', () => {
  const f = fixture(); const value = JSON.parse(f.wire);
  const changed = [
    { ...value, genesisJSON: '{}' }, { ...value, privateKey: 'secret' },
    { ...value, rulesHash: `0x${'11'.repeat(32)}` }, { ...value, dealer: 2 },
    { ...value, bigBlind: 0 }, { ...value, chainId: '31337' },
    { ...value, seats: [value.seats[0], value.seats[0]] },
    { ...value, seats: [{ ...value.seats[0], stack: Number.MAX_SAFE_INTEGER }, value.seats[1]] },
    { ...value, seats: [{ ...value.seats[0], privateKey: 'secret' }, value.seats[1]] },
  ];
  for (const input of changed) expect(() => parsePokerInvitation(pokerHistoryJSON(JSON.stringify(input)))).toThrow();
});
it('bounds the wire and rejects noncanonical or duplicate-field encodings', () => {
  const f = fixture();
  for (const wire of ['x'.repeat(8193), ` ${f.wire}`, f.wire.replace('{', '{"dealer":1,')]) expect(() => parsePokerInvitation(wire)).toThrow();
});
it('generates fresh sessions from identical public terms', () => {
  const f = fixture(); const first = parsePokerInvitation(f.wire);
  const second = parsePokerInvitation(createPokerInvitation({ chainId: first.chainId, settler: first.settler,
    dealer: first.dealer, smallBlind: first.smallBlind, bigBlind: first.bigBlind, seats: first.seats }));
  expect(first.nonce).not.toBe(second.nonce); expect(first.handId).not.toBe(second.handId);
});
it('exports only public identity and revokes local signing after disposal', async () => {
  const f = fixture(); const participant = f.participants[0];
  expect(Object.keys(participant.publicIdentity).sort()).toEqual(['signingKey', 'wallet']);
  expect(f.wire).not.toContain('privateKey');
  const review = reviewPokerInvitation(f.wire, f.expected(0));
  const data = review.enrollment.typedData(0);
  const signature = await participant.signingAccount.signTypedData(data);
  expect(await recoverTypedDataAddress({ ...data, signature })).toBe(participant.publicIdentity.signingKey);
  const pending = participant.signingAccount.signTypedData(data);
  participant.dispose();
  await expect(pending).rejects.toThrow('participant_closed');
  await expect(participant.signingAccount.signTypedData(data)).rejects.toThrow('participant_closed');
});
