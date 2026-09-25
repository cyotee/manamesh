import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient, WalletClient } from "viem";
import { createClientsFromInjected, settlementPortsFromViem, tryInstallLiveFromInjected } from "./liveFromInjected";
import { LiveBlockchainService } from "./live-service";
import { getBlockchainService, resetBlockchainService } from "./mock-service";

const rpc = vi.hoisted(() => ({ getChainId: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: ({ chain }: { chain: { id: number } }) => ({ ...rpc, chain }),
}));

const account = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";

describe("injected settlement network and account binding", () => {
  beforeEach(() => {
    rpc.getChainId.mockReset().mockResolvedValue(31337);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetBlockchainService();
  });

  function inject(chainId: unknown, accounts: unknown = [account]) {
    vi.stubGlobal("window", { ethereum: { request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return chainId;
      if (method === "eth_requestAccounts") return accounts;
      throw new Error(`Unexpected method ${method}`);
    }) } });
  }

  it("rejects the wrong wallet chain instead of relabeling it", async () => {
    inject("0x1");
    await expect(createClientsFromInjected({ chainId: 31337 })).rejects.toThrow(/chain/i);
  });

  it.each(["0x7a69junk", "0x0", "0x20000000000000", 31337])(
    "rejects invalid provider chain ID %s", async (chainId) => {
      inject(chainId);
      await expect(createClientsFromInjected()).rejects.toThrow(/chain/i);
    },
  );

  it("rejects malformed provider accounts", async () => {
    inject("0x7a69", ["not-an-address"]);
    await expect(createClientsFromInjected()).rejects.toThrow(/account/i);
  });

  it("rejects an HTTP RPC on a different chain", async () => {
    inject("0x7a69");
    rpc.getChainId.mockResolvedValue(1);
    await expect(createClientsFromInjected()).rejects.toThrow(/chain/i);
  });

  it("accepts matching wallet and RPC networks", async () => {
    inject("0x7a69");
    await expect(createClientsFromInjected({ chainId: 31337 })).resolves.toMatchObject({
      chainId: 31337, address: account,
    });
  });

  it("installs the real service only after network validation succeeds", async () => {
    vi.stubEnv("VITE_POKER_SETTLER_ADDRESS", other);
    vi.stubEnv("VITE_POKER_CHAIN_ID", "31337");
    const previous = getBlockchainService();
    inject("0x1");
    await expect(tryInstallLiveFromInjected()).rejects.toThrow(/chain/i);
    expect(getBlockchainService()).toBe(previous);
    inject("0x7a69");
    const service = await tryInstallLiveFromInjected();
    expect(service).toBeInstanceOf(LiveBlockchainService);
    expect(getBlockchainService()).toBe(service);
  });

  function ports() {
    const wallet = {
      chain: { id: 31337 }, getChainId: vi.fn().mockResolvedValue(31337),
      getAddresses: vi.fn().mockResolvedValue([account]),
      writeContract: vi.fn().mockResolvedValue("0x1234"),
    };
    const publicClient = {
      chain: { id: 31337 }, getChainId: vi.fn().mockResolvedValue(31337),
      readContract: vi.fn().mockResolvedValue(12n),
    };
    const ports = settlementPortsFromViem({
      walletClient: wallet as unknown as WalletClient,
      publicClient: publicClient as unknown as PublicClient, address: account,
    });
    const write = () => ports.write.writeContract({
      address: other, abi: [], functionName: "settleHand", args: [],
    } as never);
    return { wallet, publicClient, ports, write };
  }

  it.each([{ accounts: [] }, { accounts: [other, account] }])("rejects disconnected or changed active account $accounts", async ({ accounts }) => {
    const { wallet, write } = ports();
    wallet.getAddresses.mockResolvedValue(accounts);
    await expect(write()).rejects.toThrow(/account/i);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it("rejects a caller overriding the bound account", async () => {
    const { wallet, ports: { write } } = ports();
    await expect(write.writeContract({
      address: other, abi: [], functionName: "settleHand", args: [], account: other,
    } as never)).rejects.toThrow(/account/i);
    expect(wallet.writeContract).not.toHaveBeenCalled();
  });

  it.each(["wallet", "publicClient"] as const)("rejects changed %s chain before writing", async (client) => {
    const fixture = ports();
    fixture[client].getChainId.mockResolvedValue(1);
    await expect(fixture.write()).rejects.toThrow(/chain/i);
    expect(fixture.wallet.writeContract).not.toHaveBeenCalled();
  });

  it("rejects balance reads on a changed RPC chain", async () => {
    const { publicClient, ports: { read } } = ports();
    publicClient.getChainId.mockResolvedValue(1);
    await expect(read.readContract({ address: other, abi: [], functionName: "balanceOf", args: [account] } as never))
      .rejects.toThrow(/chain/i);
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("allows writes while account and networks match", async () => {
    const { wallet, write } = ports();
    await expect(write()).resolves.toBe("0x1234");
    expect(wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({ account }));
  });
});
