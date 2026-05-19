import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";

import {
  createCryptoGoFishState,
  submitPublicKey,
  submitZkSigPublicKey,
  encryptDeck,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleDeck,
  voteAbortShuffle,
  peekHand,
  askRank,
  respondToAsk,
  goFish,
  claimBooks,
  submitDecryptedShare,
  submitZkProofRespondToAsk,
  submitZkVerdict,
  allKeysSubmitted,
} from "./crypto";
import type { CryptoGoFishState } from "./types";
import {
  createPlayerCryptoContext,
  type CryptoPlayerContext,
} from "../../../crypto";
import {
  ecdsaGenerateKeyPair,
  ecdsaSignDigestHex,
  sha256Hex,
  stableStringify,
  decrypt,
  buildCardPointLookup,
} from "../../../crypto";

describe("CryptoGoFish", () => {
  let state: CryptoGoFishState;
  let ctx: Ctx;
  let playerA: CryptoPlayerContext;
  let playerB: CryptoPlayerContext;

  beforeEach(async () => {
    const seedA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const seedB = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);
    playerA = createPlayerCryptoContext("playerA", seedA);
    playerB = createPlayerCryptoContext("playerB", seedB);

    state = createCryptoGoFishState({
      numPlayers: 2,
      playerIDs: ["playerA", "playerB"],
    });

    // Build card point lookup (V1: real SHA-256)
    const lookup = await buildCardPointLookup(state.cardIds);
    for (const [cardId, point] of lookup) {
      state.crypto.cardPointLookup[cardId] = point;
    }

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
    expect(state.securityMode).toBe("coop-reveal");
    expect(state.log).toEqual([]);
  });

  it("submits keys and advances to encrypt", async () => {
    expect(allKeysSubmitted(state)).toBe(false);
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    expect(state.phase).toBe("keyExchange");
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    expect(state.phase).toBe("encrypt");
    expect(allKeysSubmitted(state)).toBe(true);
    expect(Object.keys(state.crypto.cardPointLookup)).toHaveLength(52);
  });

  // keyEscrow phase (Shamir shares) removed — tests updated to reflect
  // new flow: keyExchange -> encrypt -> shuffle -> play

  it("encrypts and shuffles then deals hands", () => {
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("shuffle");

    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(
      state,
      ctx,
      "playerA",
      sha256Hex(new TextEncoder().encode(seedA)),
    );
    commitShuffleSeed(
      state,
      ctx,
      "playerB",
      sha256Hex(new TextEncoder().encode(seedB)),
    );
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
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("shuffle");

    const seedA = "11".repeat(32);
    commitShuffleSeed(
      state,
      ctx,
      "playerA",
      sha256Hex(new TextEncoder().encode(seedA)),
    );
    const bad = revealShuffleSeed(state, ctx, "playerA", "22".repeat(32));
    expect(bad).toBe(INVALID_MOVE);
  });

  it("allows majority abort if shuffle stalls", () => {
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("shuffle");

    expect(voteAbortShuffle(state, ctx, "playerA")).toBe(INVALID_MOVE);

    (ctx as any).numMoves = 99;

    commitShuffleSeed(state, ctx, "playerA", "00".repeat(32));
    (ctx as any).numMoves = 150;

    expect(voteAbortShuffle(state, ctx, "playerA")).toBe(state);
    expect(state.phase).toBe("shuffle");

    expect(voteAbortShuffle(state, ctx, "playerB")).toBe(state);
    expect(state.phase).toBe("voided");
  });

  it("supports ask/respond and goFish flow", () => {
    // Use coop-reveal mode: askRank skips the handHasRank enforcement
    // (demo-private requires cooperative decryption which needs pendingReveal set up).
    state.securityMode = "coop-reveal";
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(
      state,
      ctx,
      "playerA",
      sha256Hex(new TextEncoder().encode(seedA)),
    );
    commitShuffleSeed(
      state,
      ctx,
      "playerB",
      sha256Hex(new TextEncoder().encode(seedB)),
    );
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

    expect(state.turnPlayer).toBe("playerA");
    expect(state.phase).toBe("play");

    askRank(state, ctx, "playerA", "playerB", "A");
    expect(state.pendingAsk?.asker).toBe("playerA");
    expect(state.pendingAsk?.rank).toBe("A");

    // In coop-reveal mode, respondToAsk initiates an async reveal.
    // It sets pendingReveal but does NOT immediately clear pendingAsk.
    const respondResult = respondToAsk(state, ctx, "playerB");
    expect(respondResult).not.toBe(INVALID_MOVE);
    expect(state.pendingReveal?.purpose).toBe("respondToAsk");
    // pendingAsk stays until reveal completes (tested separately).
  });

  it("supports coop-reveal forced Go Fish draw resolution", () => {
    state.securityMode = "coop-reveal";

    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(
      state,
      ctx,
      "playerA",
      sha256Hex(new TextEncoder().encode(seedA)),
    );
    commitShuffleSeed(
      state,
      ctx,
      "playerB",
      sha256Hex(new TextEncoder().encode(seedB)),
    );
    revealShuffleSeed(state, ctx, "playerA", seedA);
    revealShuffleSeed(state, ctx, "playerB", seedB);
    shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    expect(state.phase).toBe("play");

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

    const deck = state.crypto.encryptedZones[zoneId];
    const encryptedCard = deck[cardIndex];

    // V2: decrypt locally, submit decrypted card
    const decA = decrypt(encryptedCard, playerA.keyPair.privateKey);
    submitDecryptedShare(state, ctx, zoneId, cardIndex, "playerA", decA);

    const currentCard = state.crypto.encryptedZones[zoneId][cardIndex];
    const decB = decrypt(currentCard, playerB.keyPair.privateKey);
    submitDecryptedShare(state, ctx, zoneId, cardIndex, "playerB", decB);

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
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(
      state,
      ctx,
      "playerA",
      sha256Hex(new TextEncoder().encode(seedA)),
    );
    commitShuffleSeed(
      state,
      ctx,
      "playerB",
      sha256Hex(new TextEncoder().encode(seedB)),
    );
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
    expect(verifier).toBe("playerA");

    const verifierSigKeys = ecdsaGenerateKeyPair(new Uint8Array([9, 9, 9, 9]));
    submitZkSigPublicKey(state, ctx, verifier, verifierSigKeys.publicKey);

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
    expect(state.awaitingGoFishFor).toBe("playerA");
  });

  it("zk-attest rejects verdict if signature is wrong", () => {
    submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
    submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
    encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    const seedA = "aa".repeat(32);
    const seedB = "bb".repeat(32);
    commitShuffleSeed(
      state,
      ctx,
      "playerA",
      sha256Hex(new TextEncoder().encode(seedA)),
    );
    commitShuffleSeed(
      state,
      ctx,
      "playerB",
      sha256Hex(new TextEncoder().encode(seedB)),
    );
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

  // =========================================================================
  // Fix 3: demo-private guard — handHasRank does not throw in coop-reveal mode
  // =========================================================================

  describe("demo-private guard (Fix 3)", () => {
    it("askRank in coop-reveal mode does not throw even without decryptable cards", () => {
      // In coop-reveal mode (the default), handHasRank returns false immediately
      // instead of calling decryptToCardId (which unconditionally throws).
      // Advance to play phase manually.
      state.phase = "play";
      state.turnPlayer = "playerA";
      // Give playerA a non-empty hand zone so topUpHandIfEmptyNow is a no-op.
      const fakeCard = { ciphertext: playerA.keyPair.publicKey, layers: 2 };
      state.crypto.encryptedZones["hand:playerA"] = [fakeCard];
      state.crypto.encryptedZones["hand:playerB"] = [fakeCard];

      // Should not throw; may return INVALID_MOVE for game-state reasons
      // (awaitingGoFishFor, pendingAsk, etc.) but must not throw.
      expect(() => {
        askRank(state, ctx, "playerA", "playerB", "A");
      }).not.toThrow();
    });
  });
});
