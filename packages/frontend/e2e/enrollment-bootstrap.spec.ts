import { test, expect } from '@playwright/test';
import { installInjectedWallet } from './wallet/injectWallet';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type * as Harness from './history-signing-harness';
declare global { interface Window { historySigningHarness: typeof Harness } }
test.use({ trace: 'off' });
for (const [scenario, seats] of [2, 5, 2].entries()) {
  test(`${seats} wallets ${scenario === 2 ? 'close incomplete enrollment without opening history' : 'enroll session keys over real join-code links before history startup'}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const contexts = await Promise.all(Array.from({ length: seats }, () => browser.newContext()));
    let failed = false;
    try {
      const pages = await Promise.all(contexts.map(context => context.newPage()));
      const keys = pages.map(() => generatePrivateKey());
      const walletKeys = pages.map(() => generatePrivateKey());
      await Promise.all(pages.map(async (page, seat) => {
        await installInjectedWallet(page, { privateKey: walletKeys[seat], chainId: 31337 });
        page.setDefaultTimeout(20_000);
        await page.goto('/e2e/history-signing.html');
        await page.waitForFunction(() => Boolean(window.historySigningHarness));
      }));
      const roster = keys.map(key => privateKeyToAccount(key).address);
      const wallets = walletKeys.map(key => privateKeyToAccount(key).address);
      const inputs = keys.map((key, seat) => ({ key, seat, roster, wallets, mode: 'dealtBetting' as const, dealer: 0 }));
      for (let seat = 1; seat < seats; seat++) {
        const offer = await pages[0].evaluate(seat => window.historySigningHarness.createHistoryPeerOffer(seat), seat);
        const answer = await pages[seat].evaluate(offer => window.historySigningHarness.acceptHistoryPeerOffer(offer), offer);
        await pages[0].evaluate(({ seat, answer }) => window.historySigningHarness.finishHistoryPeerAnswer(seat, answer), { seat, answer });
      }
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.allHistoryPeerConnectionsOpen())));
      await Promise.all(pages.map((page, seat) => page.evaluate(input => window.historySigningHarness.startEnrollmentBootstrap(input), inputs[seat])));
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.enrollmentBootstrapStatus().ready)));
      if (scenario === 2) {
        await pages[1].evaluate(() => window.historySigningHarness.closeEnrollmentBootstrap());
        await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.enrollmentBootstrapStatus().closed)));
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBeUndefined();
          expect(await page.evaluate(() => window.historySigningHarness.allHistoryPeerConnectionsOpen())).toBe(false);
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
        }
        return;
      }
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.mountEnrollmentApproval())));
      for (let seat = 0; seat < seats; seat++) {
        await expect(pages[0].evaluate(input => window.historySigningHarness.initializeArchivedFromBootstrap(input), inputs[0])).rejects.toThrow('incomplete');
        const approve = pages[seat].getByRole('button', { name: 'Approve session identity' });
        await expect(approve).toBeDisabled();
        await pages[seat].getByRole('checkbox').check();
        await approve.click();
        await expect(pages[seat].getByRole('button', { name: 'Approval submitted' })).toBeDisabled();
        await Promise.all(pages.map(page => page.waitForFunction(seat => !window.historySigningHarness.enrollmentBootstrapStatus().missing.includes(seat), seat)));
      }
      await Promise.all(pages.map((page, seat) => page.evaluate(input => window.historySigningHarness.initializeArchivedFromBootstrap(input), inputs[seat])));
      await Promise.all(pages.map((page, seat) => page.evaluate(seat => window.historySigningHarness.startHistoryTable(seat), seat)));
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.historyTableStatus().ready)));
      const checkpoints = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.checkpoint())));
      expect(new Set(checkpoints.map(checkpoint => checkpoint.head)).size).toBe(1);
      expect(checkpoints.every(checkpoint => checkpoint.sequence === 0)).toBe(true);
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeHistoryPeers())));
    } catch (error) { failed = true; throw error; }
    finally {
      const results = await Promise.allSettled(contexts.map(context => context.close()));
      const rejected = results.find(result => result.status === 'rejected');
      if (!failed && rejected?.status === 'rejected') throw rejected.reason;
    }
  });
}
