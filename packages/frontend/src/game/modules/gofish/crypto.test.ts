import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";

import {
  createCryptoGoFishState,
  submitPublicKey,
  submitZkSigPublicKey,
  distributeKeyShares,
  encryptDeck,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleDeck,
  peekHand,
  askRank,
  respondToAsk,
  goFish,
  claimBooks,
  submitDecryptionShare,
  submitZkProofRespondToAsk,
  submitZkVerdict,
  allKeysSubmitted,
} from "./crypto";
import type { CryptoGoFishState } from "./types";
import {
  createPlayerCryptoContext,
  type CryptoPlayerContext,
} from "../../../crypto";
import { createKeyShares } from "../../../crypto/shamirs";
import {
  ecdsaGenerateKeyPair,
  ecdsaSignDigestHex,
  sha256Hex,
  stableStringify,
} from "../../../crypto";

describe("CryptoGoFish", () => {
  let state: CryptoGoFishState;
  let ctx: Ctx;
  let playerA: CryptoPlayerContext;
  let playerB: CryptoPlayerContext;

  beforeEach(() => {
    const seedA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const seedB = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);
    playerA = createPlayerCryptoContext("playerA", seedA);
    playerB = createPlayerCryptoContext("playerB", seedB);

    state = createCryptoGoFishState({
      numPlayers: 2,
      playerIDs: ["playerA", "playerB"],
    });

    ctx = {
      numPlayers: 2,
      playOrder: ["playerA", "playerB"],
      currentPlayer: "playerA",
      phase: "setup",
    } as unknown as Ctx;
  });

  it("starts in keyExchange", () => {
    expect(state.phase).toBe("keyExchange");
    expect(state.cardIds).toHaveLength(52);
    expect(state.playerOrder).toEqual(["playerA", "playerB"]);
    expect(state.securityMode).toBe("demo-private");
    expect(state.log).toEqual([]);
  });

  it("submits keys and advances to keyEscrow", () => {
    expect(allKeysSubmitted(state)).toBe(false);
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    expect(state.phase).toBe("keyExchange");
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    expect(state.phase).toBe("keyEscrow");
    expect(allKeysSubmitted(state)).toBe(true);
    expect(Object.keys(state.crypto.cardPointLookup)).toHaveLength(52);
  });

  it("distributes shares and advances to encrypt", () => {
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

    const sharesA = createKeyShares(
      playerA.keyPair.privateKey,
      "playerA",
      ["playerB"],
      2,
    );
    const sharesB = createKeyShares(
      playerB.keyPair.privateKey,
      "playerB",
      ["playerA"],
      2,
    );
    distributeKeyShares(
      state,
      ctx,
      "playerA",
      playerA.keyPair.privateKey,
      sharesA,
    );
    expect(state.phase).toBe("keyEscrow");
    distributeKeyShares(
      state,
      ctx,
      "playerB",
      playerB.keyPair.privateKey,
      sharesB,
    );
    expect(state.phase).toBe("encrypt");
    expect(state.crypto.privateKeys?.playerA).toBe(playerA.keyPair.privateKey);
    expect(state.crypto.privateKeys?.playerB).toBe(playerB.keyPair.privateKey);
  });

  it("encrypts and shuffles then deals hands", () => {
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);

    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("shuffle");

    // Commit-reveal deterministic shuffle seed for both players.
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    commitShuffleSeed(state, ctx, "playerB", sha256Hex(new TextEncoder().encode(seedB)));
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    expect(state.shuffleRng.finalSeedHex).toBeTruthy();

    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("play");

    const deck = state.crypto.encryptedZones["deck"];
    const handA = state.crypto.encryptedZones["hand:playerA"];
    const handB = state.crypto.encryptedZones["hand:playerB"];
    expect(handA).toHaveLength(7);
    expect(handB).toHaveLength(7);
    expect(deck).toHaveLength(52 - 14);
  });

  it("rejects shuffle seed reveal if commit mismatches", () => {
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("shuffle");

    const seedA = "11".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    const bad = revealShuffleSeed(state, ctx, "playerA", "22".repeat(32));
    expect(bad).toBe(INVALID_MOVE);
  });

  it("supports ask/respond and goFish flow", () => {
    // Setup to play
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    commitShuffleSeed(state, ctx, "playerB", sha256Hex(new TextEncoder().encode(seedB)));
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

    expect(state.turnPlayer).toBe("playerA");

    // Peek to learn a rank we hold so we can ask legally.
    peekHand(state, ctx, "playerA", playerA.keyPair.privateKey);
    const myRank = state.players.playerA.peekedCards?.[0]?.rank;
    expect(myRank).toBeTruthy();

    // Ask for a rank we have; should create pending ask.
    askRank(state, ctx, "playerA", "playerB", myRank!);
    expect(state.pendingAsk?.asker).toBe("playerA");

    // Respond should clear pending ask.
    respondToAsk(state, ctx, "playerB");
    expect(state.pendingAsk).toBe(null);

    // If the ask missed, playerA should not be able to ask again until goFish.
    if (state.awaitingGoFishFor === "playerA") {
      // Try asking again for the same rank (should be blocked until goFish).
      const res = askRank(state, ctx, "playerA", "playerB", myRank!);
      expect(res).toBe(INVALID_MOVE);
      expect(state.awaitingGoFishFor).toBe("playerA");

      // After goFish, awaitingGoFish should clear.
      goFish(state, ctx, "playerA");
      expect(state.awaitingGoFishFor).toBe(null);
      expect(state.awaitingGoFishRank).toBe(null);

      // Asking again may or may not be legal depending on whether the player
      // drew the requested rank (they might keep the turn) and whether they
      // still hold that rank. We only assert that it's no longer blocked by
      // the forced-go-fish state.
      if (state.turnPlayer === "playerA") {
        const res2 = askRank(state, ctx, "playerA", "playerB", myRank!);
        expect(res2).not.toBe(INVALID_MOVE);
      }
    }

    // If no forced goFish is pending and it's still playerA's turn,
    // voluntary goFish should draw exactly 1 card.
    if (state.awaitingGoFishFor === null && state.turnPlayer === "playerA") {
      const deckBefore = state.crypto.encryptedZones["deck"]?.length ?? 0;
      const res = goFish(state, ctx, "playerA");
      expect(res).not.toBe(INVALID_MOVE);
      const deckAfter = state.crypto.encryptedZones["deck"]?.length ?? 0;
      expect(deckAfter).toBe(deckBefore - 1);
    }
  });

  it("can claim books without crashing (demo)", () => {
    // Setup to play
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    commitShuffleSeed(state, ctx, "playerB", sha256Hex(new TextEncoder().encode(seedB)));
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

    // Peek then try to claim books.
    peekHand(state, ctx, "playerA", playerA.keyPair.privateKey);
    claimBooks(state, ctx, "playerA");
    expect(state.players.playerA.books).toBeGreaterThanOrEqual(0);
  });

  it("supports coop-reveal forced Go Fish draw resolution", () => {
    // Setup to play (secure mode: no private keys in shared state)
    state.securityMode = "coop-reveal";
    delete (state.crypto as any).privateKeys;

    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);

    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    commitShuffleSeed(state, ctx, "playerB", sha256Hex(new TextEncoder().encode(seedB)));
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("play");
    expect((state.crypto as any).privateKeys).toBeUndefined();

    // Create a forced Go Fish requirement.
    state.turnPlayer = "playerA";
    state.awaitingGoFishFor = "playerA";
    state.awaitingGoFishRank = "A";

    goFish(state, ctx, "playerA");
    const key = state.awaitingGoFishDrawCardKey;
    expect(typeof key).toBe("string");
    expect(state.awaitingGoFishFor).toBe("playerA");
    expect(state.awaitingGoFishRank).toBe("A");

    const m = /^(.+):(\d+)$/.exec(key!);
    expect(m).toBeTruthy();
    const zoneId = m![1];
    const cardIndex = Number(m![2]);
    expect(zoneId).toBe("hand:playerA");
    expect(Number.isFinite(cardIndex)).toBe(true);

    // Both players submit shares; card becomes revealed and forced state resolves.
    submitDecryptionShare(
      state,
      ctx,
      zoneId,
      cardIndex,
      "playerA",
      playerA.keyPair.privateKey,
    );
    submitDecryptionShare(
      state,
      ctx,
      zoneId,
      cardIndex,
      "playerB",
      playerB.keyPair.privateKey,
    );

    const revealed = state.crypto.revealedCards[key!];
    expect(typeof revealed).toBe("string");

    const drewRank = revealed!.split("-")[1];
    const expectedTurn = drewRank === "A" ? "playerA" : "playerB";

    expect(state.awaitingGoFishFor).toBe(null);
    expect(state.awaitingGoFishRank).toBe(null);
    expect(state.awaitingGoFishDrawCardKey).toBe(null);
    expect(state.turnPlayer).toBe(expectedTurn);
  });

  it("zk-attest accepts verifier-signed verdict and applies payload", () => {
    // Setup to play
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    commitShuffleSeed(state, ctx, "playerB", sha256Hex(new TextEncoder().encode(seedB)));
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("play");

    state.securityMode = "zk-attest";
    state.turnPlayer = "playerA";

    // Create a pending ask
    state.pendingAsk = {
      asker: "playerA",
      target: "playerB",
      rank: "A",
      status: "pending",
      timestamp: 0,
    };

    // Deterministic verifier is playerOrder[0]
    const verifier = state.playerOrder[0];
    expect(verifier).toBe("playerA");

    // Register verifier signing key
    const verifierSigKeys = ecdsaGenerateKeyPair(new Uint8Array([9, 9, 9, 9]));
    submitZkSigPublicKey(state, ctx, verifier, verifierSigKeys.publicKey);

    // Target submits proof with payload “give none” (miss)
    submitZkProofRespondToAsk(
      state,
      ctx,
      "playerB",
      { vkeyId: "dev", publicSignals: [], proof: {} },
      { zoneId: "hand:playerB", giveIndices: [] },
    );
    expect(state.pendingZk).toBeTruthy();
    expect(state.pendingZk?.verifier).toBe(verifier);
    expect(typeof state.pendingZk?.payloadHash).toBe("string");

    const pz = state.pendingZk!;
    const decisionHash = sha256Hex(
      new TextEncoder().encode(
        stableStringify({
          pendingId: pz.id,
          matchSalt: state.shuffleRng.finalSeedHex,
          payloadHash: pz.payloadHash,
          verdict: "valid",
        }),
      ),
    );
    const sig = ecdsaSignDigestHex(decisionHash, verifierSigKeys.privateKey);

    submitZkVerdict(state, ctx, verifier, "valid", sig);
    expect(state.pendingZk).toBe(null);
    expect(state.pendingAsk).toBe(null);
    // For a miss payload, forced go fish should be set for asker.
    expect(state.awaitingGoFishFor).toBe("playerA");
  });

  it("zk-attest rejects verdict if signature is wrong", () => {
    // Setup to play
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    distributeKeyShares(state, ctx, "playerA", playerA.keyPair.privateKey, []);
    distributeKeyShares(state, ctx, "playerB", playerB.keyPair.privateKey, []);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(state, ctx, "playerA", sha256Hex(new TextEncoder().encode(seedA)));
    commitShuffleSeed(state, ctx, "playerB", sha256Hex(new TextEncoder().encode(seedB)));
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("play");

    state.securityMode = "zk-attest";
    state.turnPlayer = "playerA";
    state.pendingAsk = {
      asker: "playerA",
      target: "playerB",
      rank: "A",
      status: "pending",
      timestamp: 0,
    };

    const verifier = state.playerOrder[0];
    const verifierSigKeys = ecdsaGenerateKeyPair(new Uint8Array([1, 1, 1, 1]));
    submitZkSigPublicKey(state, ctx, verifier, verifierSigKeys.publicKey);

    submitZkProofRespondToAsk(
      state,
      ctx,
      "playerB",
      { vkeyId: "dev", publicSignals: [], proof: {} },
      { zoneId: "hand:playerB", giveIndices: [] },
    );

    const pz = state.pendingZk!;
    const decisionHash = sha256Hex(
      new TextEncoder().encode(
        stableStringify({
          pendingId: pz.id,
          matchSalt: state.shuffleRng.finalSeedHex,
          payloadHash: pz.payloadHash,
          verdict: "valid",
        }),
      ),
    );
    const otherKeys = ecdsaGenerateKeyPair(new Uint8Array([2, 2, 2, 2]));
    const badSig = ecdsaSignDigestHex(decisionHash, otherKeys.privateKey);

    const res = submitZkVerdict(state, ctx, verifier, "valid", badSig);
    expect(res).toBe(INVALID_MOVE);
    expect(state.pendingZk).toBeTruthy();
    expect(state.pendingAsk).toBeTruthy();
  });
});
