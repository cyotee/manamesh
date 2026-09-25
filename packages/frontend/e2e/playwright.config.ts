import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * ManaMesh frontend Playwright config — injected-wallet e2e.
 * Default: Anvil chain 31337 + local Vite poker page.
 *
 * Run with Anvil optional for pure connect smoke; live settle needs:
 *   anvil + VITE_POKER_SETTLER_ADDRESS + VITE_POKER_CHAIN_ID
 */
export default defineConfig({
  testDir: "./",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command:
          process.env.E2E_WEB_SERVER_CMD ??
          `yarn workspace @cyotee/manamesh exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `${BASE_URL}/src/pages/poker/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        // package is packages/manamesh/packages/frontend → monorepo root is ../../../../
        cwd: process.cwd() + "/../../../..",
        env: {
          ...process.env,
          VITE_E2E: "1",
          VITE_ENABLE_E2E_WALLET: "1",
          VITE_E2E_CHAIN_ID: process.env.E2E_CHAIN_ID ?? "31337",
          VITE_E2E_RPC_URL:
            process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545",
          VITE_DEFAULT_CHAIN_ID: process.env.E2E_CHAIN_ID ?? "31337",
        },
      },
});
