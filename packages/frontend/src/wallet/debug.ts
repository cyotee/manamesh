/**
 * Wallet debug logging helpers.
 */

const WALLET_DEBUG_FLAG = String(
  import.meta.env.VITE_WALLET_DEBUG || "",
).toLowerCase();

export const walletDebugEnabled =
  import.meta.env.DEV &&
  (WALLET_DEBUG_FLAG === "1" ||
    WALLET_DEBUG_FLAG === "true" ||
    WALLET_DEBUG_FLAG === "yes");

export function walletDebug(...args: unknown[]) {
  if (!walletDebugEnabled) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}
