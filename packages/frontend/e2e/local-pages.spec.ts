import { test, expect } from '@playwright/test';

test('development console links to the existing game pages', async ({ page }) => {
  await page.goto('/src/pages/dev-console/');
  await expect(page.getByRole('heading', { name: 'ManaMesh development pages' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(6);
  await page.getByRole('link', { name: 'Simple card game', exact: true }).click();
  await expect(page.getByRole('region')).toHaveCount(2);
});

test('Threshold Tally mounts three seats and accepts a public DKG commitment', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/src/pages/threshold-tally/');
  await expect(page.getByRole('region')).toHaveCount(3);
  const firstSeat = page.getByRole('region', { name: 'Player 0', exact: true });
  const publish = firstSeat.getByRole('button', { name: 'Publish DKG Commitment', exact: true });
  await publish.click();
  await expect(publish).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('One Piece local mode opens deck selection and switches seats', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/src/pages/onepiece/');
  await page.getByRole('button', { name: 'Local (same browser)', exact: true }).click();
  await expect(page.getByText('Player 0 — choose a deck to load into the game', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Local seat', exact: true }).selectOption('1');
  await expect(page.getByRole('combobox', { name: 'Local seat', exact: true })).toHaveValue('1');
  await expect(page.getByText('Player 1 — choose a deck to load into the game', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
