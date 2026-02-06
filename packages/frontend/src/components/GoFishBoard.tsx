/**
 * Go Fish Board (Crypto Demo)
 *
 * UI for demo-private mental poker Go Fish.
 * Automates setup phases (key exchange/escrow/encrypt/shuffle) similarly to PokerBoard.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BoardProps } from "boardgame.io/react";

import { GOFISH_SHUFFLE_STALL_WINDOW_MOVES } from "../game/modules/gofish/types";
import type {
  CryptoGoFishState,
  CryptoGoFishPlayerState,
  GoFishCard,
  GoFishRank,
} from "../game/modules/gofish/types";
import { generateKeyPair } from "../crypto/mental-poker";
import type { CryptoKeyPair } from "../crypto/mental-poker/types";
import {
  ecdsaGenerateKeyPair,
  ecdsaSignDigestHex,
  sha256Hex,
  stableStringify,
} from "../crypto";

const RANKS: GoFishRank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/* ── Suit look-ups for pure-HTML card rendering ─────────────── */
const SUIT_SYMBOLS: Record<string, string> = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660",
};

const SUIT_COLORS: Record<string, string> = {
  hearts: "#e74c3c",
  diamonds: "#e74c3c",
  clubs: "#2c3e50",
  spades: "#2c3e50",
};

/** Pure-HTML playing card – matches the style used in PokerBoard / WarBoard. */
const CardDisplay: React.FC<{
  card?: GoFishCard;
  faceDown?: boolean;
  small?: boolean;
}> = ({ card, faceDown, small }) => {
  const width = small ? 44 : 60;
  const height = small ? 62 : 86;

  if (faceDown || !card) {
    return (
      <div
        style={{
          width,
          height,
          backgroundColor: "#1a365d",
          border: "2px solid #3182ce",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage:
            "repeating-linear-gradient(45deg, #2a4365, #2a4365 10px, #1a365d 10px, #1a365d 20px)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: small ? 14 : 20, color: "#63b3ed" }}>
          {"\uD83C\uDCA0"}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: "#fff",
        border: "2px solid #ccc",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: small ? 16 : 20,
          fontWeight: "bold",
          color: SUIT_COLORS[card.suit],
          lineHeight: 1,
        }}
      >
        {card.rank}
      </span>
      <span
        style={{
          fontSize: small ? 18 : 24,
          color: SUIT_COLORS[card.suit],
          lineHeight: 1,
        }}
      >
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
};

/** A fan of face-down cards representing a hand count. */
const FaceDownFan: React.FC<{ count: number }> = ({ count }) => {
  if (count === 0) {
    return (
      <span style={{ color: "#6b7280", fontSize: 12 }}>Empty</span>
    );
  }
  // Show up to 7 mini card backs, with a "+N" badge for larger hands.
  const visible = Math.min(count, 7);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
      {Array.from({ length: visible }).map((_, i) => (
        <CardDisplay key={i} faceDown small />
      ))}
      {count > 7 && (
        <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 4 }}>
          +{count - 7}
        </span>
      )}
    </div>
  );
};

const PHASE_LABEL: Record<string, string> = {
  keyExchange: "Key Exchange",
  keyEscrow: "Key Escrow (Demo)",
  encrypt: "Encrypting Deck",
  shuffle: "Shuffling + Deal",
  play: "Play",
  gameOver: "Game Over",
  voided: "Voided",
};

export const GoFishBoard: React.FC<BoardProps<CryptoGoFishState>> = ({
  G,
  ctx,
  moves,
  playerID,
  matchID,
}) => {
  const currentPlayerID = playerID ?? "0";
  const me = G.players?.[currentPlayerID] as
    | CryptoGoFishPlayerState
    | undefined;

  const isSecureMode = G.securityMode === "coop-reveal";
  const isZkMode = G.securityMode === "zk-attest";

  const verifierId = useMemo(() => {
    return (G.playerOrder ?? [])[0] ?? "0";
  }, [G.playerOrder]);

  const [askTarget, setAskTarget] = useState<string>(() => {
    const other = (G.playerOrder || []).find((p) => p !== currentPlayerID);
    return other ?? "0";
  });
  const [askRank, setAskRank] = useState<GoFishRank>("A");

  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null);
  const setupAttemptRef = useRef<Set<string>>(new Set());

  const shuffleSeedStorageKey = useMemo(() => {
    const mid = matchID ?? "no-match";
    return `manamesh:gofish:shuffle-seed:${mid}:${currentPlayerID}`;
  }, [matchID, currentPlayerID]);

  const getOrCreateShuffleSeedHex = (): string => {
    if (typeof window === "undefined") return "";
    try {
      const raw = window.localStorage.getItem(shuffleSeedStorageKey);
      if (raw && typeof raw === "string" && /^[0-9a-f]+$/.test(raw) && raw.length >= 16) {
        return raw;
      }
    } catch {
      // ignore
    }

    // Generate a per-match seed (stored locally). Randomness here is fine: it never
    // touches shared game state directly, only via commit/reveal moves.
    let seed = "";
    try {
      const buf = new Uint8Array(32);
      window.crypto.getRandomValues(buf);
      seed = Array.from(buf)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Fallback if crypto is unavailable.
      seed = sha256Hex(
        new TextEncoder().encode(`${matchID ?? "no-match"}:${currentPlayerID}:shuffle-seed:v1`),
      );
    }
    try {
      window.localStorage.setItem(shuffleSeedStorageKey, seed);
    } catch {
      // ignore
    }
    return seed;
  };

  const zkSigKeyStorageKey = useMemo(() => {
    const mid = matchID ?? "no-match";
    return `manamesh:gofish:zksig:${mid}:${currentPlayerID}`;
  }, [matchID, currentPlayerID]);

  const readStoredZkSigKeyPair = (key: string):
    | { publicKey: string; privateKey: string }
    | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<{ publicKey: string; privateKey: string }>;
      if (typeof parsed?.publicKey !== "string") return null;
      if (typeof parsed?.privateKey !== "string") return null;
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    } catch {
      return null;
    }
  };

  const persistZkSigKeyPair = (key: string, kp: { publicKey: string; privateKey: string }) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({ publicKey: kp.publicKey, privateKey: kp.privateKey, createdAt: null }),
      );
    } catch {
      // Ignore
    }
  };

  const getOrCreateZkSigKeyPair = (): { publicKey: string; privateKey: string } => {
    const stored = readStoredZkSigKeyPair(zkSigKeyStorageKey);
    if (stored) return stored;
    const kp = ecdsaGenerateKeyPair();
    persistZkSigKeyPair(zkSigKeyStorageKey, kp);
    return kp;
  };

  const storageKey = useMemo(() => {
    const mid = matchID ?? "no-match";
    return `manamesh:gofish:keypair:${mid}:${currentPlayerID}`;
  }, [matchID, currentPlayerID]);

  const readStoredKeyPair = (key: string): CryptoKeyPair | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<CryptoKeyPair>;
      if (typeof parsed?.publicKey !== "string") return null;
      if (typeof parsed?.privateKey !== "string") return null;
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    } catch {
      return null;
    }
  };

  const persistKeyPair = (key: string, kp: CryptoKeyPair) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          publicKey: kp.publicKey,
          privateKey: kp.privateKey,
          createdAt: null,
        }),
      );
    } catch {
      // Ignore quota / disabled storage.
    }
  };

  const deckCount = G.crypto?.encryptedZones?.["deck"]?.length ?? 0;
  const myHandCount =
    G.crypto?.encryptedZones?.[`hand:${currentPlayerID}`]?.length ?? 0;

  const shuffleRng = G.shuffleRng ?? null;

  // Ensure we always have a local keypair available for setup + secure reveal shares.
  useEffect(() => {
    if (G.phase === "play") return;
    getOrCreateKeyPair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [G.phase]);

  const setupPlayerId = useMemo(() => {
    if (!G.playerOrder?.length) return null;
    return G.playerOrder[G.setupPlayerIndex] ?? null;
  }, [G.playerOrder, G.setupPlayerIndex]);

  const isMySetupTurn = useMemo(() => {
    const phases = new Set(["encrypt", "shuffle"]);
    if (!phases.has(G.phase)) return false;
    const setupPlayer = G.playerOrder?.[G.setupPlayerIndex];
    return setupPlayer === currentPlayerID;
  }, [G.phase, G.playerOrder, G.setupPlayerIndex, currentPlayerID]);

  const isMyTurn = G.turnPlayer === currentPlayerID;
  const pendingAsk = G.pendingAsk;
  const iAmTarget = pendingAsk?.target === currentPlayerID;
  const pendingReveal = G.pendingReveal;
  const pendingZk = G.pendingZk ?? null;

  const shuffleAbortVotesNeeded = useMemo(() => {
    const n = G.playerOrder?.length ?? 0;
    return Math.floor(n / 2) + 1;
  }, [G.playerOrder]);

  const shuffleAbortVotes = useMemo(() => {
    const votes = shuffleRng?.abortVotes ?? {};
    return Object.values(votes).filter(Boolean).length;
  }, [shuffleRng?.abortVotes]);

  const shuffleLastProgressMove =
    shuffleRng?.lastProgressMove ?? shuffleRng?.startedAtMove ?? null;
  const shuffleMovesSinceProgress =
    shuffleLastProgressMove === null ? null : ctx.numMoves - shuffleLastProgressMove;
  const shuffleCanVoteAbort =
    G.phase === "shuffle" &&
    shuffleMovesSinceProgress !== null &&
    shuffleMovesSinceProgress >= GOFISH_SHUFFLE_STALL_WINDOW_MOVES &&
    !!(moves as any).voteAbortShuffle;

  const iVotedAbortShuffle = !!shuffleRng?.abortVotes?.[currentPlayerID];

  // In ZK mode, register a per-player secp256k1 signing public key in shared state.
  useEffect(() => {
    if (!isZkMode) return;
    if (!me) return;
    if (me.zkSigPublicKey) return;
    if (!(moves as any).submitZkSigPublicKey) return;
    const kp = getOrCreateZkSigKeyPair();
    setTimeout(() => (moves as any).submitZkSigPublicKey(currentPlayerID, kp.publicKey), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isZkMode, me?.zkSigPublicKey, currentPlayerID]);

  const forcedGoFishFor = G.awaitingGoFishFor;
  const forcedGoFishRank = G.awaitingGoFishRank;
  const awaitingDrawKey = G.awaitingGoFishDrawCardKey;
  const isForcedGoFish = forcedGoFishFor !== null;
  const iAmForcedToGoFish = forcedGoFishFor === currentPlayerID;
  const someoneElseForcedToGoFish =
    forcedGoFishFor !== null && forcedGoFishFor !== currentPlayerID;

  const peekDisabledReason = useMemo(() => {
    if (G.phase !== "play") return "Only available during play.";
    if (isZkMode) return "Instant Peek is disabled in ZK mode.";
    if (isSecureMode) return "Instant Peek is disabled in Coop Reveal mode.";
    if (pendingAsk) return "Waiting for the target to respond.";
    if (isForcedGoFish) return `Player ${forcedGoFishFor} must Go Fish first.`;
    if (awaitingDrawKey) return "Waiting for the forced-draw card reveal.";
    if (!moves.peekHand) return "Peek is unavailable.";
    if (me?.hasPeeked) return "You already used Instant Peek.";
    return null;
  }, [
    G.phase,
    isZkMode,
    isSecureMode,
    pendingAsk,
    isForcedGoFish,
    forcedGoFishFor,
    awaitingDrawKey,
    moves.peekHand,
    me?.hasPeeked,
  ]);

  const claimDisabledReason = useMemo(() => {
    if (G.phase !== "play") return "Only available during play.";
    if (pendingAsk) return "Resolve the pending ask first.";
    if (isForcedGoFish) return `Player ${forcedGoFishFor} must Go Fish first.`;
    if (awaitingDrawKey) return "Waiting for the forced-draw card reveal.";
    if (isZkMode) {
      if (pendingZk) return "Waiting for verifier verdict.";
      return "Claim Books is ZK-only in this mode.";
    }
    if (pendingReveal) {
      const zoneId = `hand:${currentPlayerID}`;
      const isMine =
        pendingReveal.purpose === "claimBooks" &&
        pendingReveal.zoneId === zoneId;
      if (!isMine) {
        return `Waiting for cooperative reveal (${pendingReveal.purpose}).`;
      }
      const complete = pendingReveal.indices.every(
        (idx) => !!G.crypto?.revealedCards?.[`${zoneId}:${idx}`],
      );
      if (!complete) return "Waiting for reveal shares.";
    }
    if (!moves.claimBooks) return "Claim Books is unavailable.";
    return null;
  }, [
    G.phase,
    pendingAsk,
    isForcedGoFish,
    forcedGoFishFor,
    awaitingDrawKey,
    isZkMode,
    pendingZk,
    pendingReveal,
    currentPlayerID,
    G.crypto?.revealedCards,
    moves.claimBooks,
  ]);

  const askDisabledReason = useMemo(() => {
    if (G.phase !== "play") return "Only available during play.";
    if (!isMyTurn) return "It is not your turn.";
    if (awaitingDrawKey) return "Waiting for the forced-draw card reveal.";
    if (pendingAsk) return "Resolve the pending ask first.";
    if (isForcedGoFish) return `Player ${forcedGoFishFor} must Go Fish first.`;
    if (!moves.askRank) return "Ask is unavailable.";
    if (askTarget === currentPlayerID) return "Pick another player.";
    return null;
  }, [
    G.phase,
    isMyTurn,
    awaitingDrawKey,
    pendingAsk,
    isForcedGoFish,
    forcedGoFishFor,
    moves.askRank,
    askTarget,
    currentPlayerID,
  ]);

  const goFishDisabledReason = useMemo(() => {
    if (G.phase !== "play") return "Only available during play.";
    if (!isMyTurn) return "It is not your turn.";
    if (awaitingDrawKey) return "Waiting for the forced-draw card reveal.";
    if (pendingAsk) return "Waiting for the target to respond.";
    if (pendingReveal) return "Waiting for cooperative reveal.";
    if (!moves.goFish) return "Go Fish is unavailable.";
    if (isForcedGoFish && !iAmForcedToGoFish)
      return `Only Player ${forcedGoFishFor} can Go Fish right now.`;
    return null;
  }, [
    G.phase,
    isMyTurn,
    awaitingDrawKey,
    pendingAsk,
    pendingReveal,
    moves.goFish,
    isForcedGoFish,
    iAmForcedToGoFish,
    forcedGoFishFor,
  ]);

  const respondDisabledReason = useMemo(() => {
    if (G.phase !== "play") return "Only available during play.";
    if (!pendingAsk) return "No pending ask.";
    if (!iAmTarget) return "Only the target can respond.";
    if (isForcedGoFish) return `Player ${forcedGoFishFor} must Go Fish first.`;
    if (awaitingDrawKey) return "Waiting for the forced-draw card reveal.";
    if (isZkMode) {
      if (pendingZk) return "Waiting for verifier verdict.";
      return "Respond is ZK-only in this mode.";
    }
    if (pendingReveal) {
      const zoneId = `hand:${currentPlayerID}`;
      const isMine =
        pendingReveal.purpose === "respondToAsk" &&
        pendingReveal.zoneId === zoneId;
      if (!isMine) return "Waiting for cooperative reveal.";
      const complete = pendingReveal.indices.every(
        (idx) => !!G.crypto?.revealedCards?.[`${zoneId}:${idx}`],
      );
      if (!complete) return "Waiting for reveal shares.";
    }
    if (!moves.respondToAsk) return "Respond is unavailable.";
    return null;
  }, [
    G.phase,
    pendingAsk,
    iAmTarget,
    isForcedGoFish,
    forcedGoFishFor,
    awaitingDrawKey,
    isZkMode,
    pendingZk,
    pendingReveal,
    currentPlayerID,
    G.crypto?.revealedCards,
    moves.respondToAsk,
  ]);

  const canPeek =
    G.phase === "play" &&
    !isZkMode &&
    !isSecureMode &&
    !pendingAsk &&
    !awaitingDrawKey &&
    !isForcedGoFish &&
    !!moves.peekHand &&
    !me?.hasPeeked;

  const canClaimBooks =
    G.phase === "play" &&
    !isZkMode &&
    !pendingAsk &&
    !awaitingDrawKey &&
    !isForcedGoFish &&
    !(
      pendingReveal &&
      !(
        pendingReveal.purpose === "claimBooks" &&
        pendingReveal.zoneId === `hand:${currentPlayerID}`
      )
    ) &&
    !!moves.claimBooks;

  const canAsk =
    G.phase === "play" &&
    isMyTurn &&
    !awaitingDrawKey &&
    !pendingAsk &&
    !pendingReveal &&
    !isForcedGoFish &&
    !!moves.askRank &&
    askTarget !== currentPlayerID;

  const canGoFish =
    G.phase === "play" &&
    isMyTurn &&
    !awaitingDrawKey &&
    !pendingAsk &&
    !pendingReveal &&
    !!moves.goFish &&
    (!isForcedGoFish || iAmForcedToGoFish);

  const canRespond =
    G.phase === "play" &&
    iAmTarget &&
    !!pendingAsk &&
    !awaitingDrawKey &&
    !isForcedGoFish &&
    !isZkMode &&
    !(
      pendingReveal &&
      !(
        pendingReveal.purpose === "respondToAsk" &&
        pendingReveal.zoneId === `hand:${currentPlayerID}`
      )
    ) &&
    !!moves.respondToAsk;

  const canSubmitZkRespond =
    G.phase === "play" &&
    isZkMode &&
    iAmTarget &&
    !!pendingAsk &&
    !pendingZk &&
    !!(moves as any).submitZkProofRespondToAsk;

  const canSubmitZkBooks =
    G.phase === "play" &&
    isZkMode &&
    !pendingAsk &&
    !pendingZk &&
    !!(moves as any).submitZkProofClaimBooks;

  const zkMatchSalt = G.shuffleRng?.finalSeedHex ?? null;

  const canSubmitZkVerdict =
    G.phase === "play" &&
    isZkMode &&
    !!pendingZk &&
    currentPlayerID === verifierId &&
    pendingZk.verdict === null &&
    !!zkMatchSalt &&
    !!(moves as any).submitZkVerdict;

  const heldRanks = useMemo(() => {
    const ranks = new Set<GoFishRank>();
    if (!me?.hasPeeked) return ranks;
    for (const c of me.peekedCards ?? []) ranks.add(c.rank);
    return ranks;
  }, [me?.hasPeeked, me?.peekedCards]);

  const askRankOptions = useMemo(() => {
    if (!me?.hasPeeked || heldRanks.size === 0) return RANKS;
    return RANKS.filter((r) => heldRanks.has(r));
  }, [me?.hasPeeked, heldRanks]);

  // Keep selected rank valid when options shrink.
  useEffect(() => {
    if (!askRankOptions.includes(askRank)) {
      setAskRank(askRankOptions[0] ?? "A");
    }
  }, [askRankOptions, askRank]);

  const getOrCreateKeyPair = (): CryptoKeyPair => {
    if (keyPairRef.current) return keyPairRef.current;

    const stored = readStoredKeyPair(storageKey);
    if (stored) {
      keyPairRef.current = stored;
      setKeyPair(stored);
      return stored;
    }

    const kp = generateKeyPair();
    persistKeyPair(storageKey, kp);
    keyPairRef.current = kp;
    setKeyPair(kp);
    return kp;
  };

  const submitShareForKey = (key: string) => {
    if (!isSecureMode || !moves.submitDecryptionShare) return;
    const kp = getOrCreateKeyPair();
    const m = /^(.+):(\d+)$/.exec(key);
    if (!m) return;
    const zoneId = m[1];
    const cardIndex = Number(m[2]);
    if (!Number.isFinite(cardIndex)) return;
    moves.submitDecryptionShare(
      zoneId,
      cardIndex,
      currentPlayerID,
      kp.privateKey,
    );
  };

  // Eagerly load persisted keypair when match/player changes.
  useEffect(() => {
    keyPairRef.current = null;
    setKeyPair(null);

    const stored = readStoredKeyPair(storageKey);
    if (stored) {
      keyPairRef.current = stored;
      setKeyPair(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Keep askTarget valid when player list changes.
  useEffect(() => {
    if (!G.playerOrder?.length) return;
    if (askTarget === currentPlayerID || !G.players?.[askTarget]) {
      const other = G.playerOrder.find((p) => p !== currentPlayerID);
      if (other) setAskTarget(other);
    }
  }, [G.playerOrder, G.players, askTarget, currentPlayerID]);

  // Auto-run crypto setup phases.
  useEffect(() => {
    const phase = G.phase;
    const actionKey = `${phase}:${currentPlayerID}:${G.setupPlayerIndex}`;
    if (setupAttemptRef.current.has(actionKey)) return;

    if (
      phase === "keyExchange" &&
      me &&
      !me.publicKey &&
      moves.submitPublicKey
    ) {
      setupAttemptRef.current.add(actionKey);
      const kp = getOrCreateKeyPair();
      setTimeout(
        () => moves.submitPublicKey(currentPlayerID, kp.publicKey),
        50,
      );
      return;
    }

    if (
      phase === "keyEscrow" &&
      me &&
      !me.hasDistributedShares &&
      moves.distributeKeyShares
    ) {
      setupAttemptRef.current.add(actionKey);
      const kp = getOrCreateKeyPair();
      // Demo: no shares needed yet.
      setTimeout(
        () =>
          moves.distributeKeyShares(
            currentPlayerID,
            isSecureMode ? "" : kp.privateKey,
            [],
          ),
        50,
      );
      return;
    }

    if (
      phase === "encrypt" &&
      me &&
      !me.hasEncrypted &&
      isMySetupTurn &&
      moves.encryptDeck
    ) {
      setupAttemptRef.current.add(actionKey);
      const kp = getOrCreateKeyPair();
      setTimeout(() => moves.encryptDeck(currentPlayerID, kp.privateKey), 50);
      return;
    }

    // Commit-reveal seed: ALL players must participate (not gated by isMySetupTurn).
    if (phase === "shuffle" && me) {
      const rng = G.shuffleRng ?? null;

      if (moves.commitShuffleSeed && rng?.phase === "commit" && !rng?.commits?.[currentPlayerID]) {
        setupAttemptRef.current.add(`${actionKey}:commitSeed`);
        const seedHex = getOrCreateShuffleSeedHex().toLowerCase();
        const commit = sha256Hex(new TextEncoder().encode(seedHex));
        setTimeout(() => (moves as any).commitShuffleSeed(currentPlayerID, commit), 50);
        return;
      }

      if (moves.revealShuffleSeed && rng?.phase === "reveal" && !rng?.reveals?.[currentPlayerID]) {
        setupAttemptRef.current.add(`${actionKey}:revealSeed`);
        const seedHex = getOrCreateShuffleSeedHex().toLowerCase();
        setTimeout(() => (moves as any).revealShuffleSeed(currentPlayerID, seedHex), 50);
        return;
      }
    }

    // Actual shuffle: sequential per player (gated by isMySetupTurn).
    if (
      phase === "shuffle" &&
      me &&
      !me.hasShuffled &&
      isMySetupTurn &&
      moves.shuffleDeck
    ) {
      const rng = G.shuffleRng ?? null;
      const haveFinalSeed = !!rng?.finalSeedHex;

      if (!haveFinalSeed) {
        // Wait for all players to commit/reveal.
        return;
      }

      setupAttemptRef.current.add(actionKey);
      const kp = getOrCreateKeyPair();
      setTimeout(() => moves.shuffleDeck(currentPlayerID, kp.privateKey), 50);
      return;
    }
  }, [G.phase, G.setupPlayerIndex, G.shuffleRng, currentPlayerID, me, moves, isMySetupTurn]);

  if (ctx.gameover || G.phase === "gameOver") {
    const winners =
      (ctx.gameover?.winners as string[] | undefined) ?? G.winners;
    return (
      <div
        style={{
          padding: 32,
          maxWidth: 900,
          margin: "0 auto",
          fontFamily: "system-ui, sans-serif",
          color: "#e4e4e4",
        }}
      >
        <h2 style={{ margin: "0 0 8px" }}>Go Fish</h2>
        <div style={{ color: "#a0a0a0", marginBottom: 16 }}>
          {winners && winners.length > 0
            ? winners.length === 1
              ? `Winner: Player ${winners[0]}`
              : `Winners: ${winners.map((w) => `Player ${w}`).join(", ")}`
            : "Game Over"}
        </div>

        <div
          style={{
            backgroundColor: "#16213e",
            border: "1px solid #3a3a5c",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(G.players).map(([pid, p]) => (
              <div
                key={pid}
                style={{
                  backgroundColor:
                    pid === currentPlayerID ? "#1e2a45" : "#0f172a",
                  border: "1px solid #3a3a5c",
                  borderRadius: 10,
                  padding: 12,
                  minWidth: 160,
                }}
              >
                <div style={{ fontWeight: 700 }}>Player {pid}</div>
                <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                  Books:{" "}
                  <span style={{ color: "#fbbf24", fontWeight: 700 }}>
                    {p.books}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 1050,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#e4e4e4",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          backgroundColor: "#16213e",
          border: "1px solid #3a3a5c",
          borderRadius: 10,
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Go Fish</div>
           <div style={{ fontSize: 12, color: "#a0a0a0" }}>
             {isZkMode
               ? "ZK Attest mode (verifier-signed verdicts)"
               : isSecureMode
                 ? "Coop Reveal mode (no private keys in shared state)"
                 : "Demo-private mental poker (keys stored in shared state)"}
           </div>
          <div style={{ fontSize: 12, color: "#a0a0a0", marginTop: 6 }}>
            Viewing as{" "}
            <span style={{ color: "#e4e4e4", fontWeight: 800 }}>
              Player {currentPlayerID}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            color: "#a0a0a0",
          }}
        >
          <div>
            Phase:{" "}
            <span style={{ color: "#6fcf6f", fontWeight: 700 }}>
              {PHASE_LABEL[G.phase] ?? G.phase}
            </span>
          </div>
          {G.phase !== "play" && setupPlayerId && (
            <div>
              Setup:{" "}
              <span style={{ color: "#fbbf24", fontWeight: 800 }}>
                Player {setupPlayerId}
              </span>
            </div>
          )}
          <div>
            Turn:{" "}
            <span
              style={{
                color: isMyTurn ? "#fbbf24" : "#e4e4e4",
                fontWeight: 700,
              }}
            >
              Player {G.turnPlayer}
            </span>
          </div>
          <div>
            Deck: <span style={{ fontWeight: 700 }}>{deckCount}</span>
          </div>
          <div>
            Your hand: <span style={{ fontWeight: 700 }}>{myHandCount}</span>
          </div>
        </div>
      </div>

      {/* Deterministic shuffle seed status */}
      {G.phase === "shuffle" && (
        <div
          style={{
            padding: "10px 14px",
            backgroundColor: "#0f172a",
            borderRadius: 10,
            border: "1px solid #3a3a5c",
            marginBottom: 16,
            color: "#cbd5e1",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Shuffle seed</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {shuffleRng?.finalSeedHex
              ? "Ready (all players revealed)."
              : shuffleRng?.phase === "commit"
                ? "Waiting for commits."
                : shuffleRng?.phase === "reveal"
                  ? "Waiting for reveals."
                  : "Preparing..."}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 10,
            }}
          >
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Abort votes: {shuffleAbortVotes}/{shuffleAbortVotesNeeded}
              {shuffleMovesSinceProgress !== null
                ? ` | moves since progress: ${shuffleMovesSinceProgress}`
                : ""}
            </div>
            <button
              onClick={() => (moves as any).voteAbortShuffle?.(currentPlayerID)}
              disabled={!shuffleCanVoteAbort || iVotedAbortShuffle}
              title={
                iVotedAbortShuffle
                  ? "You already voted to abort."
                  : shuffleCanVoteAbort
                  ? "Vote to abort a stalled shuffle (majority required)."
                  : "Abort voting is only enabled after the shuffle stalls."
              }
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #3a3a5c",
                backgroundColor:
                  shuffleCanVoteAbort && !iVotedAbortShuffle ? "#3f1d1d" : "#1f2937",
                color: "#fecaca",
                cursor: "pointer",
                fontWeight: 800,
                opacity: shuffleCanVoteAbort && !iVotedAbortShuffle ? 1 : 0.55,
              }}
            >
              {iVotedAbortShuffle ? "Abort Vote Submitted" : "Vote Abort Shuffle"}
            </button>
          </div>
        </div>
      )}

      {/* Forced Go Fish banner */}
      {forcedGoFishFor && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: iAmForcedToGoFish ? "#14532d" : "#3f1d1d",
            borderRadius: 10,
            border: "1px solid #3a3a5c",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Forced Go Fish</div>
          <div style={{ color: "#cbd5e1" }}>
            Player {forcedGoFishFor} must draw before anything else.
            {forcedGoFishRank ? ` (Asked rank: ${forcedGoFishRank})` : ""}
          </div>
          {awaitingDrawKey && (
            <div style={{ color: "#e0f2fe", fontSize: 12, marginTop: 4 }}>
              Waiting for cooperative reveal: {awaitingDrawKey}
            </div>
          )}

          {isSecureMode && awaitingDrawKey && (
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
              Each player must submit one decryption share for the drawn card.
            </div>
          )}
          {someoneElseForcedToGoFish && (
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
              Your actions are locked until they draw.
            </div>
          )}
          {iAmForcedToGoFish && (
            <div style={{ color: "#bbf7d0", fontSize: 12, marginTop: 4 }}>
              You can only use Go Fish right now.
            </div>
          )}
        </div>
      )}

      {/* Reveals needed (Coop Reveal) */}
      {isSecureMode && (awaitingDrawKey || pendingReveal) && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#0f172a",
            borderRadius: 10,
            border: "1px solid #3a3a5c",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Reveals needed</div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 10 }}>
            Submit your decryption share(s) to reveal the required card(s).
          </div>

          {(() => {
            const keys: string[] = [];
            if (awaitingDrawKey) keys.push(awaitingDrawKey);
            if (pendingReveal) {
              for (const idx of pendingReveal.indices) {
                keys.push(`${pendingReveal.zoneId}:${idx}`);
              }
            }
            const uniqueKeys = Array.from(new Set(keys));
            return (
              <div style={{ display: "grid", gap: 10 }}>
                {uniqueKeys.map((key) => {
                  const m = /^(.+):(\d+)$/.exec(key);
                  const zoneId = m?.[1] ?? "";
                  const cardIndex = Number(m?.[2]);
                  const zone = zoneId
                    ? G.crypto?.encryptedZones?.[zoneId]
                    : null;
                  const card =
                    zone && Number.isFinite(cardIndex) ? zone[cardIndex] : null;
                  const layers = card?.layers ?? null;
                  const revealed = G.crypto?.revealedCards?.[key] ?? null;
                  const pending = G.crypto?.pendingReveals?.[key] ?? {};

                  const iShared = !!pending?.[currentPlayerID];
                  const missingPlayers =
                    layers && layers > 0
                      ? (G.playerOrder ?? []).filter((pid) => !pending?.[pid])
                      : [];

                  const canShare =
                    !!moves.submitDecryptionShare &&
                    !revealed &&
                    layers !== null &&
                    layers > 0 &&
                    !iShared;

                  return (
                    <div
                      key={key}
                      style={{
                        border: "1px solid #3a3a5c",
                        borderRadius: 10,
                        padding: 12,
                        backgroundColor: "rgba(0,0,0,0.15)",
                      }}
                    >
                      <div
                        style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
                      >
                        <div style={{ fontWeight: 800, color: "#e4e4e4" }}>
                          {key}
                        </div>
                        {revealed ? (
                          <div style={{ color: "#bbf7d0", fontSize: 12 }}>
                            Revealed: {revealed}
                          </div>
                        ) : (
                          <div style={{ color: "#cbd5e1", fontSize: 12 }}>
                            Layers remaining: {layers ?? "?"}
                          </div>
                        )}
                      </div>

                      {missingPlayers.length > 0 && (
                        <div
                          style={{
                            color: "#94a3b8",
                            fontSize: 12,
                            marginTop: 6,
                          }}
                        >
                          Missing:{" "}
                          {missingPlayers.map((p) => `P${p}`).join(", ")}
                        </div>
                      )}

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          onClick={() => submitShareForKey(key)}
                          disabled={!canShare}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid #3a3a5c",
                            backgroundColor: canShare ? "#0b3b5a" : "#1f2937",
                            color: "#e0f2fe",
                            cursor: "pointer",
                            fontWeight: 800,
                            opacity: canShare ? 1 : 0.55,
                          }}
                        >
                          {iShared ? "Share Submitted" : "Submit My Share"}
                        </button>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>
                          You: Player {currentPlayerID}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Setup progress */}
      {G.phase !== "play" && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#0f172a",
            borderRadius: 10,
            border: "1px solid #3a3a5c",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Setup</div>
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
            {G.playerOrder.map((pid) => {
              const p = G.players[pid];
              return (
                <div key={pid}>
                  Player {pid}: key={p.publicKey ? "ok" : "..."}, escrow=
                  {p.hasDistributedShares ? "ok" : "..."}, encrypt=
                  {p.hasEncrypted ? "ok" : "..."}, shuffle=
                  {p.hasShuffled ? "ok" : "..."}
                </div>
              );
            })}
          </div>
          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>
            Setup auto-runs per player view. If it stalls, switch to the
            highlighted setup player.
          </div>
        </div>
      )}

      {/* Table / players */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {G.playerOrder.map((pid) => {
          const p = G.players[pid];
          const handCount =
            G.crypto?.encryptedZones?.[`hand:${pid}`]?.length ?? 0;
          const isMe = pid === currentPlayerID;
          const isTurn = G.turnPlayer === pid;
          const isForced = forcedGoFishFor === pid;
          const isSetup =
            G.phase !== "play" &&
            setupPlayerId !== null &&
            setupPlayerId === pid;

          return (
            <div
              key={pid}
              style={{
                backgroundColor: isTurn
                  ? "#1a4a3a"
                  : isMe
                    ? "#1e2a45"
                    : "#0f172a",
                border: "1px solid #3a3a5c",
                borderRadius: 12,
                padding: 14,
                minHeight: 120,
                boxShadow: isSetup ? "0 0 0 2px rgba(251,191,36,0.35)" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <div style={{ fontWeight: 800 }}>
                  Player {pid}
                  {isMe ? " (You)" : ""}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: isTurn ? "#86efac" : "#a0a0a0",
                  }}
                >
                  {isForced
                    ? "Must Go Fish"
                    : isSetup
                      ? "Setup"
                      : isTurn
                        ? "Asking"
                        : "Waiting"}
                </div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                  Hand:{" "}
                  <span style={{ color: "#e4e4e4", fontWeight: 700 }}>
                    {handCount}
                  </span>
                </div>
                <div style={{ color: "#a0a0a0", fontSize: 13 }}>
                  Books:{" "}
                  <span style={{ color: "#fbbf24", fontWeight: 700 }}>
                    {p.books}
                  </span>
                </div>
              </div>

              {/* Visual cards: peeked face-up for self, face-down for others */}
              {isMe && p.hasPeeked && p.peekedCards?.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      color: "#93c5fd",
                      fontWeight: 700,
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    Your Hand
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    {p.peekedCards
                      .slice()
                      .sort(
                        (a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank),
                      )
                      .map((c) => (
                        <CardDisplay key={c.id} card={c} small />
                      ))}
                  </div>
                </div>
              ) : (
                handCount > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {isMe && !p.hasPeeked && (
                      <div
                        style={{
                          color: "#6b7280",
                          fontSize: 11,
                          marginBottom: 6,
                        }}
                      >
                        Peek to reveal your cards
                      </div>
                    )}
                    <FaceDownFan count={handCount} />
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Pending ask */}
      {pendingAsk && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#0f3460",
            borderRadius: 10,
            border: "1px solid #3a3a5c",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Pending Ask</div>
          <div style={{ color: "#cbd5e1" }}>
            Player {pendingAsk.asker} asks Player {pendingAsk.target} for rank{" "}
            {pendingAsk.rank}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            Target should respond; if no cards match, asker must Go Fish.
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          backgroundColor: "#16213e",
          border: "1px solid #3a3a5c",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            onClick={() => {
              const kp = getOrCreateKeyPair();
              if (moves.peekHand)
                moves.peekHand(currentPlayerID, kp.privateKey);
            }}
            disabled={!canPeek}
            title={peekDisabledReason ?? ""}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #4b5563",
              backgroundColor: "#374151",
              color: "#e5e7eb",
              cursor: "pointer",
              opacity: canPeek ? 1 : 0.55,
            }}
          >
            Instant Peek (Demo)
          </button>

          <button
            onClick={() => {
              if (moves.claimBooks) moves.claimBooks(currentPlayerID);
            }}
            disabled={!canClaimBooks}
            title={claimDisabledReason ?? ""}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #4b5563",
              backgroundColor: "#1f2937",
              color: "#e5e7eb",
              cursor: "pointer",
              opacity: canClaimBooks ? 1 : 0.55,
            }}
          >
            {isZkMode
              ? "Claim Books (ZK)"
              : isSecureMode
                ? "Claim Books (Reveal)"
                : "Claim Books"}
          </button>

          {isZkMode && (
            <button
              onClick={() => {
                // Placeholder payload: "claim nothing". Real circuits will drive these.
                (moves as any).submitZkProofClaimBooks?.(
                  currentPlayerID,
                  { vkeyId: "dev", publicSignals: [], proof: {} },
                  {
                    zoneId: `hand:${currentPlayerID}`,
                    bookCount: 0,
                    removeIndices: [],
                  },
                );
              }}
              disabled={!canSubmitZkBooks}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #4b5563",
                backgroundColor: canSubmitZkBooks ? "#0f172a" : "#1f2937",
                color: "#e5e7eb",
                cursor: "pointer",
                opacity: canSubmitZkBooks ? 1 : 0.55,
              }}
              title={
                canSubmitZkBooks
                  ? "Submit placeholder proof"
                  : pendingZk
                    ? "Waiting for verifier verdict"
                    : "Unavailable"
              }
            >
              Submit Proof (Books)
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ color: "#a0a0a0", fontSize: 13, minWidth: 80 }}>
            Ask
          </div>
          <select
            value={askTarget}
            onChange={(e) => setAskTarget(e.target.value)}
            disabled={G.phase !== "play" || !!pendingAsk || isForcedGoFish}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #3a3a5c",
              backgroundColor: "#0f172a",
              color: "#e4e4e4",
            }}
          >
            {G.playerOrder
              .filter((pid) => pid !== currentPlayerID)
              .map((pid) => (
                <option key={pid} value={pid}>
                  Player {pid}
                </option>
              ))}
          </select>
          <select
            value={askRank}
            onChange={(e) => setAskRank(e.target.value as GoFishRank)}
            disabled={G.phase !== "play" || !!pendingAsk || isForcedGoFish}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #3a3a5c",
              backgroundColor: "#0f172a",
              color: "#e4e4e4",
            }}
          >
            {askRankOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {!isSecureMode && me?.hasPeeked && heldRanks.size === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              Tip: Peek showed no readable cards yet.
            </div>
          )}

          {!isSecureMode && !me?.hasPeeked && (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              Tip: Use Instant Peek to filter ranks you can legally ask for.
            </div>
          )}

          <button
            onClick={() => {
              if (moves.askRank)
                moves.askRank(currentPlayerID, askTarget, askRank);
            }}
            disabled={!canAsk}
            title={askDisabledReason ?? ""}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              backgroundColor: "#3b82f6",
              color: "white",
              cursor: "pointer",
              opacity: canAsk ? 1 : 0.55,
            }}
          >
            Ask
          </button>

          <button
            onClick={() => {
              if (moves.goFish) moves.goFish(currentPlayerID);
            }}
            disabled={!canGoFish}
            title={goFishDisabledReason ?? ""}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              backgroundColor: "#22c55e",
              color: "#052e16",
              cursor: "pointer",
              fontWeight: 800,
              opacity: canGoFish ? 1 : 0.55,
            }}
          >
            Go Fish
          </button>
        </div>

        {iAmTarget && (
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ color: "#a0a0a0", fontSize: 13, minWidth: 80 }}>
              Respond
            </div>
            <button
              onClick={() => {
                if (moves.respondToAsk) moves.respondToAsk(currentPlayerID);
              }}
              disabled={!canRespond}
              title={respondDisabledReason ?? ""}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                backgroundColor: "#f59e0b",
                color: "#111827",
                cursor: "pointer",
                fontWeight: 800,
                opacity: canRespond ? 1 : 0.55,
              }}
            >
              {isSecureMode ? "Respond (Reveal)" : "Respond To Ask"}
            </button>

            {isZkMode && (
              <button
                onClick={() => {
                  // Placeholder: resolve as "give none" (miss). Real circuits fill this.
                  const ask = G.pendingAsk;
                  if (!ask) return;
                  (moves as any).submitZkProofRespondToAsk?.(
                    currentPlayerID,
                    { vkeyId: "dev", publicSignals: [], proof: {} },
                    {
                      zoneId: `hand:${currentPlayerID}`,
                      giveIndices: [],
                    },
                  );
                }}
                disabled={!canSubmitZkRespond}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #4b5563",
                  backgroundColor: canSubmitZkRespond ? "#0f172a" : "#1f2937",
                  color: "#e5e7eb",
                  cursor: "pointer",
                  fontWeight: 800,
                  opacity: canSubmitZkRespond ? 1 : 0.55,
                }}
                title={
                  canSubmitZkRespond
                    ? "Submit placeholder proof"
                    : pendingZk
                      ? "Waiting for verifier verdict"
                      : "Unavailable"
                }
              >
                Submit Proof (Respond)
              </button>
            )}
          </div>
        )}

        {isZkMode && pendingZk && (
          <div
            style={{
              marginTop: 8,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #3a3a5c",
              backgroundColor: "rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>ZK Check</div>
            <div style={{ color: "#cbd5e1", fontSize: 12 }}>
              Proof purpose: {pendingZk.purpose}; submitted by Player {pendingZk.submittedBy}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
              Verifier: Player {pendingZk.verifier}
              {pendingZk.payloadHash ? ` | payloadHash=${pendingZk.payloadHash.slice(0, 16)}...` : ""}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  const pz = pendingZk;
                  if (!pz) return;
                  if (!zkMatchSalt) return;
                  const kp = getOrCreateZkSigKeyPair();
                  const decisionHash = sha256Hex(
                    new TextEncoder().encode(
                      stableStringify({
                        pendingId: pz.id,
                        matchSalt: zkMatchSalt,
                        payloadHash: pz.payloadHash,
                        verdict: "valid",
                      }),
                    ),
                  );
                  const sig = ecdsaSignDigestHex(decisionHash, kp.privateKey);
                  (moves as any).submitZkVerdict?.(currentPlayerID, "valid", sig);
                }}
                disabled={!canSubmitZkVerdict}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #3a3a5c",
                  backgroundColor: canSubmitZkVerdict ? "#14532d" : "#1f2937",
                  color: "#bbf7d0",
                  cursor: "pointer",
                  fontWeight: 800,
                  opacity: canSubmitZkVerdict ? 1 : 0.55,
                }}
                title={
                  currentPlayerID !== verifierId
                    ? `Only Player ${verifierId} can submit the verdict.`
                    : !zkMatchSalt
                      ? "Waiting for deterministic shuffle seed (commit-reveal)"
                    : "Sign + submit a VALID verdict"
                }
              >
                Sign Verdict: Valid
              </button>

              <button
                onClick={() => {
                  const pz = pendingZk;
                  if (!pz) return;
                  if (!zkMatchSalt) return;
                  const kp = getOrCreateZkSigKeyPair();
                  const decisionHash = sha256Hex(
                    new TextEncoder().encode(
                      stableStringify({
                        pendingId: pz.id,
                        matchSalt: zkMatchSalt,
                        payloadHash: pz.payloadHash,
                        verdict: "invalid",
                      }),
                    ),
                  );
                  const sig = ecdsaSignDigestHex(decisionHash, kp.privateKey);
                  (moves as any).submitZkVerdict?.(currentPlayerID, "invalid", sig);
                }}
                disabled={!canSubmitZkVerdict}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #3a3a5c",
                  backgroundColor: canSubmitZkVerdict ? "#3f1d1d" : "#1f2937",
                  color: "#fecaca",
                  cursor: "pointer",
                  fontWeight: 800,
                  opacity: canSubmitZkVerdict ? 1 : 0.55,
                }}
                title={
                  currentPlayerID !== verifierId
                    ? `Only Player ${verifierId} can submit the verdict.`
                    : !zkMatchSalt
                      ? "Waiting for deterministic shuffle seed (commit-reveal)"
                    : "Sign + submit an INVALID verdict (voids game)"
                }
              >
                Sign Verdict: Invalid
              </button>

              <div style={{ color: "#6b7280", fontSize: 12, alignSelf: "center" }}>
                Verifier does async proof check off-chain, then signs the verdict. Everyone verifies signature in-move.
              </div>
            </div>
          </div>
        )}

        {(peekDisabledReason ||
          claimDisabledReason ||
          askDisabledReason ||
          goFishDisabledReason ||
          (iAmTarget ? respondDisabledReason : null)) && (
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>
            {!canAsk && askDisabledReason ? `Ask: ${askDisabledReason}` : ""}
            {!canGoFish && goFishDisabledReason
              ? `${!canAsk && askDisabledReason ? " | " : ""}Go Fish: ${goFishDisabledReason}`
              : ""}
            {!canPeek && peekDisabledReason
              ? `${
                  (!canAsk && askDisabledReason) ||
                  (!canGoFish && goFishDisabledReason)
                    ? " | "
                    : ""
                }Peek: ${peekDisabledReason}`
              : ""}
            {!canClaimBooks && claimDisabledReason
              ? `${
                  (!canAsk && askDisabledReason) ||
                  (!canGoFish && goFishDisabledReason) ||
                  (!canPeek && peekDisabledReason)
                    ? " | "
                    : ""
                }Books: ${claimDisabledReason}`
              : ""}
            {iAmTarget && !canRespond && respondDisabledReason
              ? `${
                  (!canAsk && askDisabledReason) ||
                  (!canGoFish && goFishDisabledReason) ||
                  (!canPeek && peekDisabledReason) ||
                  (!canClaimBooks && claimDisabledReason)
                    ? " | "
                    : ""
                }Respond: ${respondDisabledReason}`
              : ""}
          </div>
        )}

        <div style={{ color: "#6b7280", fontSize: 12 }}>
          Local tips: open the header switcher to view other players; each
          player should click Instant Peek. Keys are generated per player view
          and persisted per match (demo).
          {keyPair ? "" : ""}
        </div>
      </div>

      {/* Recent actions */}
      <div
        style={{
          marginTop: 14,
          backgroundColor: "#0f172a",
          border: "1px solid #3a3a5c",
          borderRadius: 12,
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Recent actions</div>
        {(G.log ?? []).length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 12 }}>No actions yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {(G.log ?? []).slice(0, 12).map((e, idx) => (
              <div key={idx} style={{ color: "#cbd5e1", fontSize: 12 }}>
                {e.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debug footer */}
      <div style={{ marginTop: 12, color: "#6b7280", fontSize: 11 }}>
        ctx.phase={String(ctx.phase)}; ctx.currentPlayer=
        {String(ctx.currentPlayer)}
      </div>
    </div>
  );
};
