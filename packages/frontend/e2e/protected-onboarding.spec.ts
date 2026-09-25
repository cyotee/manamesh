import { test, expect } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { installInjectedWallet } from './wallet/injectWallet';
test.use({ trace: 'off' });
if (process.env.CI && !process.env.POKER_SHUFFLE_WASM) throw new Error('Onboarding checks require pinned WASM');
test.skip(!process.env.POKER_SHUFFLE_WASM, 'Requires the pinned local module');

test('onboards through the Poker page and completes an uncontested hand using only UI controls', async ({ browser }) => {
  test.setTimeout(180_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const keys = pages.map(() => generatePrivateKey());
    const wallets = keys.map(key => privateKeyToAccount(key));
    const domain = privateKeyToAccount(generatePrivateKey()).address;
    for (const [seat, page] of pages.entries()) {
      page.setDefaultTimeout(30_000);
      await installInjectedWallet(page, { privateKey: keys[seat], chainId: 31337 });
      await page.goto('/src/pages/poker/?protected=1');
      await page.getByLabel('Agreed domain address', { exact: true }).fill(domain);
      await page.getByRole('button', { name: 'Connect wallet and create identity', exact: true }).click();
      await expect(page.getByLabel('Your public identity', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => 'historySigningHarness' in window)).toBe(false);
    }
    const identities = await Promise.all(pages.map(async page => JSON.parse(await page.getByLabel('Your public identity', { exact: true }).inputValue())));
    for (const page of pages) await page.getByLabel('Expected wallets in seat order', { exact: true }).fill(wallets.map(wallet => wallet.address).join('\n'));
    await pages[0].getByText('Create an invitation', { exact: true }).click();
    await pages[0].getByLabel('Public participant identities', { exact: true }).fill(JSON.stringify(identities));
    await pages[0].getByRole('button', { name: 'Create invitation', exact: true }).click();
    await expect(pages[0].getByLabel('Public invitation', { exact: true })).not.toHaveValue('');
    const invitation = await pages[0].getByLabel('Public invitation', { exact: true }).inputValue();
    await pages[1].getByLabel('Public invitation', { exact: true }).fill(invitation);
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'Review invitation and connect', exact: true }).click()));
    await expect(pages[0].getByLabel('Offer for seat 2', { exact: true })).not.toHaveValue('');
    await pages[1].getByLabel('Your join offer', { exact: true }).fill(await pages[0].getByLabel('Offer for seat 2', { exact: true }).inputValue());
    await pages[1].getByRole('button', { name: 'Accept join offer', exact: true }).click();
    await expect(pages[1].getByLabel('Your join answer', { exact: true })).not.toHaveValue('');
    await pages[0].getByLabel('Answer from seat 2', { exact: true }).fill(await pages[1].getByLabel('Your join answer', { exact: true }).inputValue());
    await pages[0].getByRole('button', { name: 'Connect seat 2', exact: true }).click();
    for (const page of pages) {
      const approve = page.getByRole('button', { name: 'Approve session identity', exact: true });
      await expect(approve).toBeDisabled();
      await page.getByRole('checkbox', { name: 'I checked the wallets, signing identities and game terms with the other players.', exact: true }).check();
      await approve.click();
    }
    for (const label of ['encryption roster', 'encrypted deck', 'private deal']) for (const page of pages) {
      const approve = page.getByRole('button', { name: `Approve ${label}`, exact: true });
      await expect(approve).toBeDisabled();
      await page.getByLabel('Review protocol approval', { exact: true }).check();
      await approve.click();
    }
    async function commit(sequence: number) {
      for (const page of pages) {
        await expect(page.getByText(new RegExp(`^Checkpoint ${sequence}, parent `))).toBeVisible();
        await page.getByLabel('Review proposed action', { exact: true }).check();
        await page.getByRole('button', { name: 'Approve proposed action', exact: true }).click();
      }
      await pages[0].getByRole('button', { name: 'Commit approved action', exact: true }).click();
      for (const page of pages) await expect(page.getByText(new RegExp(`· Checkpoint ${sequence}$`))).toBeVisible();
    }
    await pages[0].getByRole('button', { name: 'Propose table transition', exact: true }).click();
    await commit(1);
    await pages[0].getByRole('button', { name: 'Propose fold', exact: true }).click();
    await commit(2);
    await pages[0].getByRole('button', { name: 'Propose table transition', exact: true }).click();
    await commit(3);
    for (const page of pages) {
      await expect(page.getByText('Hand complete: uncontested', { exact: true })).toBeVisible();
      await expect(page.getByText('Community cards: None', { exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await pages[0].getByRole('button', { name: 'Leave table', exact: true }).click();
    for (const page of pages) await expect(page.getByText('This preview is closed. Reload to create a fresh session.', { exact: true })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('refuses unavailable verification code before requesting wallet access', async ({ page }) => {
  await installInjectedWallet(page);
  await page.route('**/poker-protected.wasm', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/src/pages/poker/?protected=1');
  await page.evaluate(() => {
    const target = window as unknown as { ethereum: { request: (args: { method: string }) => Promise<unknown> }; previewRequests: string[] };
    target.previewRequests = [];
    const request = target.ethereum.request.bind(target.ethereum);
    target.ethereum.request = args => { target.previewRequests.push(args.method); return request(args); };
  });
  await page.getByLabel('Agreed domain address', { exact: true }).fill('0x1111111111111111111111111111111111111111');
  await page.getByRole('button', { name: 'Connect wallet and create identity', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Your public identity', { exact: true })).toHaveCount(0);
  const requests = await page.evaluate(() => (window as unknown as { previewRequests: string[] }).previewRequests);
  expect(requests).not.toContain('eth_requestAccounts'); expect(requests).not.toContain('eth_signTypedData_v4');
});
