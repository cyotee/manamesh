/**
 * E2eWalletToolbar
 *
 * Programmatic wallet connect for Playwright injected EIP-1193 wallets.
 * Connects **directly via window.ethereum** (not RainbowKit modal / MetaMask
 * connector discovery) so e2e never hangs on "Connecting…".
 *
 * Test ids:
 * - data-testid="e2e-connect-wallet"
 * - data-testid="e2e-wallet-address"
 * - data-testid="e2e-wallet-chain"
 * - data-testid="e2e-disconnect-wallet"
 */

import React, { useCallback, useEffect, useState } from "react";
import { isE2eWalletMode } from "../config";

type Injected = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getEthereum(): Injected | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Injected }).ethereum ?? null;
}

function hasWindowEthereum(): boolean {
  return Boolean(getEthereum());
}

export const E2eWalletToolbar: React.FC = () => {
  const [show, setShow] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShow(isE2eWalletMode() || (import.meta.env.DEV && hasWindowEthereum()));
  }, []);

  const refresh = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) {
      setAddress(null);
      setChainId(null);
      return;
    }
    try {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      setAddress(accounts?.[0] ?? null);
      const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(chainHex, 16));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!show) return;
    void refresh();
    const eth = getEthereum();
    if (!eth?.on) return;
    const onAccounts = () => void refresh();
    const onChain = () => void refresh();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [show, refresh]);

  const onConnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const eth = getEthereum();
      if (!eth) {
        throw new Error("window.ethereum not found — inject EIP-1193 first");
      }
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts?.[0]) {
        throw new Error("No accounts returned from provider");
      }
      setAddress(accounts[0]);
      const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(chainHex, 16));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDisconnect = useCallback(() => {
    // Injected e2e wallets have no real disconnect; clear local UI state.
    setAddress(null);
    setError(null);
  }, []);

  // Programmatic API for page.evaluate in Playwright.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = {
      isConnected: Boolean(address),
      address,
      chainId,
      connect: () => onConnect(),
      disconnect: () => onDisconnect(),
      hasEthereum: hasWindowEthereum(),
      request: (method: string, params?: unknown[]) => {
        const eth = getEthereum();
        if (!eth) return Promise.reject(new Error("no ethereum"));
        return eth.request({ method, params });
      },
    };
    (window as unknown as { __manameshE2e?: typeof api }).__manameshE2e = api;
    return () => {
      delete (window as unknown as { __manameshE2e?: typeof api }).__manameshE2e;
    };
  }, [address, chainId, onConnect, onDisconnect]);

  if (!show) return null;

  return (
    <div
      data-testid="e2e-wallet-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "#1e293b",
        borderBottom: "1px solid #334155",
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
        color: "#e2e8f0",
      }}
    >
      <span style={{ color: "#94a3b8" }}>E2E wallet</span>
      {address ? (
        <>
          <span data-testid="e2e-wallet-address" title={address}>
            {address}
          </span>
          <span data-testid="e2e-wallet-chain" style={{ color: "#94a3b8" }}>
            chain:{chainId ?? "?"}
          </span>
          <button
            type="button"
            data-testid="e2e-disconnect-wallet"
            onClick={onDisconnect}
            style={btnStyle}
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          type="button"
          data-testid="e2e-connect-wallet"
          onClick={() => void onConnect()}
          disabled={busy}
          style={btnStyle}
        >
          {busy ? "Connecting…" : "Connect Wallet"}
        </button>
      )}
      {error && (
        <span data-testid="e2e-wallet-error" style={{ color: "#f87171" }}>
          {error}
        </span>
      )}
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};

export default E2eWalletToolbar;
