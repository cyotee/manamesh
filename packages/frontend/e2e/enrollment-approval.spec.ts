import { test, expect, ANVIL_ACCOUNT_0, ANVIL_ACCOUNT_1 } from './wallet/fixture';
test.use({ trace: 'off' });
test('wallet approval requires explicit review and produces a verified enrollment signature', async ({ walletPage: page }) => {
  await page.goto('/e2e/enrollment-approval.html');
  await page.waitForFunction(() => Boolean((window as any).enrollmentApprovalHarness));
  await page.evaluate(wallets => (window as any).enrollmentApprovalHarness.initialize(wallets), [ANVIL_ACCOUNT_0.address, ANVIL_ACCOUNT_1.address]);
  const approve = page.getByRole('button', { name: 'Approve session identity' });
  await expect(approve).toBeDisabled();
  await expect(page.getByText(ANVIL_ACCOUNT_0.address, { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).enrollmentApprovalHarness.count())).toBe(0);
  await page.getByRole('checkbox').check(); await approve.click();
  await expect(page.getByRole('button', { name: 'Approval submitted' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).enrollmentApprovalHarness.count())).toBe(1);
});
test('an account-change event during a paused provider request prevents approval submission', async ({ walletPage: page }) => {
  await page.goto('/e2e/enrollment-approval.html');
  await page.waitForFunction(() => Boolean((window as any).enrollmentApprovalHarness));
  await page.evaluate(wallets => {
    const ethereum = (window as any).ethereum;
    const original = ethereum.request.bind(ethereum);
    ethereum.request = async (input: { method: string }) => {
      if (input.method === 'eth_signTypedData_v4') {
        (window as any).signingRequested = true;
        await new Promise<void>(resolve => { (window as any).releaseSigning = resolve; });
      }
      return original(input);
    };
    (window as any).enrollmentApprovalHarness.initialize(wallets);
  }, [ANVIL_ACCOUNT_0.address, ANVIL_ACCOUNT_1.address]);
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Approve session identity' }).click();
  await page.waitForFunction(() => (window as any).signingRequested);
  await page.evaluate(() => { (window as any).ethereum.emit('accountsChanged', []); (window as any).releaseSigning(); });
  await expect(page.getByRole('alert')).toContainText('Your wallet changed during approval');
  expect(await page.evaluate(() => (window as any).enrollmentApprovalHarness.count())).toBe(0);
});
