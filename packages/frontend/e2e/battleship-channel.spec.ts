import { test, expect } from '@playwright/test';
import type * as Harness from './battleship-channel-harness';
declare global { interface Window { battleshipHarness: typeof Harness } }

test('two isolated browsers exchange Battleship guesses and verified reveals over WebRTC', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage(); const guest = await guestContext.newPage();
    const errors: string[] = [];
    for (const page of [host, guest]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/e2e/battleship-channel.html');
      await page.waitForFunction(() => !!window.battleshipHarness);
    }
    const offer = await host.evaluate(() => window.battleshipHarness.offer());
    const answer = await guest.evaluate(offer => window.battleshipHarness.answer(offer), offer);
    await host.evaluate(answer => window.battleshipHarness.finish(answer), answer);
    for (const page of [host, guest]) await page.waitForFunction(() => window.battleshipHarness.isOpen());
    await host.evaluate(() => window.battleshipHarness.start('host'));
    await guest.evaluate(() => window.battleshipHarness.start('guest'));
    for (const page of [host, guest]) {
      await page.getByRole('button', { name: 'Randomize', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm Placement', exact: true }).click();
    }
    for (const page of [host, guest]) await expect(page.getByText('Phase: battle', { exact: false })).toBeVisible();
    const firstSeat = await host.evaluate(() => window.battleshipHarness.activeSeat());
    expect(['0', '1']).toContain(firstSeat);
    const turnOrder = firstSeat === '0' ? [host, guest] : [guest, host];
    for (const page of turnOrder) {
      await expect(page.getByText('Your turn. Click a cell on the opponent grid.', { exact: true })).toBeVisible();
      const target = page.getByTitle('A1', { exact: true }).nth(1);
      await target.click();
      await expect(target).toHaveText(/^(X|o)$/);
    }
    for (const page of [host, guest]) {
      expect((await page.evaluate(() => window.battleshipHarness.receivedSignals())).sort()).toEqual(['bs_guess', 'bs_reveal']);
    }
    expect(errors).toEqual([]);
  } finally { await hostContext.close(); await guestContext.close(); }
});
