/**
 * On-chain assertions via RPC (pass criteria = effect, not button enabled).
 */
import {
  createPublicClient,
  http,
  type Hex,
  type Address,
} from "viem";
import { foundry } from "viem/chains";
import { DEFAULT_E2E_CHAIN_ID, DEFAULT_E2E_RPC } from "../wallet/fixture";

export function makePublicClient(rpcUrl = DEFAULT_E2E_RPC, chainId = DEFAULT_E2E_CHAIN_ID) {
  const chain = {
    ...foundry,
    id: chainId,
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  };
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function getEthBalance(address: Address, rpcUrl = DEFAULT_E2E_RPC) {
  const client = makePublicClient(rpcUrl);
  return client.getBalance({ address });
}

export async function waitForTx(hash: Hex, rpcUrl = DEFAULT_E2E_RPC) {
  const client = makePublicClient(rpcUrl);
  return client.waitForTransactionReceipt({ hash });
}

export async function assertChainId(expected = DEFAULT_E2E_CHAIN_ID, rpcUrl = DEFAULT_E2E_RPC) {
  const client = makePublicClient(rpcUrl, expected);
  const id = await client.getChainId();
  if (id !== expected) {
    throw new Error(`RPC chain id ${id} !== expected ${expected} (${rpcUrl})`);
  }
  return id;
}
