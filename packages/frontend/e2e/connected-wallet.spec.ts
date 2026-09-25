import { recoverMessageAddress, recoverTypedDataAddress, keccak256, toHex, type Hex } from "viem";
import {
  test,
  expect,
  ANVIL_ACCOUNT_0,
  DEFAULT_E2E_CHAIN_ID,
} from "./wallet/fixture";
import { preparePokerPage, connectInjectedWallet, POKER_PATH } from "./helpers/connect";

/**
 * UI + connected wallet smoke (injected EIP-1193, not MetaMask).
 * Default: Anvil 31337. Requires `VITE_E2E=1` on the Vite server.
 */
test.describe("Connected wallet UI (Poker)", () => {
  test("injects wallet provider before load", async ({ walletPage }) => {
    await walletPage.goto(POKER_PATH);
    const hasProvider = await walletPage.evaluate(() => {
      const eth = (window as unknown as { ethereum?: { isMetaMask?: boolean; request?: unknown } })
        .ethereum;
      return Boolean(eth?.isMetaMask && typeof eth.request === "function");
    });
    expect(hasProvider).toBe(true);

    const accounts = await walletPage.evaluate(async () => {
      return (window as unknown as { ethereum: { request: (a: { method: string }) => Promise<string[]> } })
        .ethereum.request({ method: "eth_requestAccounts" });
    });
    expect(accounts[0]?.toLowerCase()).toBe(ANVIL_ACCOUNT_0.address.toLowerCase());

    const chainIdHex = await walletPage.evaluate(async () => {
      return (window as unknown as { ethereum: { request: (a: { method: string }) => Promise<string> } })
        .ethereum.request({ method: "eth_chainId" });
    });
    expect(Number.parseInt(chainIdHex, 16)).toBe(DEFAULT_E2E_CHAIN_ID);
  });

  test("Connect Wallet uses injected provider and shows full address", async ({
    walletPage,
    walletAddress,
  }) => {
    await preparePokerPage(walletPage);
    await connectInjectedWallet(walletPage);

    const shown = await walletPage.getByTestId("e2e-wallet-address").textContent();
    expect(shown?.toLowerCase()).toBe(walletAddress.toLowerCase());

    const chainText = await walletPage.getByTestId("e2e-wallet-chain").textContent();
    expect(chainText).toContain(String(DEFAULT_E2E_CHAIN_ID));

    // Programmatic API for deeper tx tests
    const api = await walletPage.evaluate(() => {
      const w = (window as unknown as { __manameshE2e?: { isConnected: boolean; address: string | null } })
        .__manameshE2e;
      return w ? { isConnected: w.isConnected, address: w.address } : null;
    });
    expect(api?.isConnected).toBe(true);
    expect(api?.address?.toLowerCase()).toBe(walletAddress.toLowerCase());
  });

  test("personal_sign recovers the connected wallet", async ({
    walletPage,
    walletAddress,
  }) => {
    await preparePokerPage(walletPage);
    await connectInjectedWallet(walletPage);

    const sig = await walletPage.evaluate(async (addr) => {
      const eth = (window as unknown as {
        ethereum: {
          request: (a: { method: string; params?: unknown[] }) => Promise<string>;
        };
      }).ethereum;
      return eth.request({
        method: "personal_sign",
        params: ["0x68656c6c6f", addr],
      });
    }, walletAddress);
    expect((await recoverMessageAddress({ message: { raw: "0x68656c6c6f" }, signature: sig as Hex })).toLowerCase()).toBe(walletAddress.toLowerCase());
  });
});


test("typed-data signing binds the wallet, message and domain", async ({ walletPage, walletAddress }) => {
  await preparePokerPage(walletPage); await connectInjectedWallet(walletPage);
  const typed = {
    domain: { name: "ManaMeshWalletTest", version: "1", chainId: DEFAULT_E2E_CHAIN_ID },
    types: { WalletProbe: [{ name: "challenge", type: "bytes32" }] },
    primaryType: "WalletProbe",
    message: { challenge: keccak256(toHex("wallet-probe")) },
  } as const;
  const signature = await walletPage.evaluate(async ({ address, typed }) => {
    return (window as any).ethereum.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typed)] });
  }, { address: walletAddress, typed }) as Hex;
  expect((await recoverTypedDataAddress({ ...typed, signature })).toLowerCase()).toBe(walletAddress.toLowerCase());
  for (const changed of [
    { ...typed, message: { challenge: keccak256(toHex("changed")) } },
    { ...typed, domain: { ...typed.domain, chainId: DEFAULT_E2E_CHAIN_ID + 1 } },
  ]) {
    expect((await recoverTypedDataAddress({ ...changed, signature })).toLowerCase()).not.toBe(walletAddress.toLowerCase());
  }
});

test("injected signer rejects another account", async ({ walletPage }) => {
  await preparePokerPage(walletPage); await connectInjectedWallet(walletPage);
  await expect(walletPage.evaluate(async () => (window as any).ethereum.request({
    method: "personal_sign", params: ["0x68656c6c6f", "0x0000000000000000000000000000000000000001"],
  }))).rejects.toThrow("Unauthorized account");
});
