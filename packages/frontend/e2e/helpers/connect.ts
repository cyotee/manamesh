import type { Page } from "@playwright/test";
import { ANVIL_ACCOUNT_0, DEFAULT_E2E_CHAIN_ID } from "../wallet/fixture";

/** Poker SPA entry path (Vite multi-page). */
export const POKER_PATH =
  process.env.E2E_POKER_PATH ?? "/src/pages/poker/";

/**
 * Clear wagmi localStorage and open poker page.
 */
export async function preparePokerPage(
  page: Page,
  path: string = POKER_PATH,
) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.evaluate((chainId) => {
    for (const k of Object.keys(localStorage)) {
      if (k.includes("wagmi") || k.includes("rk-") || k.includes("rainbow")) {
        localStorage.removeItem(k);
      }
    }
    localStorage.setItem("manamesh:e2e-chain-id", String(chainId));
  }, DEFAULT_E2E_CHAIN_ID);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("poker-app-root").waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * Click the e2e connect toolbar (injected connector — no RainbowKit modal).
 */
export async function connectInjectedWallet(page: Page) {
  const short = ANVIL_ACCOUNT_0.address.slice(0, 6).toLowerCase();
  const addr = page.getByTestId("e2e-wallet-address");
  if (await addr.isVisible().catch(() => false)) {
    const text = (await addr.textContent())?.toLowerCase() ?? "";
    if (text.includes(short)) return;
  }

  const connectBtn = page.getByTestId("e2e-connect-wallet");
  await connectBtn.waitFor({ state: "visible", timeout: 20_000 });
  await connectBtn.click();
  await addr.waitFor({ state: "visible", timeout: 25_000 });
}
