import { describe, expect, it, beforeEach } from "vitest";
import type { Ctx } from "boardgame.io";
import {
  CryptoWarGame,
  CryptoWarState,
  createCryptoWarState,
  submitPublicKey,
  encryptDeck,
  shuffleDeck,
  flipCard,
  reshuffleWonPile,
  submitDecryptedShare,
  resolveRound,
  requestDecrypt,
  approveDecrypt,
  surrender,
  allKeysSubmitted,
  allPlayersEncrypted,
  allPlayersShuffled,
  parseCardId,
  createCardIds,
  getShuffleProofs,
  verifyPlayerShuffle,
} from "./boardgameio-crypto";
import {
  createPlayerCryptoContext,
  buildCardPointLookup,
  type CryptoPlayerContext,
} from "@manamesh/boardgameio-crypto";

describe("CryptoWar", () => {
  let state: CryptoWarState;
  let ctx: Ctx;
  let playerA: CryptoPlayerContext;
  let playerB: CryptoPlayerContext;

  beforeEach(async () => {
    // Create deterministic player contexts for testing
    const seedA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const seedB = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);

    playerA = createPlayerCryptoContext("playerA", seedA);
    playerB = createPlayerCryptoContext("playerB", seedB);

    // Initialize game state
    state = createCryptoWarState({
      numPlayers: 2,
      playerIDs: ["playerA", "playerB"],
    });

    // V1: Build card point lookup with real SHA-256
    const lookup = await buildCardPointLookup(state.cardIds);
    for (const [cardId, point] of lookup) {
      state.crypto.cardPointLookup[cardId] = point;
    }

    ctx = {
      numPlayers: 2,
      playOrder: ["playerA", "playerB"],
      currentPlayer: "playerA",
    } as unknown as Ctx;
  });

  describe("createCardIds", () => {
    it("creates 52 card IDs", () => {
      const ids = createCardIds();
      expect(ids).toHaveLength(52);
    });

    it("includes all suits and ranks", () => {
      const ids = createCardIds();
      expect(ids).toContain("hearts-A");
      expect(ids).toContain("spades-K");
      expect(ids).toContain("diamonds-2");
      expect(ids).toContain("clubs-10");
    });
  });

  describe("parseCardId", () => {
    it("parses card ID into WarCard", () => {
      const card = parseCardId("hearts-A");
      expect(card.id).toBe("hearts-A");
      expect(card.suit).toBe("hearts");
      expect(card.rank).toBe("A");
      expect(card.name).toBe("A of hearts");
    });
  });

  describe("createCryptoWarState", () => {
    it("creates initial state in keyExchange phase", () => {
      expect(state.phase).toBe("keyExchange");
      expect(state.cardIds).toHaveLength(52);
      expect(state.playerOrder).toEqual(["playerA", "playerB"]);
    });

    it("initializes player states correctly", () => {
      expect(state.players.playerA).toBeDefined();
      expect(state.players.playerB).toBeDefined();
      expect(state.players.playerA.publicKey).toBeNull();
      expect(state.players.playerA.hasEncrypted).toBe(false);
      expect(state.players.playerA.hasShuffled).toBe(false);
      expect(state.players.playerA.isConnected).toBe(true);
    });

    it("initializes crypto plugin state", () => {
      expect(state.crypto).toBeDefined();
      expect(state.crypto.phase).toBe("init");
    });

    it("initializes cooperative decryption fields", () => {
      expect(state.decryptRequests).toEqual([]);
      expect(state.decryptNotifications).toEqual([]);
      expect(state.revealNotifications).toEqual([]);
    });
  });

  describe("Key Exchange Phase", () => {
    it("allows players to submit public keys", () => {
      const result = submitPublicKey(
        state,
        ctx,
        "playerA",
        playerA.keyPair.publicKey,
      );
      expect(result).not.toBe("INVALID_MOVE");

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.publicKey).toBe(
        playerA.keyPair.publicKey,
      );
    });

    it("rejects duplicate key submission", () => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      const result = submitPublicKey(
        state,
        ctx,
        "playerA",
        playerA.keyPair.publicKey,
      );
      expect(result).toBe("INVALID_MOVE");
    });

    it("transitions to encrypt phase when all keys submitted", () => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      expect(state.phase).toBe("keyExchange");

      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
      expect(state.phase).toBe("encrypt");
    });

    it("tracks all keys submitted correctly", () => {
      expect(allKeysSubmitted(state)).toBe(false);

      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      expect(allKeysSubmitted(state)).toBe(false);

      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
      expect(allKeysSubmitted(state)).toBe(true);
    });

    it("stores public keys in crypto state", () => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

      expect(state.crypto.publicKeys["playerA"]).toBe(
        playerA.keyPair.publicKey,
      );
      expect(state.crypto.publicKeys["playerB"]).toBe(
        playerB.keyPair.publicKey,
      );
    });

    it("builds card point lookup after all keys submitted", () => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

      expect(Object.keys(state.crypto.cardPointLookup)).toHaveLength(52);
    });
  });

  describe("Encryption Phase", () => {
    beforeEach(() => {
      // Complete key exchange (no key escrow in Shamir-less version)
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
    });

    it("starts in encrypt phase after key exchange", () => {
      expect(state.phase).toBe("encrypt");
    });

    it("allows first player to encrypt deck", () => {
      const result = encryptDeck(
        state,
        ctx,
        "playerA",
        playerA.keyPair.privateKey,
      );
      expect(result).not.toBe("INVALID_MOVE");

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.hasEncrypted).toBe(true);
    });

    it("requires sequential encryption order", () => {
      // Player B can't encrypt before player A
      const result = encryptDeck(
        state,
        ctx,
        "playerB",
        playerB.keyPair.privateKey,
      );
      expect(result).toBe("INVALID_MOVE");
    });

    it("transitions to shuffle phase when all encrypted", () => {
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(state.phase).toBe("encrypt");

      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      expect(state.phase).toBe("shuffle");
    });

    it("tracks all players encrypted correctly", () => {
      expect(allPlayersEncrypted(state)).toBe(false);

      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(allPlayersEncrypted(state)).toBe(false);

      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      expect(allPlayersEncrypted(state)).toBe(true);
    });

    it("creates encrypted deck in crypto state", () => {
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(state.crypto.encryptedZones["deck"]).toBeDefined();
      expect(state.crypto.encryptedZones["deck"]).toHaveLength(52);
    });

    it("adds encryption layers", () => {
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(state.crypto.encryptedZones["deck"][0].layers).toBe(1);

      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      expect(state.crypto.encryptedZones["deck"][0].layers).toBe(2);
    });
  });

  describe("Shuffle Phase", () => {
    beforeEach(() => {
      // Complete key exchange and encryption (no key escrow)
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    });

    it("starts in shuffle phase after encryption", () => {
      expect(state.phase).toBe("shuffle");
    });

    it("allows first player to shuffle deck", () => {
      const result = shuffleDeck(
        state,
        ctx,
        "playerA",
        playerA.keyPair.privateKey,
      );
      expect(result).not.toBe("INVALID_MOVE");

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.hasShuffled).toBe(true);
    });

    it("requires sequential shuffle order", () => {
      // Player B can't shuffle before player A
      const result = shuffleDeck(
        state,
        ctx,
        "playerB",
        playerB.keyPair.privateKey,
      );
      expect(result).toBe("INVALID_MOVE");
    });

    it("transitions to flip phase when all shuffled", () => {
      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(state.phase).toBe("shuffle");

      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      expect(state.phase).toBe("flip");
    });

    it("tracks all players shuffled correctly", () => {
      expect(allPlayersShuffled(state)).toBe(false);

      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(allPlayersShuffled(state)).toBe(false);

      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      expect(allPlayersShuffled(state)).toBe(true);
    });
  });

  describe("Cooperative Decryption", () => {
    beforeEach(() => {
      // Complete full setup to get to play phase (no key escrow)
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    });

    it("allows players to request decryption", () => {
      const result = requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);
      expect(result).not.toBe("INVALID_MOVE");

      expect(state.decryptRequests).toHaveLength(1);
      expect(state.decryptRequests[0].requestingPlayer).toBe("playerA");
    });

    it("auto-approves for requesting player", () => {
      requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);

      expect(state.decryptRequests[0].approvals["playerA"]).toBe(true);
      expect(state.decryptRequests[0].approvals["playerB"]).toBe(false);
    });

    it("creates notification on request", () => {
      requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);

      expect(state.decryptNotifications).toHaveLength(1);
      expect(state.decryptNotifications[0].type).toBe("request");
    });

    it("allows other player to approve", () => {
      requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);
      const requestId = state.decryptRequests[0].id;

      const result = approveDecrypt(
        state,
        ctx,
        "playerB",
        requestId,
        playerB.keyPair.privateKey,
      );
      expect(result).not.toBe("INVALID_MOVE");

      expect(state.decryptRequests[0].approvals["playerB"]).toBe(true);
    });

    it("completes decryption when all approve", () => {
      requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);
      const requestId = state.decryptRequests[0].id;

      // Submit requesting player's key as part of approval
      approveDecrypt(
        state,
        ctx,
        "playerA",
        requestId,
        playerA.keyPair.privateKey,
      );
      approveDecrypt(
        state,
        ctx,
        "playerB",
        requestId,
        playerB.keyPair.privateKey,
      );

      expect(state.decryptRequests[0].status).toBe("completed");
    });
  });

  describe("Abandonment Support", () => {
    beforeEach(() => {
      // Complete full setup (no key escrow)
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    });

    it("allows player to surrender", () => {
      const result = surrender(state, ctx, "playerA");
      expect(result).not.toBe("INVALID_MOVE");

      expect(state.winner).toBe("playerB");
      expect(state.phase).toBe("gameOver");
    });
  });

  describe("CryptoWarGame boardgame.io integration", () => {
    it("has correct game name", () => {
      expect(CryptoWarGame.name).toBe("crypto-war");
    });

    it("has setup as starting phase", () => {
      expect(CryptoWarGame.phases?.setup?.start).toBe(true);
    });

    it("setup creates valid initial state", async () => {
      const setupCtx = {
        numPlayers: 2,
        playOrder: ["0", "1"],
      } as unknown as Ctx;

      const initialState = await CryptoWarGame.setup?.(setupCtx, {} as any);
      expect(initialState).toBeDefined();
      expect((initialState as CryptoWarState).phase).toBe("keyExchange");
    });

    it("has setup and play phases", () => {
      expect(CryptoWarGame.phases?.setup).toBeDefined();
      expect(CryptoWarGame.phases?.play).toBeDefined();
    });

    it("has all required moves in setup phase", () => {
      const setupMoves = CryptoWarGame.phases?.setup?.moves;
      expect(setupMoves?.submitPublicKey).toBeDefined();
      expect(setupMoves?.encryptDeck).toBeDefined();
      expect(setupMoves?.shuffleDeck).toBeDefined();
    });

    it("has all required moves in play phase", () => {
      const playMoves = CryptoWarGame.phases?.play?.moves;
      expect(playMoves?.flipCard).toBeDefined();
      expect(playMoves?.submitDecryptedShare).toBeDefined();
      expect(playMoves?.resolveRound).toBeDefined();
      expect(playMoves?.requestDecrypt).toBeDefined();
      expect(playMoves?.approveDecrypt).toBeDefined();
      expect(playMoves?.surrender).toBeDefined();
    });
  });

  describe("Full Game Flow", () => {
    it("completes crypto setup phases correctly", () => {
      // Phase 1: Key Exchange
      expect(state.phase).toBe("keyExchange");
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);

      // Phase 2: Encryption (no key escrow)
      expect(state.phase).toBe("encrypt");
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

      // Phase 3: Shuffle
      expect(state.phase).toBe("shuffle");
      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);

      // Phase 4: Ready to play
      expect(state.phase).toBe("flip");

      // Verify crypto state
      expect(state.crypto.encryptedZones["deck_playerA"]).toBeDefined();
      expect(state.crypto.encryptedZones["deck_playerB"]).toBeDefined();
    });
  });

  describe("Reshuffle Won Pile", () => {
    beforeEach(() => {
      // Complete full crypto setup
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    });

    it("flipCard reshuffles won pile when deck is empty with reshufflePrivateKey", () => {
      // Empty playerA's encrypted deck directly
      state.crypto.encryptedZones["deck_playerA"] = [];

      // Add cards to playerA's won pile (plain WarCard objects)
      state.players["playerA"].won = [
        { id: "hearts-K", name: "K of hearts", suit: "hearts", rank: "K" },
        { id: "spades-10", name: "10 of spades", suit: "spades", rank: "10" },
      ];

      expect(state.phase).toBe("flip");
      expect(state.players["playerA"].won.length).toBe(2);
      expect(state.crypto.encryptedZones["deck_playerA"]?.length ?? 0).toBe(0);

      // flipCard with reshufflePrivateKey should succeed
      const result = flipCard(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(result).not.toBe("INVALID_MOVE");

      // Should transition to reveal phase
      expect(state.phase).toBe("reveal");

      // Won pile should be cleared after reshuffle
      expect(state.players["playerA"].won.length).toBe(0);

      // Deck should have cards after reshuffle (26 cards were dealt, minus any that were played)
      const deckCount = state.crypto.encryptedZones["deck_playerA"]?.length ?? 0;
      expect(deckCount).toBeGreaterThan(0);
    });

    it("flipCard returns INVALID_MOVE when deck is empty and no reshufflePrivateKey", () => {
      // Empty playerA's encrypted deck
      state.crypto.encryptedZones["deck_playerA"] = [];

      // Add cards to won pile
      state.players["playerA"].won = [
        { id: "hearts-K", name: "K of hearts", suit: "hearts", rank: "K" },
      ];

      // flipCard without reshufflePrivateKey should fail
      const result = flipCard(state, ctx, "playerA");
      expect(result).toBe("INVALID_MOVE");
    });

    it("flipCard returns INVALID_MOVE when deck is empty and won pile is also empty", () => {
      // Empty playerA's encrypted deck
      state.crypto.encryptedZones["deck_playerA"] = [];

      // Won pile is also empty
      state.players["playerA"].won = [];

      // flipCard should fail - game over
      const result = flipCard(state, ctx, "playerA", playerA.keyPair.privateKey);
      expect(result).toBe("INVALID_MOVE");
    });
  });

  // =========================================================================
  // Fix 7: submitDecryptedShare layer chaining
  // =========================================================================

  describe("submitDecryptedShare layer chaining (Fix 7)", () => {
    beforeEach(() => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      // Now in "flip" phase; player A flips to start reveal
      flipCard(state, ctx, "playerA");
    });

    it("writes the submitted share into the reveal zone for chaining", () => {
      // After flipCard, zone has a 2-layer card. Player A submits a 1-layer
      // result. Fix 7 ensures the zone is updated so player B sees 1 layer.
      const intermediatePoint = playerA.keyPair.publicKey; // a valid secp point not in lookup
      const card1Layer = { ciphertext: intermediatePoint, layers: 1 };

      const result = submitDecryptedShare(state, ctx, "playerA", "playerA", card1Layer);
      expect(result).not.toBe("INVALID_MOVE");
      expect(state.crypto.encryptedZones["reveal_playerA"]?.[0]).toEqual(card1Layer);
    });

    it("second player receives the chained (layer-1) card, not the original", () => {
      const intermediatePoint = playerA.keyPair.publicKey;
      // Pick a card point already in the lookup so lookupCardIdFromPoint succeeds
      const finalCardId = state.cardIds[0]!;
      const finalPoint = state.crypto.cardPointLookup[finalCardId]!;

      submitDecryptedShare(state, ctx, "playerA", "playerA", {
        ciphertext: intermediatePoint,
        layers: 1,
      });

      // Player B decrypts the layer-1 output and produces the naked point
      submitDecryptedShare(state, ctx, "playerB", "playerA", {
        ciphertext: finalPoint,
        layers: 0,
      });

      // The card should be identified and moved to playerA's played zone
      expect(state.players["playerA"].played).toHaveLength(1);
      expect(state.players["playerA"].played[0]!.id).toBe(finalCardId);
    });
  });

  // =========================================================================
  // Fix 8: approveDecrypt layer chaining
  // =========================================================================

  describe("approveDecrypt layer chaining (Fix 8)", () => {
    beforeEach(() => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    });

    it("writes the approving player's decrypted card into the zone", () => {
      // playerA requests → auto-approved. Only playerB needs to call approveDecrypt.
      // Fix 8 ensures the zone is updated with playerB's card so the completion
      // block reads the chained zone result rather than a stale reference.
      requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);
      const requestId = state.decryptRequests[0]!.id;

      const intermediatePoint = playerB.keyPair.publicKey; // a valid secp point not in lookup
      approveDecrypt(state, ctx, "playerB", requestId, {
        ciphertext: intermediatePoint,
        layers: 1,
      });
      // Zone should be updated with playerB's decrypted card
      expect(state.crypto.encryptedZones["deck_playerA"]?.[0]).toEqual({
        ciphertext: intermediatePoint,
        layers: 1,
      });
    });

    it("reads the zone (chained) result to identify the card on completion", () => {
      // playerA requests; playerB approves with the final 0-layer card.
      // Fix 8 reads from zone[idx] instead of request.decryptionShares[lastApprover].
      requestDecrypt(state, ctx, "playerA", "deck_playerA", [0]);
      const requestId = state.decryptRequests[0]!.id;

      // Pick a card whose point is in the lookup
      const finalCardId = state.cardIds[0]!;
      const finalPoint = state.crypto.cardPointLookup[finalCardId]!;

      approveDecrypt(state, ctx, "playerB", requestId, {
        ciphertext: finalPoint,
        layers: 0,
      });

      // Request is completed; the card should be identified via the zone
      expect(state.decryptRequests[0]!.status).toBe("completed");
      expect(state.crypto.revealedCards["deck_playerA:0"]).toBe(finalCardId);
    });
  });

  // =========================================================================
  // Fix 9: war-tie elimination ignores won pile
  // =========================================================================

  describe("war-tie won-pile guard (Fix 9)", () => {
    beforeEach(() => {
      submitPublicKey(state, ctx, "playerA", playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, "playerB", playerB.keyPair.publicKey);
      encryptDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      encryptDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerA", playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, "playerB", playerB.keyPair.privateKey);
    });

    it("player with empty deck but non-empty won pile is NOT eliminated on war tie", () => {
      // Both players play the same rank (tie = war)
      const sameRankCard = { id: "hearts-A", name: "A of hearts", suit: "hearts" as const, rank: "A" as const };
      state.players["playerA"].played = [sameRankCard];
      state.players["playerB"].played = [sameRankCard];
      state.phase = "resolve";

      // playerA's encrypted deck is empty but has a won pile
      state.crypto.encryptedZones["deck_playerA"] = [];
      state.players["playerA"].won = [
        { id: "spades-2", name: "2 of spades", suit: "spades", rank: "2" },
      ];

      resolveRound(state, ctx);

      // playerA should NOT be declared the loser — won pile is non-empty
      expect(state.winner).not.toBe("playerB");
      expect(state.phase).not.toBe("gameOver");
    });

    it("player with empty deck AND empty won pile IS eliminated on war tie", () => {
      const sameRankCard = { id: "hearts-A", name: "A of hearts", suit: "hearts" as const, rank: "A" as const };
      state.players["playerA"].played = [sameRankCard];
      state.players["playerB"].played = [sameRankCard];
      state.phase = "resolve";

      // playerA has nothing
      state.crypto.encryptedZones["deck_playerA"] = [];
      state.players["playerA"].won = [];

      resolveRound(state, ctx);

      expect(state.winner).toBe("playerB");
      expect(state.phase).toBe("gameOver");
    });
  });
});
