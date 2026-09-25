import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
import type * as Harness from './history-signing-harness';

// Ephemeral test keys remain in memory; disable tracing of evaluate arguments.
test.use({ trace: 'off' });
declare global { interface Window { historySigningHarness: typeof Harness } }
async function ready(page: Page) {
  await page.goto('/e2e/history-signing.html');
  await page.waitForFunction(() => Boolean(window.historySigningHarness));
}
function players() {
  const keys = [generatePrivateKey(), generatePrivateKey()];
  return { keys, roster: keys.map(k => privateKeyToAccount(k).address) };
}

test('two tabs cannot sign conflicting proposals; the winning claim survives reload', async ({ page, context }) => {
  const { keys, roster } = players(); await ready(page);
  const reference = await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0 });
  const second = await context.newPage(); await ready(second);
  await second.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0, reference });
  const results = await Promise.allSettled([
    page.evaluate(() => window.historySigningHarness.propose(1)),
    second.evaluate(() => window.historySigningHarness.propose(2)),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const winningAmount = results[0].status === 'fulfilled' ? 1 : 2;
  const counts = await Promise.all([page, second].map(p => p.evaluate(() => window.historySigningHarness.signCount())));
  expect(counts[0] + counts[1]).toBe(1);
  await second.close(); await page.reload();
  await page.waitForFunction(() => Boolean(window.historySigningHarness));
  await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0, reference });
  await expect(page.evaluate(n => window.historySigningHarness.propose(n), 3 - winningAmount)).rejects.toThrow('equivocation');
  await page.evaluate(n => window.historySigningHarness.propose(n), winningAmount);
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(1);
});

test('a failed signature retains its claim and a closed database cannot authorize signing', async ({ page }) => {
  const { keys, roster } = players(); await ready(page);
  await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0 });
  await page.evaluate(() => window.historySigningHarness.rejectNextSignature());
  await expect(page.evaluate(() => window.historySigningHarness.propose(1))).rejects.toThrow('test_signing_failed');
  await expect(page.evaluate(() => window.historySigningHarness.propose(2))).rejects.toThrow('equivocation');
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(1);
  await page.evaluate(() => window.historySigningHarness.propose(1));
  await page.evaluate(() => window.historySigningHarness.closeStorage());
  await expect(page.evaluate(() => window.historySigningHarness.propose(1))).rejects.toThrow();
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(2);
});

test('missing storage cannot silently resume an existing session key', async ({ page }) => {
  const { keys, roster } = players(); await ready(page);
  const reference = await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0 });
  await page.evaluate(() => window.historySigningHarness.propose(1));
  await page.evaluate(() => window.historySigningHarness.eraseStorageForTest());
  await page.reload(); await page.waitForFunction(() => Boolean(window.historySigningHarness));
  await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0, reference });
  await expect(page.evaluate(() => window.historySigningHarness.propose(2))).rejects.toThrow('missing_or_changed_journal');
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
});

test('both seats acknowledge the same proposal and the verified history advances', async ({ page, context }) => {
  const { keys, roster } = players(); await ready(page);
  await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0 });
  const second = await context.newPage(); await ready(second);
  await second.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[1], roster, seat: 1 });
  const proposal = await page.evaluate(() => window.historySigningHarness.propose(1));
  const wire = JSON.stringify(proposal);
  const acks = await Promise.all([page, second].map(p => p.evaluate(w => window.historySigningHarness.acknowledge(w), wire)));
  expect(acks[0].actionHash).toBe(acks[1].actionHash);
  const batch = JSON.stringify([{ ...proposal, acknowledgments: acks.map(a => a.signature) }]);
  const accepted = await Promise.all([page, second].map(p => p.evaluate(w => window.historySigningHarness.append(w), batch)));
  expect(accepted[0]).toEqual(accepted[1]);
  expect(accepted[0].sequence).toBe(1);
  expect(JSON.parse(accepted[0].stateJSON)).toEqual({ count: 1 });
  const next = await page.evaluate(() => window.historySigningHarness.propose(2));
  expect(next.sequence).toBe(2);
});

test('a modified host cannot obtain conflicting acknowledgments or cross-role signatures', async ({ page, context }) => {
  const { keys, roster } = players(); await ready(page);
  await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[0], roster, seat: 0 });
  const second = await context.newPage(); await ready(second);
  await second.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[1], roster, seat: 1 });
  const first = await page.evaluate(() => window.historySigningHarness.propose(1));
  const conflicting = await page.evaluate(() => window.historySigningHarness.unsafeProposalForTest(2));
  await second.evaluate(w => window.historySigningHarness.acknowledge(w), JSON.stringify(first));
  await expect(second.evaluate(w => window.historySigningHarness.acknowledge(w), JSON.stringify(conflicting))).rejects.toThrow('equivocation');
  await expect(page.evaluate(w => window.historySigningHarness.acknowledge(w), JSON.stringify(conflicting))).rejects.toThrow('equivocation');
  expect(await second.evaluate(() => window.historySigningHarness.signCount())).toBe(1);
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(1);
});

test('wallet enrollment gates journal creation and both admitted seats reach one checkpoint', async ({ page, context }) => {
  const { keys, roster } = players();
  const wallets = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
  const addresses = wallets.map(wallet => wallet.address);
  await ready(page);
  const second = await context.newPage(); await ready(second);
  const pages = [page, second];
  const terms = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.enrollmentData(input), { roster, wallets: addresses, seat })));
  expect(terms[0].sessionId).toBe(terms[1].sessionId);
  const signatures = await Promise.all(wallets.map((wallet, seat) => wallet.signTypedData(terms[seat].typedData)));
  const enrollmentWire = JSON.stringify({ sessionId: terms[0].sessionId, signatures });
  // The attacker has the session key but lacks the wallet authorization.
  const forged = await privateKeyToAccount(keys[0]).signTypedData(terms[0].typedData);
  await expect(page.evaluate(input => window.historySigningHarness.initializeEnrolled(input), {
    key: keys[0], roster, seat: 0, wallets: addresses,
    enrollmentWire: JSON.stringify({ sessionId: terms[0].sessionId, signatures: [forged, signatures[1]] }),
  })).rejects.toThrow('wrong_wallet');
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
  expect(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'manamesh-poker-signing-v1'))).toBe(false);
  const references = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.initializeEnrolled(input), {
    key: keys[seat], roster, seat, wallets: addresses, enrollmentWire,
  })));
  const proposal = await page.evaluate(() => window.historySigningHarness.propose(1));
  const acknowledgments = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(proposal))));
  const batch = JSON.stringify([{ ...proposal, acknowledgments: acknowledgments.map(ack => ack.signature) }]);
  const checkpoints = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.append(wire), batch)));
  expect(checkpoints[0]).toEqual(checkpoints[1]); expect(checkpoints[0].sequence).toBe(1);
  await second.close(); await page.reload(); await page.waitForFunction(() => Boolean(window.historySigningHarness));
  await page.evaluate(input => window.historySigningHarness.initializeEnrolled(input), {
    key: keys[0], roster, seat: 0, wallets: addresses, enrollmentWire, reference: references[0],
  });
  await expect(page.evaluate(() => window.historySigningHarness.propose(2))).rejects.toThrow('equivocation');
  await page.evaluate(wire => window.historySigningHarness.append(wire), batch);
  expect((await page.evaluate(() => window.historySigningHarness.propose(2))).sequence).toBe(2);
});

for (const seats of [2, 3, 4, 5]) {
  test(`${seats} enrolled browser peers replay Poker betting and reject a malicious host across reload`, async ({ page, context }) => {
    const accounts = Array.from({ length: seats }, () => privateKeyToAccount(generatePrivateKey()));
    const keys = Array.from({ length: seats }, () => generatePrivateKey());
    const roster = keys.map(key => privateKeyToAccount(key).address);
    const wallets = accounts.map(account => account.address);
    const pages = [page];
    for (let seat = 1; seat < seats; seat++) pages.push(await context.newPage());
    await Promise.all(pages.map(ready));
    const inputs = keys.map((key, seat) => ({ key, roster, seat, wallets, mode: 'betting' as const }));
    const terms = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.enrollmentData(input), inputs[seat])));
    expect(new Set(terms.map(term => term.sessionId)).size).toBe(1);
    const signatures = await Promise.all(accounts.map((account, seat) => account.signTypedData(terms[seat].typedData)));
    const enrollmentWire = JSON.stringify({ sessionId: terms[0].sessionId, signatures });
    const references = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.initializeEnrolled(input), {
      ...inputs[seat], enrollmentWire,
    })));

    const falseState = await page.evaluate(() => window.historySigningHarness.unsafePokerProposalForTest(10, true));
    await expect(pages[1].evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(falseState))).rejects.toThrow('state_mismatch');
    expect(await pages[1].evaluate(() => window.historySigningHarness.signCount())).toBe(0);
    const proposal = await page.evaluate(() => window.historySigningHarness.proposePoker('{"move":"raise","amount":10}'));
    const conflicting = await page.evaluate(() => window.historySigningHarness.unsafePokerProposalForTest(12));
    const acknowledgments = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(proposal))));
    await expect(pages[1].evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(conflicting))).rejects.toThrow('equivocation');
    expect(await pages[1].evaluate(() => window.historySigningHarness.signCount())).toBe(1);
    const entry = { ...proposal, acknowledgments: acknowledgments.map(ack => ack.signature) };
    await expect(pages[1].evaluate(wire => window.historySigningHarness.append(wire), JSON.stringify([{ ...entry, stateJSON: '{}' }]))).rejects.toThrow('unexpected_fields');
    expect((await pages[1].evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);
    const firstBatch = JSON.stringify([entry]);
    const committed = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.append(wire), firstBatch)));
    expect(committed.every(checkpoint => checkpoint.head === committed[0].head)).toBe(true);

    await pages[1].reload();
    await pages[1].waitForFunction(() => Boolean(window.historySigningHarness));
    await pages[1].evaluate(input => window.historySigningHarness.initializeEnrolled(input), {
      ...inputs[1], enrollmentWire, reference: references[1],
    });
    await expect(pages[1].evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(conflicting))).rejects.toThrow('equivocation');
    expect(await pages[1].evaluate(() => window.historySigningHarness.signCount())).toBe(0);
    await pages[1].evaluate(wire => window.historySigningHarness.append(wire), firstBatch);

    for (let actor = 1; actor < seats; actor++) {
      const next = await pages[actor].evaluate(() => window.historySigningHarness.proposePoker('{"move":"call"}'));
      const acks = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(next))));
      const wire = JSON.stringify([{ ...next, acknowledgments: acks.map(ack => ack.signature) }]);
      const checkpoints = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.append(wire), wire)));
      expect(checkpoints.every(checkpoint => checkpoint.head === checkpoints[0].head)).toBe(true);
    }
    const final = await page.evaluate(() => window.historySigningHarness.checkpoint());
    expect(final.sequence).toBe(seats);
    const state = JSON.parse(final.stateJSON);
    expect(state.round.isComplete).toBe(true);
    expect(state.pot).toBe(seats * 10);
    expect(state.players.every((player: { chips: number }) => player.chips === 90)).toBe(true);
    expect(final.stateJSON).not.toMatch(/hand|deck|peeked|zones|community/);
  });
}

async function archivedBettingTable(page: Page, context: BrowserContext) {
  const { keys, roster } = players();
  const accounts = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
  const wallets = accounts.map(account => account.address);
  const pages = [page, await context.newPage()];
  await Promise.all(pages.map(ready));
  const inputs = keys.map((key, seat) => ({ key, roster, seat, wallets, mode: 'betting' as const }));
  const terms = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.enrollmentData(input), inputs[seat])));
  const signatures = await Promise.all(accounts.map((account, seat) => account.signTypedData(terms[seat].typedData)));
  const enrollmentWire = JSON.stringify({ sessionId: terms[0].sessionId, signatures });
  const references = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.initializeArchived(input), { ...inputs[seat], enrollmentWire })));
  const proposal = await page.evaluate(() => window.historySigningHarness.proposePoker('{"move":"raise","amount":10}'));
  const acks = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(proposal))));
  expect(await page.evaluate(wire => window.historySigningHarness.openProposal(wire), JSON.stringify(proposal))).toEqual([0, 1]);
  const forged = { ...acks[1], signature: acks[0].signature };
  await expect(page.evaluate(wire => window.historySigningHarness.collectAcknowledgment(wire), JSON.stringify(forged))).rejects.toThrow('ack_signer');
  for (const ack of acks) await page.evaluate(wire => window.historySigningHarness.collectAcknowledgment(wire), JSON.stringify(ack));
  const wire = await page.evaluate(() => window.historySigningHarness.proposalBatch());
  const resume = async (seat: number) => {
    await pages[seat].reload();
    await pages[seat].waitForFunction(() => Boolean(window.historySigningHarness));
    return pages[seat].evaluate(input => window.historySigningHarness.initializeArchived(input), {
      ...inputs[seat], enrollmentWire, reference: references[seat].journalReference, archiveReference: references[seat].archiveReference,
    });
  };
  const recoveryInputs = inputs.map((input, seat) => ({ ...input, enrollmentWire,
    reference: references[seat].journalReference, archiveReference: references[seat].archiveReference }));
  return { pages, references, wire, resume, recoveryInputs };
}

test('accepted Poker transcripts survive reload and closed storage cannot advance history', async ({ page, context }) => {
  const { pages, wire, resume } = await archivedBettingTable(page, context);
  await page.evaluate(wire => window.historySigningHarness.append(wire), wire);
  await pages[1].evaluate(() => window.historySigningHarness.closeArchive());
  await expect(pages[1].evaluate(wire => window.historySigningHarness.append(wire), wire)).rejects.toThrow();
  expect((await pages[1].evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);
  await resume(1);
  expect((await pages[1].evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);
  await pages[1].evaluate(wire => window.historySigningHarness.append(wire), wire);
  await resume(1); // No transcript supplied by the runner on this resume.
  expect(await pages[1].evaluate(() => window.historySigningHarness.checkpoint())).toEqual(await page.evaluate(() => window.historySigningHarness.checkpoint()));
  const call = await pages[1].evaluate(() => window.historySigningHarness.proposePoker('{"move":"call"}'));
  const acks = await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.acknowledge(wire), JSON.stringify(call))));
  const finalWire = JSON.stringify([{ ...call, acknowledgments: acks.map(ack => ack.signature) }]);
  await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.append(wire), finalWire)));
  await resume(0);
  const final = await page.evaluate(() => window.historySigningHarness.checkpoint());
  expect(final.sequence).toBe(2);
  expect(JSON.parse(final.stateJSON)).toMatchObject({ pot: 20, round: { isComplete: true } });
});

for (const remove of [false, true]) {
  test(`${remove ? 'missing' : 'corrupted'} transcript storage refuses recovery`, async ({ page, context }) => {
    const { pages, references, wire, resume } = await archivedBettingTable(page, context);
    await Promise.all(pages.map(p => p.evaluate(wire => window.historySigningHarness.append(wire), wire)));
    await pages[1].evaluate(input => window.historySigningHarness.damageArchiveForTest(input.reference, input.remove), {
      reference: references[1].archiveReference, remove,
    });
    await expect(resume(1)).rejects.toThrow(remove ? 'missing_or_changed_archive' : 'actor_signature');
    expect(await pages[1].evaluate(() => window.historySigningHarness.signCount())).toBe(0);
  });
}

test('disposing local history refuses pending signature results and preserves its durable claim', async ({ page, context }) => {
  const { resume } = await archivedBettingTable(page, context);
  const before = await page.evaluate(() => window.historySigningHarness.signCount());
  await page.evaluate(() => window.historySigningHarness.holdSigningForTest());
  // This retries the same already claimed action; it must not create a new lock.
  const pending = page.evaluate(() => window.historySigningHarness.proposePoker('{"move":"raise","amount":10}'))
    .then(() => 'unexpected_signature', error => String(error));
  await page.waitForFunction(before => window.historySigningHarness.signCount() === before + 1, before);
  await page.evaluate(() => { window.historySigningHarness.closeLocalHistory(); window.historySigningHarness.releaseSigningForTest(); });
  expect(await pending).toContain('poker_local:closed');
  expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
  await expect(page.evaluate(() => window.historySigningHarness.proposePoker('{"move":"raise","amount":10}'))).rejects.toThrow();
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(before + 1);
  await resume(0);
  await expect(page.evaluate(() => window.historySigningHarness.proposePoker('{"move":"raise","amount":12}'))).rejects.toThrow('poker_journal:equivocation');
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
});

test('local encryption preparation cannot replace an existing journal or restart from public recovery', async ({ page, context }) => {
  const { pages, resume } = await archivedBettingTable(page, context);
  const input = { protocol: keccak256(toHex('storage-only-fixture')), announcements: ['0x01', '0x02'] as const };
  await page.evaluate(input => window.historySigningHarness.initializeEncryptionRoster({ ...input, announcements: [...input.announcements] }), input);
  const calls = await page.evaluate(() => window.historySigningHarness.signCount());
  await expect(page.evaluate(input => window.historySigningHarness.prepareLocalEncryptionForTest({ ...input, announcements: [...input.announcements] }), input)).rejects.toThrow();
  expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(calls);
  await resume(1);
  await expect(pages[1].evaluate(input => window.historySigningHarness.prepareLocalEncryptionForTest({ ...input, announcements: [...input.announcements] }), input)).rejects.toThrow('encrypted_recovery_unavailable');
  expect(await pages[1].evaluate(() => window.historySigningHarness.signCount())).toBe(0);
});

test('concurrent tabs archive an identical checkpoint only once', async ({ page, context }) => {
  const { wire, resume, recoveryInputs } = await archivedBettingTable(page, context);
  const duplicate = await context.newPage(); await ready(duplicate);
  await duplicate.evaluate(input => window.historySigningHarness.initializeArchived(input), recoveryInputs[0]);
  const checkpoints = await Promise.all([page, duplicate].map(p => p.evaluate(wire => window.historySigningHarness.append(wire), wire)));
  expect(checkpoints[0]).toEqual(checkpoints[1]);
  await duplicate.close();
  await resume(0);
  expect(await page.evaluate(() => window.historySigningHarness.checkpoint())).toEqual(checkpoints[0]);
});

test('WebRTC delivers chunked verified Poker checkpoints and rejects hostile frames and replay', async ({ page, context }) => {
  const { pages, wire, resume } = await archivedBettingTable(page, context);
  const guest = pages[1];
  const offer = await page.evaluate(() => window.historySigningHarness.createHistoryOffer());
  const answer = await guest.evaluate(offer => window.historySigningHarness.acceptHistoryOffer(offer), offer);
  await page.evaluate(answer => window.historySigningHarness.finishHistoryAnswer(answer), answer);
  await Promise.all(pages.map(p => p.waitForFunction(() => window.historySigningHarness.historyChannelOpen())));
  await page.evaluate(() => window.historySigningHarness.sendHistoryFrameForTest('{"state":{"pot":999999}}'));
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(event => event.kind === 'rejected'));
  expect((await guest.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);

  const malformed = JSON.stringify({ version: 1, id: 'a'.repeat(32), index: 1, count: 2, chunk: 'x' });
  await page.evaluate(frame => window.historySigningHarness.sendHistoryFrameForTest(frame), malformed);
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(event => event.message?.includes('fragment_order')));
  expect((await guest.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);

  await page.evaluate(() => window.historySigningHarness.commitProposal());
  // JSON envelope whitespace forces multiple transport frames without changing
  // any signed action or giving the host a state snapshot.
  const padded = ' '.repeat(20_000) + wire;
  await page.evaluate(wire => window.historySigningHarness.sendHistoryBatch(wire), padded);
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(event => event.kind === 'checkpoint' && event.sequence === 1));
  expect(await guest.evaluate(() => window.historySigningHarness.checkpoint())).toEqual(await page.evaluate(() => window.historySigningHarness.checkpoint()));

  await page.evaluate(wire => window.historySigningHarness.sendHistoryBatch(wire), padded);
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(event => event.message?.includes('poker_history:sequence')));
  expect((await guest.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(1);
  await expect(page.evaluate(() => window.historySigningHarness.sendHistoryBatch(' '.repeat(1024 * 1024 + 1)))).rejects.toThrow('batch_size');
  await Promise.all(pages.map(p => p.evaluate(() => window.historySigningHarness.closeHistoryConnection())));
  await resume(1);
  expect(await guest.evaluate(() => window.historySigningHarness.checkpoint())).toEqual(await page.evaluate(() => window.historySigningHarness.checkpoint()));
});


test('WebRTC exchanges reviewed proposals and seat-authenticated acknowledgments before commit', async ({ page, context }) => {
  const { pages, resume, wire } = await archivedBettingTable(page, context);
  const guest = pages[1];
  const offer = await page.evaluate(() => window.historySigningHarness.createHistoryOffer());
  const answer = await guest.evaluate(offer => window.historySigningHarness.acceptHistoryOffer(offer), offer);
  await page.evaluate(answer => window.historySigningHarness.finishHistoryAnswer(answer), answer);
  await Promise.all(pages.map(p => p.waitForFunction(() => window.historySigningHarness.historyChannelOpen())));
  const signsBefore = await guest.evaluate(() => window.historySigningHarness.signCount());
  await page.evaluate(async () => {
    const forged = await window.historySigningHarness.unsafePokerProposalForTest(10, true);
    window.historySigningHarness.sendHistoryBatch(JSON.stringify({ type: 'proposal', wireJSON: JSON.stringify(forged) }));
  });
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(e => e.kind === 'rejected'));
  expect(await guest.evaluate(() => window.historySigningHarness.channelMissingSeats())).toBeUndefined();
  expect(await guest.evaluate(() => window.historySigningHarness.signCount())).toBe(signsBefore);
  await page.evaluate(() => window.historySigningHarness.proposeOverChannel('{"move":"raise","amount":10}'));
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(e => e.kind === 'proposal'));
  // A peer can send a valid signature while falsely claiming another admitted seat.
  await guest.evaluate(() => window.historySigningHarness.acknowledgeOverChannel(true));
  await page.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(e => e.message?.includes('ack_signer')));
  expect(await page.evaluate(() => window.historySigningHarness.channelMissingSeats())).toEqual([0, 1]);
  await guest.evaluate(() => window.historySigningHarness.acknowledgeOverChannel());
  await page.waitForFunction(() => window.historySigningHarness.channelMissingSeats()?.length === 1);
  expect((await page.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);
  await page.evaluate(() => window.historySigningHarness.acknowledgeOverChannel());
  await guest.waitForFunction(() => window.historySigningHarness.channelMissingSeats()?.length === 0);
  await page.evaluate(() => window.historySigningHarness.commitOverChannel());
  await guest.waitForFunction(() => window.historySigningHarness.checkpoint().sequence === 1);
  expect(await guest.evaluate(() => window.historySigningHarness.checkpoint())).toEqual(await page.evaluate(() => window.historySigningHarness.checkpoint()));
  await page.evaluate(wire => {
    const { acknowledgments: _votes, ...action } = JSON.parse(wire)[0];
    window.historySigningHarness.sendHistoryBatch(JSON.stringify({ type: 'proposal', wireJSON: JSON.stringify(action) }));
  }, wire);
  await guest.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(e => e.message?.includes('poker_history:sequence')));
  expect((await guest.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(1);
  await Promise.all(pages.map(p => p.evaluate(() => window.historySigningHarness.closeHistoryConnection())));
  await resume(1);
  expect(await guest.evaluate(() => window.historySigningHarness.checkpoint())).toEqual(await page.evaluate(() => window.historySigningHarness.checkpoint()));
});

for (const seats of [3, 4, 5]) {
  test(`${seats}-seat join-code table collects votes across independent peer links`, async ({ page, context }) => {
    const pages = [page];
    for (let seat = 1; seat < seats; seat++) pages.push(await context.newPage());
    await Promise.all(pages.map(ready));
    const keys = Array.from({ length: seats }, () => generatePrivateKey());
    const roster = keys.map(key => privateKeyToAccount(key).address);
    const accounts = Array.from({ length: seats }, () => privateKeyToAccount(generatePrivateKey()));
    const wallets = accounts.map(account => account.address);
    const inputs = keys.map((key, seat) => ({ key, roster, wallets, seat, mode: 'betting' as const }));
    const terms = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.enrollmentData(input), inputs[seat])));
    const signatures = await Promise.all(accounts.map((account, seat) => account.signTypedData(terms[seat].typedData)));
    const enrollmentWire = JSON.stringify({ sessionId: terms[0].sessionId, signatures });
    const references = await Promise.all(pages.map((p, seat) => p.evaluate(input => window.historySigningHarness.initializeArchived(input), { ...inputs[seat], enrollmentWire })));
    for (let seat = 1; seat < seats; seat++) {
      const offer = await page.evaluate(seat => window.historySigningHarness.createHistoryPeerOffer(seat), seat);
      const answer = await pages[seat].evaluate(offer => window.historySigningHarness.acceptHistoryPeerOffer(offer), offer);
      await page.evaluate(({ seat, answer }) => window.historySigningHarness.finishHistoryPeerAnswer(seat, answer), { seat, answer });
    }
    await Promise.all(pages.map(p => p.waitForFunction(() => window.historySigningHarness.allHistoryPeerConnectionsOpen())));
    await Promise.all(pages.map((p, seat) => p.evaluate(seat => window.historySigningHarness.startHistoryTable(seat), seat)));
    await Promise.all(pages.map(p => p.waitForFunction(() => window.historySigningHarness.historyTableStatus().ready)));
    await page.evaluate(() => window.historySigningHarness.proposeToHistoryPeers('{"move":"call"}'));
    await Promise.all(pages.slice(1).map(p => p.waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(e => e.kind === 'proposal'))));
    // Withhold the last seat, proving partial agreement cannot commit.
    await Promise.all(pages.slice(1, -1).map(p => p.evaluate(() => window.historySigningHarness.acknowledgeOverChannel())));
    await page.waitForFunction(() => window.historySigningHarness.channelMissingSeats()?.length === 1);
    await expect(page.evaluate(() => window.historySigningHarness.commitToHistoryPeers())).rejects.toThrow('missing_acknowledgments');
    expect((await page.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(0);
    await pages[seats - 1].evaluate(() => window.historySigningHarness.acknowledgeOverChannel());
    await page.waitForFunction(() => window.historySigningHarness.channelMissingSeats()?.length === 0);
    await page.evaluate(() => window.historySigningHarness.commitToHistoryPeers());
    await Promise.all(pages.slice(1).map(p => p.waitForFunction(() => window.historySigningHarness.checkpoint().sequence === 1)));
    const checkpoint = await page.evaluate(() => window.historySigningHarness.checkpoint());
    for (const peer of pages.slice(1)) expect(await peer.evaluate(() => window.historySigningHarness.checkpoint())).toEqual(checkpoint);
    // Losing one guest stops the honest relay's whole table, then reaches every other guest.
    await pages[seats - 1].evaluate(() => window.historySigningHarness.closeOneHistoryPeer(0));
    await Promise.all(pages.map(p => p.waitForFunction(() => Boolean(window.historySigningHarness.historyTableStatus().closed))));
    for (const p of pages) expect((await p.evaluate(() => window.historySigningHarness.historyTableStatus())).ready).toBe(false);
    await Promise.all(pages.map(p => p.evaluate(() => window.historySigningHarness.closeHistoryPeers())));
    const last = seats - 1;
    await pages[last].reload();
    await pages[last].waitForFunction(() => Boolean(window.historySigningHarness));
    await pages[last].evaluate(input => window.historySigningHarness.initializeArchived(input), {
      ...inputs[last], enrollmentWire, reference: references[last].journalReference, archiveReference: references[last].archiveReference,
    });
    expect(await pages[last].evaluate(() => window.historySigningHarness.checkpoint())).toEqual(checkpoint);
  });
}


test('encryption roster authorization survives reload and cannot fork without using the gameplay journal', async ({ page, context }) => {
  const { pages, resume, wire } = await archivedBettingTable(page, context);
  // These are authorization fixture bytes, not valid shuffle-key proofs.
  const announcements = [toHex('worker public bytes zero'), toHex('worker public bytes one')];
  const protocol = keccak256(toHex('test encryption protocol'));
  const references = await Promise.all(pages.map(p => p.evaluate(input => window.historySigningHarness.initializeEncryptionRoster(input), { protocol, announcements })));
  const signatures = await Promise.all(pages.map((p, seat) => p.evaluate(({ seat, announcement }) => window.historySigningHarness.signEncryptionRoster(seat, announcement), { seat, announcement: announcements[seat] })));
  await Promise.all(pages.map(p => p.evaluate(signatures => window.historySigningHarness.verifyEncryptionRoster(signatures), signatures)));
  await expect(page.evaluate(signature => window.historySigningHarness.verifyEncryptionRoster([signature, signature]), signatures[0])).rejects.toThrow('wrong_signer');
  await resume(0);
  const changed = [...announcements]; changed[1] = toHex('host substituted bytes');
  await page.evaluate(input => window.historySigningHarness.initializeEncryptionRoster(input), { protocol, announcements: changed, reference: references[0] });
  await expect(page.evaluate(announcement => window.historySigningHarness.signEncryptionRoster(0, announcement), announcements[0])).rejects.toThrow('equivocation');
  expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
  await page.evaluate(input => window.historySigningHarness.initializeEncryptionRoster(input), { protocol, announcements, reference: references[0] });
  await page.evaluate(announcement => window.historySigningHarness.signEncryptionRoster(0, announcement), announcements[0]);
  await page.evaluate(signatures => window.historySigningHarness.verifyEncryptionRoster(signatures), signatures);
  // Existing gameplay sequence one remains independently valid and recoverable.
  await page.evaluate(wire => window.historySigningHarness.append(wire), wire);
  expect((await page.evaluate(() => window.historySigningHarness.checkpoint())).sequence).toBe(1);
});
