import { hashTypedData } from "viem";
import type { SignedAction } from "./sign";
/**
 * Tests for EIP-712 Verification Utilities
 */

import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MANAMESH_DOMAIN } from "./domain";
import { getTypesForAction, JoinGameTypes, type JoinGameData } from "./types";
import { hashTypedAction, verifySignedAction, verifySignedActions } from "./verify";

describe("EIP-712 Verification", () => {
  it("verifies a JoinGame signature roundtrip", async () => {
    const account = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );

    const data = {
      gameId: "game-123",
      playerId: "player-0",
      publicKey: "0xabcd1234" as `0x${string}`,
      timestamp: 1000000n,
    };

    const types = getTypesForAction("JoinGame");

    const signature = await account.signTypedData({
      domain: MANAMESH_DOMAIN,
      types,
      primaryType: "JoinGame",
      message: data,
    });

    const result = await verifySignedAction({
      actionType: "JoinGame",
      data,
      signature,
      signer: account.address,
      signedAt: Date.now(),
    });

    expect(result.isValid).toBe(true);
    expect(result.recoveredAddress?.toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
  });

  describe("hashTypedAction", () => {
    it("produces consistent hash for same data", () => {
      const data = {
        gameId: "game-123",
        playerId: "player-0",
        publicKey: "0xabcd1234" as `0x${string}`,
        timestamp: 1000000n,
      };

      const hash1 = hashTypedAction("JoinGame", data);
      const hash2 = hashTypedAction("JoinGame", data);

      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different data", () => {
      const data1 = {
        gameId: "game-123",
        playerId: "player-0",
        publicKey: "0xabcd1234" as `0x${string}`,
        timestamp: 1000000n,
      };

      const data2 = {
        gameId: "game-456",
        playerId: "player-0",
        publicKey: "0xabcd1234" as `0x${string}`,
        timestamp: 1000000n,
      };

      const hash1 = hashTypedAction("JoinGame", data1);
      const hash2 = hashTypedAction("JoinGame", data2);

      expect(hash1).not.toBe(hash2);
    });

    it("produces 0x-prefixed hex hash", () => {
      const data = {
        gameId: "game-123",
        playerId: "player-0",
        publicKey: "0xabcd1234" as `0x${string}`,
        timestamp: 1000000n,
      };

      const hash = hashTypedAction("JoinGame", data);

      expect(hash.startsWith("0x")).toBe(true);
      expect(hash.length).toBe(66); // 0x + 64 hex chars
    });

    it("produces different hash for different action types", () => {
      // Use proper bytes32 values (64 hex chars after 0x)
      const commitment = ("0x" + "ab".repeat(32)) as `0x${string}`;
      const proof = ("0x" + "cd".repeat(32)) as `0x${string}`;

      const commitShuffleData = {
        gameId: "game-123",
        playerId: "player-0",
        shuffleIndex: 1n,
        commitment,
        proof,
        timestamp: 1000000n,
      };

      const revealCardData = {
        gameId: "game-123",
        playerId: "player-0",
        cardIndex: 1n,
        cardId: "AS",
        decryptionShare: ("0x" + "ef".repeat(32)) as `0x${string}`,
        timestamp: 1000000n,
      };

      const hash1 = hashTypedAction("CommitShuffle", commitShuffleData);
      const hash2 = hashTypedAction("RevealCard", revealCardData);

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('typed action verification', () => {
  it('verifies real signatures in a batch and rejects modified messages', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const data: JoinGameData = { gameId: 'verification-test', playerId: '0', publicKey: '0x1234', timestamp: 1n };
    const typedData = { domain: MANAMESH_DOMAIN, types: JoinGameTypes, primaryType: 'JoinGame' as const, message: { ...data } };
    const signature = await account.signTypedData(typedData);
    const signed = { actionType: 'JoinGame', data, signature, signer: account.address, signedAt: 1 } as SignedAction<JoinGameData>;
    expect(hashTypedAction('JoinGame', data)).toBe(hashTypedData(typedData));
    const results = await verifySignedActions([signed, { ...signed, data: { ...data, playerId: '1' } }]);
    expect(results.map(result => result.isValid)).toEqual([true, false]);
  });

  it('requires the matching explicit domain for a signature from another chain', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const data: JoinGameData = { gameId: 'domain-test', playerId: '0', publicKey: '0x1234', timestamp: 1n };
    const domain = { ...MANAMESH_DOMAIN, chainId: 31337 };
    const signature = await account.signTypedData({ domain, types: JoinGameTypes, primaryType: 'JoinGame', message: { ...data } });
    const signed = { actionType: 'JoinGame', data, signature, signer: account.address, signedAt: 1 } as SignedAction<JoinGameData>;
    expect((await verifySignedAction(signed)).isValid).toBe(false);
    expect((await verifySignedAction(signed, { domain })).isValid).toBe(true);
  });
});
