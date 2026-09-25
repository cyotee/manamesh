/**
 * Build LiveBlockchainService options from window.ethereum (injected wallet).
 *
 * Used by Playwright e2e and local Anvil dev to prove the SPA can construct
 * assert/settle calls with a real EIP-1193 provider without MetaMask UI.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  type Hex,
  type WalletClient,
  type PublicClient,
} from "viem";
import type { SettlementReadClient, SettlementWriteClient } from "@manamesh/poker";
import {
  getSettlementTableConfigFromEnv,
} from "./config";
import type { LiveBlockchainServiceOptions } from "./live-service";
import { LiveBlockchainService } from "./live-service";
import { setBlockchainService } from "./mock-service";

export interface InjectedEthereum {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getEthereum(): InjectedEthereum | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: InjectedEthereum }).ethereum ?? null;
}

/**
 * Create viem wallet + public clients from injected provider + optional HTTP RPC.
 */
export async function createClientsFromInjected(options?: {
  rpcUrl?: string;
  chainId?: number;
}): Promise<{
  walletClient: WalletClient;
  publicClient: PublicClient;
  address: Hex;
  chainId: number;
}> {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error("window.ethereum not found — inject EIP-1193 provider first");
  }

  const accounts = await ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" ||
      !isAddress(accounts[0], { strict: false })) {
    throw new Error("No valid account from injected provider");
  }
  const address = accounts[0] as Hex;

  const chainIdHex = await ethereum.request({ method: "eth_chainId" });
  if (typeof chainIdHex !== "string" || !/^0x[0-9a-f]+$/i.test(chainIdHex)) {
    throw new Error("Invalid injected wallet chain ID");
  }
  const chainId = Number(chainIdHex);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Invalid injected wallet chain ID");
  }
  if (options?.chainId !== undefined && options.chainId !== chainId) {
    throw new Error("Wallet chain does not match the settlement chain");
  }

  const rpcUrl =
    options?.rpcUrl ??
    (import.meta.env.VITE_E2E_RPC_URL as string | undefined) ??
    (import.meta.env.VITE_RPC_URL as string | undefined) ??
    "http://127.0.0.1:8545";

  const chain = {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  } as const;

  const walletClient = createWalletClient({
    account: address,
    chain,
    transport: custom(ethereum),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  if (await publicClient.getChainId() !== chainId) {
    throw new Error("RPC chain does not match the settlement chain");
  }

  return { walletClient, publicClient, address, chainId };
}

/**
 * Adapt viem clients to settlement ports expected by LiveBlockchainService.
 */
export function settlementPortsFromViem(clients: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  address: Hex;
}): { write: SettlementWriteClient; read: SettlementReadClient; account: Hex } {
  const { walletClient, publicClient, address } = clients;
  const chainId = walletClient.chain?.id;
  if (!Number.isSafeInteger(chainId) || !chainId || chainId <= 0 ||
      publicClient.chain?.id !== chainId) {
    throw new Error("Settlement clients must have the same configured chain");
  }
  if (!isAddress(address, { strict: false })) {
    throw new Error("Invalid settlement account");
  }

  async function checkRpcChain() {
    if (await publicClient.getChainId() !== chainId) {
      throw new Error("RPC chain changed; reconnect settlement clients");
    }
  }

  const write: SettlementWriteClient = {
    async writeContract(args) {
      if (args.account !== undefined && args.account.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Settlement account does not match the connected account");
      }
      await checkRpcChain();
      const [currentChainId, accounts] = await Promise.all([
        walletClient.getChainId(), walletClient.getAddresses(),
      ]);
      if (currentChainId !== chainId) {
        throw new Error("Wallet chain changed; reconnect settlement clients");
      }
      if (accounts[0]?.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Wallet account changed; reconnect settlement clients");
      }
      const hash = await walletClient.writeContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args as readonly unknown[],
        account: address,
        chain: walletClient.chain,
      } as never);
      return hash as Hex;
    },
  };

  const read: SettlementReadClient = {
    async readContract(args) {
      await checkRpcChain();
      return publicClient.readContract({
        address: args.address,
        abi: args.abi,
        functionName: args.functionName,
        args: args.args as readonly unknown[],
      } as never);
    },
  };

  return { write, read, account: address };
}

/**
 * Install LiveBlockchainService from env table config + injected wallet.
 * Returns null when settler env is incomplete (safe no-op for mock-only e2e).
 */
export async function tryInstallLiveFromInjected(options?: {
  playerAddresses?: Record<string, Hex>;
  rpcUrl?: string;
}): Promise<LiveBlockchainService | null> {
  const table = getSettlementTableConfigFromEnv();
  if (!table) {
    console.warn(
      "[liveFromInjected] Missing VITE_POKER_SETTLER_ADDRESS / VITE_POKER_CHAIN_ID — stay on mock",
    );
    return null;
  }

  const clients = await createClientsFromInjected({
    rpcUrl: options?.rpcUrl,
    chainId: table.chainId,
  });
  const ports = settlementPortsFromViem(clients);

  const playerAddresses =
    options?.playerAddresses ??
    ({ "0": clients.address } as Record<string, Hex>);

  const liveOpts: LiveBlockchainServiceOptions = {
    write: ports.write,
    read: ports.read,
    table,
    playerAddresses,
    account: ports.account,
  };

  const service = new LiveBlockchainService(liveOpts);
  setBlockchainService(service);
  return service;
}
