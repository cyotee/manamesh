import { test, expect } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type * as Harness from './history-signing-harness';
declare global { interface Window { historySigningHarness: typeof Harness } }
test.use({ trace: 'off' });

for (const automatic of [false, true]) test(`join-code game and verified Poker history retain separate routing (${automatic ? 'automatic readiness' : 'manual setup'})`, async ({ browser }) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const keys = [generatePrivateKey(), generatePrivateKey()];
    const roster = keys.map(key => privateKeyToAccount(key).address);
    for (const [seat, page] of pages.entries()) {
      await page.goto('/e2e/history-signing.html');
      await page.waitForFunction(() => Boolean(window.historySigningHarness));
      await page.evaluate(input => window.historySigningHarness.initialize(input), { key: keys[seat], roster, seat });
    }
    const offer = await pages[0].evaluate(auto => window.historySigningHarness.createJoinHistoryOffer(auto), automatic);
    const answer = await pages[1].evaluate(({ code, auto }) => window.historySigningHarness.acceptJoinHistoryOffer(code, auto), { code: offer, auto: automatic });
    await pages[0].evaluate(code => window.historySigningHarness.finishJoinHistoryAnswer(code), answer);
    await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.joinHistoryConnected())));
    if (automatic) {
      await pages[0].evaluate(() => window.historySigningHarness.startJoinHistoryReady(0));
      await pages[0].waitForTimeout(700); // The responder registers after the first readiness announcement.
      await pages[1].evaluate(() => window.historySigningHarness.startJoinHistoryReady(1));
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.joinHistoryReady().ready)));
      for (const page of pages) expect(await page.evaluate(() => window.historySigningHarness.joinHistoryReady().error)).toBeUndefined();
    } else {
      await pages[0].evaluate(() => window.historySigningHarness.openJoinHistoryChannel());
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.historyChannelOpen())));
    }
    const proposal = await pages[0].evaluate(() => window.historySigningHarness.propose(7));
    const wire = JSON.stringify(proposal);
    const acks = await Promise.all(pages.map(page => page.evaluate(value => window.historySigningHarness.acknowledge(value), wire)));
    const batch = JSON.stringify([{ ...proposal, acknowledgments: acks.map(ack => ack.signature) }]);
    await pages[0].evaluate(value => window.historySigningHarness.sendHistoryBatch(value), batch);
    await pages[1].waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(event => event.kind === 'checkpoint' && event.sequence === 1));
    expect(await pages[1].evaluate(() => window.historySigningHarness.receivedJoinGameMessages())).toEqual([]);
    await pages[0].evaluate(() => window.historySigningHarness.sendJoinGameMessage('game-route-intact'));
    await expect.poll(() => pages[1].evaluate(() => window.historySigningHarness.receivedJoinGameMessages())).toEqual(['game-route-intact']);
    if (!automatic) {
    await pages[0].evaluate(() => window.historySigningHarness.sendHistoryFrameForTest('{}'));
    await pages[1].waitForFunction(() => window.historySigningHarness.historyChannelEvents().some(event => event.kind === 'rejected'));
    expect(await pages[1].evaluate(() => window.historySigningHarness.receivedJoinGameMessages())).toEqual(['game-route-intact']);
    }
    if (automatic) {
      await pages[0].evaluate(() => window.historySigningHarness.closeJoinHistory());
      await pages[1].waitForFunction(() => Boolean(window.historySigningHarness.joinHistoryReady().closed));
      const status = await pages[1].evaluate(() => window.historySigningHarness.joinHistoryReady());
      expect(status.ready).toBe(false);
      // Chromium may report SCTP shutdown as an error before the close event.
      expect(['poker_join:closed', 'poker_join:error']).toContain(status.closed);
      await expect(pages[1].evaluate(value => window.historySigningHarness.sendHistoryBatch(value), batch)).rejects.toThrow('closed');
    }
    await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeJoinHistory())));
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
