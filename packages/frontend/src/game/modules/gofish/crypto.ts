/**
 * Crypto Go Fish Game Module
 *
 * Demo-private mental poker setup:
 * - keyExchange -> keyEscrow -> encrypt -> shuffle -> play
 * - deck + hands stored as encryptedZones
 *
 * Security note:
 * - This module stores private keys in G.crypto.privateKeys (demo only).
 */

import type { Ctx, Game } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";

import type { GameConfig } from "../types";
import type { CryptoPluginState } from "../../../crypto/plugin/crypto-plugin";
import {
  decrypt,
  encryptDeck as encryptDeckCrypto,
  getCardPoint,
  reencryptDeck,
  type EncryptedCard,
} from "../../../crypto/mental-poker";
import {
  sha256Hex,
  stableStringify,
  ecdsaVerifyDigestHex,
} from "../../../crypto";
import type { KeyShare } from "../../../crypto/shamirs";

import { GOFISH_SHUFFLE_STALL_WINDOW_MOVES } from "./types";
import type {
  CryptoGoFishPhase,
  CryptoGoFishPlayerState,
  CryptoGoFishState,
  GoFishCard,
  GoFishRank,
  GoFishSuit,
  PendingZkCheck,
  PendingReveal,
  ShuffleRngState,
  ZkProofPurpose,
  ZkClaimBooksPayload,
  ZkProofEnvelope,
  ZkRespondToAskPayload,
  ZkVerdict,
} from "./types";

const SUITS: GoFishSuit[] = ["hearts", "diamonds", "clubs", "spades"];
const RANKS: GoFishRank[] = [
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
  "A",
];

const LOG_LIMIT = 30;

function deterministicStamp(ctx: Ctx): number {
  const turn = Number((ctx as any).turn ?? 0);
  const numMoves = Number((ctx as any).numMoves ?? 0);
  return turn * 1000 + numMoves;
}

function ctxNumMoves(ctx: Ctx): number {
  return Number((ctx as any).numMoves ?? 0);
}

function deterministicId(ctx: Ctx, tag: string): string {
  return `${tag}:${deterministicStamp(ctx)}`;
}

function isHex(s: string): boolean {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s);
}

function deterministicShuffle<T>(arr: T[], seedHex: string): T[] {
  const out = arr.slice();
  const len = out.length;
  if (len <= 1) return out;
  if (!isHex(seedHex) || seedHex.length === 0) return out;

  let counter = 0;
  const nextU32 = (): number => {
    const bytes = new TextEncoder().encode(`${seedHex}:${counter++}`);
    const hex = sha256Hex(bytes);
    return parseInt(hex.slice(0, 8), 16) >>> 0;
  };

  for (let i = len - 1; i > 0; i--) {
    const j = nextU32() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

function ensureShuffleRng(G: CryptoGoFishState): ShuffleRngState {
  const existing = (G as any).shuffleRng as ShuffleRngState | undefined;
  if (existing) return existing;

  const commits: Record<string, string | null> = {};
  const reveals: Record<string, string | null> = {};
  for (const pid of G.playerOrder ?? []) {
    commits[pid] = null;
    reveals[pid] = null;
  }

  const created: ShuffleRngState = {
    phase: "commit",
    commits,
    reveals,
    finalSeedHex: null,
    startedAtMove: null,
    lastProgressMove: null,
    abortVotes: {},
  };
  (G as any).shuffleRng = created;
  return created;
}

function noteShuffleProgress(G: CryptoGoFishState, ctx: Ctx): void {
  const rng = ensureShuffleRng(G);
  const n = ctxNumMoves(ctx);
  if (rng.startedAtMove === null) rng.startedAtMove = n;
  rng.lastProgressMove = n;

  // If the shuffle is making progress again, clear any stale abort votes.
  rng.abortVotes = {};
}

function shuffleAbortVotesNeeded(G: CryptoGoFishState): number {
  return Math.floor(G.playerOrder.length / 2) + 1;
}

function canAbortShuffleNow(G: CryptoGoFishState, ctx: Ctx): boolean {
  const rng = ensureShuffleRng(G);
  if (G.phase !== "shuffle") return false;
  const last = rng.lastProgressMove ?? rng.startedAtMove;
  if (last === null) return false;

  return ctxNumMoves(ctx) - last >= GOFISH_SHUFFLE_STALL_WINDOW_MOVES;
}

function maybeFinalizeShuffleSeed(G: CryptoGoFishState): void {
  const rng = ensureShuffleRng(G);
  if (rng.finalSeedHex) return;

  const allRevealed = (G.playerOrder ?? []).every((pid) => {
    const seed = rng.reveals[pid];
    return typeof seed === "string" && seed.length > 0;
  });
  if (!allRevealed) return;

  const seeds = (G.playerOrder ?? []).map((pid) => rng.reveals[pid]);
  const bytes = new TextEncoder().encode(stableStringify({ seeds }));
  rng.finalSeedHex = sha256Hex(bytes);
  rng.phase = "ready";
}

function pushLog(G: CryptoGoFishState, ctx: Ctx, message: string): void {
  if (!G.log) G.log = [];
  G.log.unshift({ timestamp: deterministicStamp(ctx), message });
  if (G.log.length > LOG_LIMIT) G.log.length = LOG_LIMIT;
}

export function createCardIds(): string[] {
  const ids: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      ids.push(`${suit}-${rank}`);
    }
  }
  return ids;
}

export function parseCardId(cardId: string): GoFishCard {
  const [suit, rank] = cardId.split("-") as [GoFishSuit, GoFishRank];
  return {
    id: cardId,
    name: `${rank} of ${suit}`,
    suit,
    rank,
  };
}

export function handSizeForPlayers(numPlayers: number): number {
  return numPlayers <= 2 ? 7 : 5;
}

export function getCurrentSetupPlayer(state: CryptoGoFishState): string {
  return state.playerOrder[state.setupPlayerIndex];
}

export function advanceSetupPlayer(state: CryptoGoFishState): boolean {
  state.setupPlayerIndex++;
  return state.setupPlayerIndex >= state.playerOrder.length;
}

export function resetSetupPlayer(state: CryptoGoFishState): void {
  state.setupPlayerIndex = 0;
}

export function allKeysSubmitted(state: CryptoGoFishState): boolean {
  return state.playerOrder.every((id) => state.players[id].publicKey !== null);
}

function lookupCardIdFromPoint(
  cardPointLookup: Record<string, string>,
  point: string,
): string | null {
  for (const [cardId, cardPoint] of Object.entries(cardPointLookup)) {
    if (cardPoint === point) return cardId;
  }
  return null;
}

function decryptToCardId(
  G: CryptoGoFishState,
  encryptedCard: EncryptedCard,
): string | null {
  if (G.securityMode !== "demo-private") return null;
  // In demo-private mode we can decrypt by applying *all* private keys.
  // NOTE: Object iteration order matters here; use playerOrder to keep it stable.
  const keys = G.playerOrder
    .map((pid) => G.crypto.privateKeys?.[pid])
    .filter(Boolean) as string[];
  if (keys.length === 0) return null;

  let decrypted = { ...encryptedCard };
  for (const key of keys) {
    if (decrypted.layers <= 0) break;
    try {
      decrypted = decrypt(decrypted, key);
    } catch {
      // ignore and keep trying; demo mode
    }
  }
  if (decrypted.layers !== 0) return null;
  return lookupCardIdFromPoint(G.crypto.cardPointLookup, decrypted.ciphertext);
}

function ensureZone(G: CryptoGoFishState, zoneId: string): EncryptedCard[] {
  if (!G.crypto.encryptedZones[zoneId]) {
    G.crypto.encryptedZones[zoneId] = [];
  }
  return G.crypto.encryptedZones[zoneId];
}

function revealKeyToZoneAndIndex(
  key: string,
): { zoneId: string; cardIndex: number } | null {
  const m = /^(.+):(\d+)$/.exec(key);
  if (!m) return null;
  const zoneId = m[1];
  const cardIndex = Number(m[2]);
  if (!Number.isFinite(cardIndex)) return null;
  return { zoneId, cardIndex };
}

function clearRevealCacheForZone(G: CryptoGoFishState, zoneId: string): void {
  const prefix = `${zoneId}:`;
  for (const key of Object.keys(G.crypto.revealedCards ?? {})) {
    if (key.startsWith(prefix)) delete G.crypto.revealedCards[key];
  }
  for (const key of Object.keys(G.crypto.pendingReveals ?? {})) {
    if (key.startsWith(prefix)) delete G.crypto.pendingReveals[key];
  }
}

function ensurePendingReveal(
  G: CryptoGoFishState,
  ctx: Ctx,
  params: Omit<PendingReveal, "timestamp">,
): void {
  const unique = Array.from(new Set(params.indices))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
  G.pendingReveal = {
    ...params,
    indices: unique,
    timestamp: deterministicStamp(ctx),
  };
}

function isPendingRevealComplete(G: CryptoGoFishState): boolean {
  const pr = G.pendingReveal;
  if (!pr) return true;
  for (const idx of pr.indices) {
    const key = `${pr.zoneId}:${idx}`;
    if (!G.crypto.revealedCards?.[key]) return false;
  }
  return true;
}

function nextPlayerId(G: CryptoGoFishState, current: string): string {
  const idx = G.playerOrder.indexOf(current);
  if (idx < 0) return G.playerOrder[0];
  return G.playerOrder[(idx + 1) % G.playerOrder.length];
}

function allBooksComplete(G: CryptoGoFishState): boolean {
  const totalBooks = Object.values(G.players).reduce(
    (acc, p) => acc + p.books,
    0,
  );
  return totalBooks >= 13;
}

function maybeEndGame(G: CryptoGoFishState): void {
  if (!allBooksComplete(G)) return;
  const best = Math.max(...Object.values(G.players).map((p) => p.books));
  G.winners = Object.entries(G.players)
    .filter(([, p]) => p.books === best)
    .map(([pid]) => pid);
  G.phase = "gameOver";
}

function handHasRank(
  G: CryptoGoFishState,
  playerId: string,
  rank: GoFishRank,
): boolean {
  const hand = ensureZone(G, `hand:${playerId}`);
  for (const encryptedCard of hand) {
    const cardId = decryptToCardId(G, encryptedCard);
    if (!cardId) continue;
    if (parseCardId(cardId).rank === rank) return true;
  }
  return false;
}

function topUpHandIfEmptyNow(G: CryptoGoFishState, playerId: string): void {
  // Optional demo rule: if a player hits 0 cards and deck has cards,
  // draw back up to the initial hand size.
  const hand = ensureZone(G, `hand:${playerId}`);
  if (hand.length > 0) return;

  const deck = ensureZone(G, "deck");
  if (deck.length === 0) return;

  const target = handSizeForPlayers(G.playerOrder.length);
  while (hand.length < target) {
    const card = deck.shift();
    if (!card) break;
    hand.push(card);
  }

  G.players[playerId].hasPeeked = false;
  G.players[playerId].peekedCards = [];
}

function parseRevealedRank(cardId: string | null): GoFishRank | null {
  if (!cardId) return null;
  try {
    return parseCardId(cardId).rank;
  } catch {
    return null;
  }
}

function maybeResolveForcedGoFishDraw(G: CryptoGoFishState, ctx: Ctx): void {
  if (G.securityMode !== "coop-reveal") return;
  const key = G.awaitingGoFishDrawCardKey;
  if (!key) return;

  const revealedCardId = G.crypto.revealedCards[key] ?? null;
  if (!revealedCardId) return;

  const forcedFor = G.awaitingGoFishFor;
  const askedRank = G.awaitingGoFishRank;
  const drewRank = parseRevealedRank(revealedCardId);
  if (!forcedFor || !askedRank || !drewRank) return;

  const drewMatch = drewRank === askedRank;
  G.turnPlayer = drewMatch ? forcedFor : nextPlayerId(G, forcedFor);

  pushLog(
    G,
    ctx,
    `Forced draw revealed: Player ${forcedFor} drew ${drewRank}. ${
      drewMatch ? "They keep the turn." : "Turn passes."
    }`,
  );

  G.awaitingGoFishFor = null;
  G.awaitingGoFishRank = null;
  G.awaitingGoFishDrawCardKey = null;
}

export function createCryptoGoFishState(config: GameConfig): CryptoGoFishState {
  const cardIds = createCardIds();
  const playerOrder = [...config.playerIDs];

  const players: Record<string, CryptoGoFishPlayerState> = {};
  const zones: Record<string, Record<string, GoFishCard[]>> = {
    deck: { shared: [] },
    hand: {},
  };

  for (const playerId of playerOrder) {
    players[playerId] = {
      publicKey: null,
      zkSigPublicKey: null,
      hasDistributedShares: false,
      hasEncrypted: false,
      hasShuffled: false,
      hasPeeked: false,
      peekedCards: [],
      books: 0,
    };
    zones.hand[playerId] = [];
  }

  const cryptoState: CryptoPluginState = {
    phase: "init",
    publicKeys: {},
    commitments: {},
    shuffleProofs: {},
    encryptedZones: {},
    cardPointLookup: {},
    revealedCards: {},
    pendingReveals: {},
  };

  const commits: Record<string, string | null> = {};
  const reveals: Record<string, string | null> = {};
  for (const pid of playerOrder) {
    commits[pid] = null;
    reveals[pid] = null;
  }

  const shuffleRng: ShuffleRngState = {
    phase: "commit",
    commits,
    reveals,
    finalSeedHex: null,
    startedAtMove: null,
    lastProgressMove: null,
    abortVotes: {},
  };

  return {
    players,
    phase: "keyExchange",
    securityMode: "demo-private",
    crypto: cryptoState,
    cardIds,
    playerOrder,
    setupPlayerIndex: 0,
    turnPlayer: playerOrder[0] ?? "0",
    awaitingGoFishFor: null,
    awaitingGoFishRank: null,
    awaitingGoFishDrawCardKey: null,
    pendingAsk: null,
    pendingReveal: null,
    pendingZk: null,
    shuffleRng,
    winners: [],
    log: [],
    zones,
  };
}

export function commitShuffleSeed(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  commitHashHex: string,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  const rng = ensureShuffleRng(G);

  if (rng.phase !== "commit" && rng.phase !== "reveal") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (!isHex(commitHashHex) || commitHashHex.length !== 64) return INVALID_MOVE;

  const existing = rng.commits[playerId] ?? null;
  if (existing && existing !== commitHashHex) return INVALID_MOVE;
  rng.commits[playerId] = commitHashHex;
  noteShuffleProgress(G, ctx);

  const allCommitted = (G.playerOrder ?? []).every((pid) => {
    const c = rng.commits[pid];
    return typeof c === "string" && c.length === 64;
  });
  if (allCommitted) rng.phase = "reveal";

  pushLog(G, ctx, `Player ${playerId} committed a shuffle seed.`);
  return G;
}

export function revealShuffleSeed(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  seedHex: string,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  const rng = ensureShuffleRng(G);

  if (rng.phase !== "reveal" && rng.phase !== "ready") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (!isHex(seedHex) || seedHex.length < 16) return INVALID_MOVE;

  const commit = rng.commits[playerId];
  if (!commit) return INVALID_MOVE;
  const bytes = new TextEncoder().encode(seedHex.toLowerCase());
  const computed = sha256Hex(bytes);
  if (computed !== commit.toLowerCase()) return INVALID_MOVE;

  const existing = rng.reveals[playerId] ?? null;
  if (existing && existing.toLowerCase() !== seedHex.toLowerCase()) return INVALID_MOVE;
  rng.reveals[playerId] = seedHex.toLowerCase();
  noteShuffleProgress(G, ctx);

  pushLog(G, ctx, `Player ${playerId} revealed their shuffle seed.`);
  maybeFinalizeShuffleSeed(G);
  return G;
}

export function voteAbortShuffle(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (!canAbortShuffleNow(G, ctx)) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);
  rng.abortVotes[playerId] = true;
  pushLog(G, ctx, `Player ${playerId} voted to abort stalled shuffle.`);

  const votes = Object.values(rng.abortVotes).filter(Boolean).length;
  if (votes >= shuffleAbortVotesNeeded(G)) {
    pushLog(G, ctx, "Shuffle stalled. Majority voted to abort. Game voided.");
    G.phase = "voided";
  }

  return G;
}

function computeZkPayloadHash(p: {
  id: string;
  purpose: ZkProofPurpose;
  submittedBy: string;
  envelope: ZkProofEnvelope;
  payload: unknown;
}): string {
  return sha256Hex(
    new TextEncoder().encode(
      stableStringify({
        id: p.id,
        purpose: p.purpose,
        submittedBy: p.submittedBy,
        envelope: p.envelope,
        payload: p.payload,
      }),
    ),
  );
}

function applyZkRespondToAsk(
  G: CryptoGoFishState,
  ctx: Ctx,
  ask: { asker: string; target: string; rank: GoFishRank },
  payload: ZkRespondToAskPayload,
): CryptoGoFishState {
  const zoneId = payload.zoneId;
  if (zoneId !== `hand:${ask.target}`) return G;

  const targetHand = ensureZone(G, zoneId);
  const askerHand = ensureZone(G, `hand:${ask.asker}`);

  const uniqueSorted = Array.from(new Set(payload.giveIndices))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < targetHand.length)
    .sort((a, b) => b - a);

  for (const idx of uniqueSorted) {
    const [card] = targetHand.splice(idx, 1);
    if (card) askerHand.push(card);
  }

  clearRevealCacheForZone(G, zoneId);
  clearRevealCacheForZone(G, `hand:${ask.asker}`);

  topUpHandIfEmptyNow(G, ask.target);
  topUpHandIfEmptyNow(G, ask.asker);

  if (uniqueSorted.length > 0) {
    G.turnPlayer = ask.asker;
    G.awaitingGoFishFor = null;
    G.awaitingGoFishRank = null;
    pushLog(
      G,
      ctx,
      `ZK response accepted: Player ${ask.target} gave ${uniqueSorted.length} card(s) to Player ${ask.asker}.`,
    );
  } else {
    G.turnPlayer = ask.asker;
    G.awaitingGoFishFor = ask.asker;
    G.awaitingGoFishRank = ask.rank;
    pushLog(
      G,
      ctx,
      `ZK response accepted: Player ${ask.target} proved they had no ${ask.rank}s. Player ${ask.asker} must draw.`,
    );
  }

  maybeEndGame(G);
  return G;
}

function applyZkClaimBooks(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  payload: ZkClaimBooksPayload,
): CryptoGoFishState {
  const zoneId = payload.zoneId;
  if (zoneId !== `hand:${playerId}`) return G;

  const hand = ensureZone(G, zoneId);
  const uniqueSorted = Array.from(new Set(payload.removeIndices))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < hand.length)
    .sort((a, b) => b - a);

  for (const idx of uniqueSorted) {
    hand.splice(idx, 1);
  }
  if (payload.bookCount > 0) {
    G.players[playerId].books += payload.bookCount;
  }

  clearRevealCacheForZone(G, zoneId);
  pushLog(
    G,
    ctx,
    `ZK claim accepted: Player ${playerId} claimed ${payload.bookCount} book(s).`,
  );

  topUpHandIfEmptyNow(G, playerId);
  maybeEndGame(G);
  return G;
}

// =============================================================================
// Setup Moves
// =============================================================================

export function submitPublicKey(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  publicKey: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "keyExchange") return INVALID_MOVE;
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.publicKey !== null) return INVALID_MOVE;

  player.publicKey = publicKey;
  G.crypto.publicKeys[playerId] = publicKey;
  pushLog(G, ctx, `Player ${playerId} submitted their public key.`);

  if (allKeysSubmitted(G)) {
    for (const cardId of G.cardIds) {
      G.crypto.cardPointLookup[cardId] = getCardPoint(cardId);
    }
    G.phase = "keyEscrow";
    resetSetupPlayer(G);
    pushLog(G, ctx, "All public keys submitted. Moving to key escrow.");
  }

  return G;
}

export function submitZkSigPublicKey(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  zkSigPublicKey: string,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.securityMode !== "zk-attest") return INVALID_MOVE;
  void ctx;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (typeof zkSigPublicKey !== "string" || zkSigPublicKey.length === 0)
    return INVALID_MOVE;

  // Allow idempotent resubmits, but disallow changing to a different key.
  if (player.zkSigPublicKey && player.zkSigPublicKey !== zkSigPublicKey) {
    return INVALID_MOVE;
  }
  player.zkSigPublicKey = zkSigPublicKey;
  return G;
}

export function distributeKeyShares(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  shares: KeyShare[],
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "keyEscrow") return INVALID_MOVE;
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasDistributedShares) return INVALID_MOVE;

  // Shares are accepted for future abandonment support (not used yet).
  void shares;

  player.hasDistributedShares = true;

  if (G.securityMode === "demo-private") {
    // DEMO ONLY: store private key in shared state.
    if (!G.crypto.privateKeys) G.crypto.privateKeys = {};
    G.crypto.privateKeys[playerId] = privateKey;
    pushLog(G, ctx, `Player ${playerId} escrowed their key (demo).`);
  } else {
    // In coop-reveal mode, never store private keys in shared state.
    void privateKey;
    pushLog(G, ctx, `Player ${playerId} completed key escrow.`);
  }

  const allDistributed = G.playerOrder.every(
    (pid) => G.players[pid].hasDistributedShares,
  );
  if (allDistributed) {
    G.phase = "encrypt";
    resetSetupPlayer(G);
    pushLog(G, ctx, "All keys escrowed. Starting deck encryption.");
  }

  return G;
}

export function encryptDeck(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt") return INVALID_MOVE;
  if (playerId !== getCurrentSetupPlayer(G)) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasEncrypted) return INVALID_MOVE;

  const existingDeck = G.crypto.encryptedZones["deck"];
  if (!existingDeck || existingDeck.length === 0) {
    G.crypto.encryptedZones["deck"] = encryptDeckCrypto(G.cardIds, privateKey);
  } else {
    G.crypto.encryptedZones["deck"] = reencryptDeck(existingDeck, privateKey);
  }

  player.hasEncrypted = true;
  G.crypto.phase = "encrypt";
  pushLog(G, ctx, `Player ${playerId} encrypted the deck.`);

  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
    resetSetupPlayer(G);
    pushLog(G, ctx, "Deck encryption complete. Starting shuffle + deal.");
  }

  return G;
}

export function shuffleDeck(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  events?: { endPhase?: () => void },
): CryptoGoFishState | typeof INVALID_MOVE {
  void privateKey;
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (playerId !== getCurrentSetupPlayer(G)) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasShuffled) return INVALID_MOVE;

  const encryptedDeck = G.crypto.encryptedZones["deck"];
  if (!encryptedDeck || encryptedDeck.length === 0) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);
  if (!rng.finalSeedHex) return INVALID_MOVE;
  noteShuffleProgress(G, ctx);
  // Deterministic Fisher-Yates using the agreed seed.
  G.crypto.encryptedZones["deck"] = deterministicShuffle(
    encryptedDeck,
    sha256Hex(new TextEncoder().encode(`${rng.finalSeedHex}:${playerId}`)),
  );
  player.hasShuffled = true;
  G.crypto.phase = "shuffle";
  pushLog(G, ctx, `Player ${playerId} shuffled the deck.`);

  if (advanceSetupPlayer(G)) {
    G.crypto.phase = "ready";
    dealInitialHands(G);
    G.phase = "play";
    pushLog(G, ctx, "Hands dealt. Play begins.");

    const isInSetupPhase = ctx.phase === "setup";
    if (isInSetupPhase && events?.endPhase) {
      events.endPhase();
    }
  }

  return G;
}

function dealInitialHands(G: CryptoGoFishState): void {
  const deck = ensureZone(G, "deck");
  const n = G.playerOrder.length;
  const handSize = handSizeForPlayers(n);

  for (const pid of G.playerOrder) {
    ensureZone(G, `hand:${pid}`);
    G.players[pid].hasPeeked = false;
    G.players[pid].peekedCards = [];
  }

  for (let round = 0; round < handSize; round++) {
    for (const pid of G.playerOrder) {
      const card = deck.shift();
      if (!card) return;
      G.crypto.encryptedZones[`hand:${pid}`].push(card);
    }
  }
}

// =============================================================================
// Play Moves
// =============================================================================

export function peekHand(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  void ctx;
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  if (G.securityMode !== "demo-private") return INVALID_MOVE;
  // When a forced Go Fish is pending, only the forced player should act,
  // and they must use goFish.
  if (G.awaitingGoFishFor) return INVALID_MOVE;
  if (G.pendingAsk) return INVALID_MOVE;
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasPeeked) return INVALID_MOVE;

  const handZone = G.crypto.encryptedZones[`hand:${playerId}`];
  if (!handZone || handZone.length === 0) {
    player.peekedCards = [];
    player.hasPeeked = true;
    return G;
  }

  // Demo: decrypt with player's key + all others in shared state.
  const allPrivateKeys: string[] = [privateKey];
  for (const [pid, key] of Object.entries(G.crypto.privateKeys ?? {})) {
    if (pid !== playerId && key) allPrivateKeys.push(key);
  }

  const peeked: GoFishCard[] = [];
  for (const encryptedCard of handZone) {
    let decrypted = { ...encryptedCard };
    for (const key of allPrivateKeys) {
      if (decrypted.layers <= 0) break;
      try {
        decrypted = decrypt(decrypted, key);
      } catch {
        // ignore
      }
    }
    if (decrypted.layers === 0) {
      const cardId = lookupCardIdFromPoint(
        G.crypto.cardPointLookup,
        decrypted.ciphertext,
      );
      if (cardId) peeked.push(parseCardId(cardId));
    }
  }

  player.peekedCards = peeked;
  player.hasPeeked = true;
  pushLog(G, ctx, `Player ${playerId} used Instant Peek (demo).`);
  return G;
}

export function askRank(
  G: CryptoGoFishState,
  ctx: Ctx,
  asker: string,
  target: string,
  rank: GoFishRank,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  if (G.pendingReveal) return INVALID_MOVE;
  if (G.pendingAsk) return INVALID_MOVE;
  if (asker !== G.turnPlayer) return INVALID_MOVE;
  if (G.awaitingGoFishFor === asker) return INVALID_MOVE;
  if (G.awaitingGoFishFor && G.awaitingGoFishFor !== asker) return INVALID_MOVE;
  if (asker === target) return INVALID_MOVE;
  if (!G.players[asker] || !G.players[target]) return INVALID_MOVE;

  topUpHandIfEmptyNow(G, asker);

  // Rule: you may only ask for a rank you hold.
  if (G.securityMode === "demo-private") {
    if (!handHasRank(G, asker, rank)) return INVALID_MOVE;
  }

  if (G.securityMode === "coop-reveal") {
    pushLog(
      G,
      ctx,
      `Note: Coop Reveal mode currently does not enforce "ask only ranks you hold".`,
    );
  }

  G.pendingAsk = {
    asker,
    target,
    rank,
    status: "pending",
    timestamp: deterministicStamp(ctx),
  };
  pushLog(G, ctx, `Player ${asker} asked Player ${target} for ${rank}s.`);
  return G;
}

export function respondToAsk(
  G: CryptoGoFishState,
  ctx: Ctx,
  target: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  const ask = G.pendingAsk;
  if (!ask || ask.status !== "pending") return INVALID_MOVE;
  if (ask.target !== target) return INVALID_MOVE;
  if (G.awaitingGoFishFor) return INVALID_MOVE;

  if (G.securityMode === "zk-attest") {
    if (G.pendingZk) return INVALID_MOVE;
    // This move becomes a "request" in zk-attest mode; the target must submit a proof.
    pushLog(
      G,
      ctx,
      `ZK requested: Player ${target} must submit a proof to respond to the ask.`,
    );
    return G;
  }

  if (G.securityMode === "coop-reveal") {
    const zoneId = `hand:${target}`;
    const hand = ensureZone(G, zoneId);
    if (!G.pendingReveal) {
      ensurePendingReveal(G, ctx, {
        purpose: "respondToAsk",
        zoneId,
        indices: Array.from({ length: hand.length }, (_, i) => i),
        initiatedBy: target,
      });
      pushLog(
        G,
        ctx,
        `Coop Reveal started: Player ${target} revealing hand to respond to ask.`,
      );
      return G;
    }

    if (
      G.pendingReveal.purpose !== "respondToAsk" ||
      G.pendingReveal.zoneId !== zoneId
    ) {
      return INVALID_MOVE;
    }

    if (!isPendingRevealComplete(G)) {
      return INVALID_MOVE;
    }

    // If the target has no cards (deck empty), resolve as miss.
    if (hand.length === 0) {
      ask.status = "resolved";
      G.pendingAsk = null;
      G.pendingReveal = null;

      const askAsker = ask.asker;
      const askRank = ask.rank;
      G.turnPlayer = askAsker;
      G.awaitingGoFishFor = askAsker;
      G.awaitingGoFishRank = askRank;
      pushLog(
        G,
        ctx,
        `Player ${target} had no cards. Player ${askAsker} must Go Fish for ${askRank}s.`,
      );
      return G;
    }

    // All cards in target hand are revealed, resolve the response.
    const indicesToGive: number[] = [];
    for (let i = 0; i < hand.length; i++) {
      const key = `${zoneId}:${i}`;
      const cardId = G.crypto.revealedCards[key] ?? null;
      const rank = parseRevealedRank(cardId);
      if (rank && rank === ask.rank) indicesToGive.push(i);
    }

    const askerHand = ensureZone(G, `hand:${ask.asker}`);
    indicesToGive.sort((a, b) => b - a);
    for (const idx of indicesToGive) {
      const [card] = hand.splice(idx, 1);
      if (card) askerHand.push(card);
    }

    // Any splice invalidates zone index keys; clear reveal caches.
    clearRevealCacheForZone(G, zoneId);
    clearRevealCacheForZone(G, `hand:${ask.asker}`);

    G.pendingReveal = null;

    topUpHandIfEmptyNow(G, target);
    topUpHandIfEmptyNow(G, ask.asker);

    // Mark resolved.
    ask.status = "resolved";
    const askAsker = ask.asker;
    const askRank = ask.rank;
    G.pendingAsk = null;

    if (indicesToGive.length > 0) {
      G.turnPlayer = askAsker;
      G.awaitingGoFishFor = null;
      G.awaitingGoFishRank = null;
      pushLog(
        G,
        ctx,
        `Player ${target} gave ${indicesToGive.length} card(s) to Player ${askAsker}.`,
      );
    } else {
      G.turnPlayer = askAsker;
      G.awaitingGoFishFor = askAsker;
      G.awaitingGoFishRank = askRank;
      pushLog(
        G,
        ctx,
        `Go Fish: Player ${target} had no ${askRank}s. Player ${askAsker} must draw.`,
      );
    }

    maybeEndGame(G);
    return G;
  }

  if (G.securityMode !== "demo-private") return INVALID_MOVE;

  topUpHandIfEmptyNow(G, target);

  // If the target has no cards after top-up (deck empty), resolve as miss.
  const targetHandPre = ensureZone(G, `hand:${target}`);
  if (targetHandPre.length === 0) {
    const askAsker = ask.asker;
    const askRank = ask.rank;
    ask.status = "resolved";
    G.pendingAsk = null;
    G.players[askAsker].hasPeeked = false;
    G.players[askAsker].peekedCards = [];
    G.players[target].hasPeeked = false;
    G.players[target].peekedCards = [];

    G.turnPlayer = askAsker;
    G.awaitingGoFishFor = askAsker;
    G.awaitingGoFishRank = askRank;
    pushLog(
      G,
      ctx,
      `Player ${target} had no cards. Player ${askAsker} must Go Fish for ${askRank}s.`,
    );
    return G;
  }

  const targetHand = targetHandPre;
  const askerHand = ensureZone(G, `hand:${ask.asker}`);

  // Determine which cards match the asked rank (demo: decrypt in move).
  const indicesToGive: number[] = [];
  for (let i = 0; i < targetHand.length; i++) {
    const cardId = decryptToCardId(G, targetHand[i]);
    if (!cardId) continue;
    const card = parseCardId(cardId);
    if (card.rank === ask.rank) indicesToGive.push(i);
  }

  // Move cards from target to asker (from highest index to lowest).
  indicesToGive.sort((a, b) => b - a);
  for (const idx of indicesToGive) {
    const [card] = targetHand.splice(idx, 1);
    if (card) askerHand.push(card);
  }

  topUpHandIfEmptyNow(G, target);
  topUpHandIfEmptyNow(G, ask.asker);

  // Mark resolved.
  ask.status = "resolved";
  const askAsker = ask.asker;
  const askRank = ask.rank;
  G.pendingAsk = null;

  // Update cached peeks (best effort).
  G.players[askAsker].hasPeeked = false;
  G.players[askAsker].peekedCards = [];
  G.players[target].hasPeeked = false;
  G.players[target].peekedCards = [];

  if (indicesToGive.length > 0) {
    // Successful ask: asker keeps turn.
    G.turnPlayer = askAsker;
    G.awaitingGoFishFor = null;
    G.awaitingGoFishRank = null;
    pushLog(
      G,
      ctx,
      `Player ${target} gave ${indicesToGive.length} card(s) to Player ${askAsker}.`,
    );
  } else {
    // Miss: asker must Go Fish before asking again.
    G.turnPlayer = askAsker;
    G.awaitingGoFishFor = askAsker;
    G.awaitingGoFishRank = askRank;
    pushLog(
      G,
      ctx,
      `Go Fish: Player ${target} had no ${askRank}s. Player ${askAsker} must draw.`,
    );
  }

  return G;
}

export function goFish(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (playerId !== G.turnPlayer) return INVALID_MOVE;
  if (G.pendingAsk) return INVALID_MOVE;
  if (G.pendingReveal) return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  // If we're awaiting a forced draw, only that player can act,
  // and they must use goFish.
  if (G.awaitingGoFishFor && G.awaitingGoFishFor !== playerId)
    return INVALID_MOVE;

  const deck = ensureZone(G, "deck");
  const hand = ensureZone(G, `hand:${playerId}`);
  const card = deck.shift();
  if (card) hand.push(card);

  G.players[playerId].hasPeeked = false;
  G.players[playerId].peekedCards = [];

  // If this was a forced Go Fish (after a miss), the drawer continues only if
  // they drew the rank they asked for.
  if (G.awaitingGoFishFor === playerId) {
    const askedRank = G.awaitingGoFishRank;
    const drawnKey = card ? `hand:${playerId}:${hand.length - 1}` : null;

    if (G.securityMode === "coop-reveal") {
      // Keep forced state until the drawn card is cooperatively revealed.
      G.awaitingGoFishDrawCardKey = drawnKey;
      pushLog(
        G,
        ctx,
        `Player ${playerId} drew a forced Go Fish card${
          askedRank ? ` (for ${askedRank}s)` : ""
        }. Waiting for cooperative reveal.`,
      );
      topUpHandIfEmptyNow(G, playerId);
      maybeEndGame(G);
      return G;
    }

    // demo-private: resolve immediately by decrypting.
    G.awaitingGoFishFor = null;
    G.awaitingGoFishRank = null;
    G.awaitingGoFishDrawCardKey = drawnKey;

    let drewMatch = false;
    if (card && askedRank) {
      const cardId = decryptToCardId(G, card);
      if (cardId && parseCardId(cardId).rank === askedRank) {
        drewMatch = true;
      }
    }

    G.turnPlayer = drewMatch ? playerId : nextPlayerId(G, playerId);
    pushLog(
      G,
      ctx,
      `Player ${playerId} went fishing${askedRank ? ` (for ${askedRank}s)` : ""}. ${
        drewMatch ? "They drew the rank and keep the turn." : "Turn passes."
      }
      `,
    );
    G.awaitingGoFishDrawCardKey = null;
  } else {
    // Voluntary fishing ends turn.
    G.turnPlayer = nextPlayerId(G, playerId);
    pushLog(G, ctx, `Player ${playerId} drew a card. Turn passes.`);
  }

  topUpHandIfEmptyNow(G, playerId);
  maybeEndGame(G);
  return G;
}

export function claimBooks(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  // When a forced Go Fish is pending, only the forced player should act,
  // and they must use goFish.
  if (G.awaitingGoFishFor) return INVALID_MOVE;
  if (G.pendingAsk) return INVALID_MOVE;

  if (G.securityMode === "zk-attest") {
    if (G.pendingZk) return INVALID_MOVE;
    pushLog(
      G,
      ctx,
      `ZK requested: Player ${playerId} must submit a proof to claim books.`,
    );
    return G;
  }

  if (G.securityMode === "coop-reveal") {
    const zoneId = `hand:${playerId}`;
    const hand = ensureZone(G, zoneId);
    if (hand.length < 4) return G;

    if (!G.pendingReveal) {
      ensurePendingReveal(G, ctx, {
        purpose: "claimBooks",
        zoneId,
        indices: Array.from({ length: hand.length }, (_, i) => i),
        initiatedBy: playerId,
      });
      pushLog(
        G,
        ctx,
        `Coop Reveal started: Player ${playerId} revealing hand to claim books.`,
      );
      return G;
    }

    if (
      G.pendingReveal.purpose !== "claimBooks" ||
      G.pendingReveal.zoneId !== zoneId
    ) {
      return INVALID_MOVE;
    }

    if (!isPendingRevealComplete(G)) {
      return INVALID_MOVE;
    }

    const byRank: Record<string, number[]> = {};
    for (let i = 0; i < hand.length; i++) {
      const key = `${zoneId}:${i}`;
      const cardId = G.crypto.revealedCards[key] ?? null;
      const rank = parseRevealedRank(cardId);
      if (!rank) continue;
      if (!byRank[rank]) byRank[rank] = [];
      byRank[rank].push(i);
    }

    const ranksCompleted = Object.entries(byRank)
      .filter(([, idxs]) => idxs.length === 4)
      .map(([rank]) => rank);

    if (ranksCompleted.length === 0) {
      G.pendingReveal = null;
      clearRevealCacheForZone(G, zoneId);
      return G;
    }

    for (const rank of ranksCompleted) {
      const idxs = (byRank[rank] ?? []).slice().sort((a, b) => b - a);
      for (const idx of idxs) {
        hand.splice(idx, 1);
      }
      G.players[playerId].books += 1;
    }

    pushLog(
      G,
      ctx,
      `Player ${playerId} claimed ${ranksCompleted.length} book(s).`,
    );

    G.pendingReveal = null;
    clearRevealCacheForZone(G, zoneId);

    topUpHandIfEmptyNow(G, playerId);
    maybeEndGame(G);
    return G;
  }

  if (G.securityMode !== "demo-private") return INVALID_MOVE;
  const hand = ensureZone(G, `hand:${playerId}`);
  if (hand.length < 4) return G;

  // Demo: decrypt all cards in hand and group by rank.
  const byRank: Record<string, number[]> = {};
  for (let i = 0; i < hand.length; i++) {
    const cardId = decryptToCardId(G, hand[i]);
    if (!cardId) continue;
    const rank = parseCardId(cardId).rank;
    if (!byRank[rank]) byRank[rank] = [];
    byRank[rank].push(i);
  }

  const ranksCompleted = Object.entries(byRank)
    .filter(([, idxs]) => idxs.length === 4)
    .map(([rank]) => rank);

  if (ranksCompleted.length === 0) return G;

  for (const rank of ranksCompleted) {
    const idxs = (byRank[rank] ?? []).slice().sort((a, b) => b - a);
    for (const idx of idxs) {
      hand.splice(idx, 1);
    }
    G.players[playerId].books += 1;
  }

  pushLog(
    G,
    ctx,
    `Player ${playerId} claimed ${ranksCompleted.length} book(s).`,
  );

  topUpHandIfEmptyNow(G, playerId);

  G.players[playerId].hasPeeked = false;
  G.players[playerId].peekedCards = [];

  maybeEndGame(G);
  return G;
}

export function submitZkProofRespondToAsk(
  G: CryptoGoFishState,
  ctx: Ctx,
  target: string,
  envelope: ZkProofEnvelope,
  payload: ZkRespondToAskPayload,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.securityMode !== "zk-attest") return INVALID_MOVE;
  if (callerId && callerId !== target) return INVALID_MOVE;
  if (G.awaitingGoFishFor) return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  if (G.pendingReveal) return INVALID_MOVE;
  const ask = G.pendingAsk;
  if (!ask || ask.status !== "pending") return INVALID_MOVE;
  if (ask.target !== target) return INVALID_MOVE;
  if (G.pendingZk) return INVALID_MOVE;

  const pending: PendingZkCheck = {
    id: deterministicId(ctx, "zk:respond"),
    purpose: "respondToAsk",
    submittedBy: target,
    envelope,
    payload,
    timestamp: deterministicStamp(ctx),
    verifier: G.playerOrder[0] ?? target,
    payloadHash: "",
    verdict: null,
    verdictSig: null,
  };
  pending.payloadHash = computeZkPayloadHash(pending);
  G.pendingZk = pending;

  pushLog(
    G,
    ctx,
    `ZK proof submitted by Player ${target} (awaiting verifier verdict).`,
  );
  return G;
}

export function submitZkProofClaimBooks(
  G: CryptoGoFishState,
  ctx: Ctx,
  playerId: string,
  envelope: ZkProofEnvelope,
  payload: ZkClaimBooksPayload,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.securityMode !== "zk-attest") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (G.awaitingGoFishFor) return INVALID_MOVE;
  if (G.awaitingGoFishDrawCardKey) return INVALID_MOVE;
  if (G.pendingReveal) return INVALID_MOVE;
  if (G.pendingAsk) return INVALID_MOVE;
  if (G.pendingZk) return INVALID_MOVE;

  const pending: PendingZkCheck = {
    id: deterministicId(ctx, "zk:books"),
    purpose: "claimBooks",
    submittedBy: playerId,
    envelope,
    payload,
    timestamp: deterministicStamp(ctx),
    verifier: G.playerOrder[0] ?? playerId,
    payloadHash: "",
    verdict: null,
    verdictSig: null,
  };
  pending.payloadHash = computeZkPayloadHash(pending);
  G.pendingZk = pending;
  pushLog(
    G,
    ctx,
    `ZK proof submitted by Player ${playerId} (awaiting verifier verdict).`,
  );
  return G;
}

export function submitZkVerdict(
  G: CryptoGoFishState,
  ctx: Ctx,
  verifier: string,
  verdict: ZkVerdict,
  signatureHex: string,
  callerId?: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.securityMode !== "zk-attest") return INVALID_MOVE;
  if (callerId && callerId !== verifier) return INVALID_MOVE;
  const pz = G.pendingZk;
  if (!pz) return INVALID_MOVE;

  if (!G.players[verifier]) return INVALID_MOVE;
  if (verifier !== pz.verifier) return INVALID_MOVE;
  if (pz.verdict !== null) return INVALID_MOVE;

  const pk = G.players[verifier].zkSigPublicKey;
  if (!pk) return INVALID_MOVE;

  const expectedHash = computeZkPayloadHash(pz);
  if (expectedHash !== pz.payloadHash) return INVALID_MOVE;

  // Domain separation: bind verdict signatures to this specific match's shuffle seed.
  // This helps prevent cross-match replay if the same verifier key is reused.
  const matchSalt = G.shuffleRng?.finalSeedHex;
  if (!matchSalt) return INVALID_MOVE;

  const decisionHash = sha256Hex(
    new TextEncoder().encode(
      stableStringify({
        pendingId: pz.id,
        matchSalt,
        payloadHash: pz.payloadHash,
        verdict,
      }),
    ),
  );

  if (!ecdsaVerifyDigestHex(decisionHash, signatureHex, pk)) return INVALID_MOVE;

  pz.verdict = verdict;
  pz.verdictSig = signatureHex;
  pushLog(G, ctx, `ZK verdict submitted by Player ${verifier}: ${verdict}.`);

  if (verdict !== "valid") {
    pushLog(G, ctx, `ZK proof rejected. Game voided.`);
    G.phase = "voided";
    return G;
  }

  // Apply state transition based on payload.
  if (pz.purpose === "respondToAsk") {
    const ask = G.pendingAsk;
    if (ask && ask.status === "pending") {
      applyZkRespondToAsk(G, ctx, ask, pz.payload as ZkRespondToAskPayload);
      ask.status = "resolved";
      G.pendingAsk = null;
    }
  }

  if (pz.purpose === "claimBooks") {
    applyZkClaimBooks(G, ctx, pz.submittedBy, pz.payload as ZkClaimBooksPayload);
  }

  G.pendingZk = null;
  return G;
}

export function submitDecryptionShare(
  G: CryptoGoFishState,
  ctx: Ctx,
  zoneId: string,
  cardIndex: number,
  playerId: string,
  privateKey: string,
): CryptoGoFishState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (G.securityMode !== "coop-reveal") return INVALID_MOVE;

  const key = `${zoneId}:${cardIndex}`;
  if (G.awaitingGoFishDrawCardKey && G.awaitingGoFishDrawCardKey !== key) {
    return INVALID_MOVE;
  }

  if (
    G.pendingReveal &&
    key !== G.awaitingGoFishDrawCardKey &&
    (G.pendingReveal.zoneId !== zoneId ||
      !G.pendingReveal.indices.includes(cardIndex))
  ) {
    return INVALID_MOVE;
  }

  const zone = G.crypto.encryptedZones[zoneId];
  if (!zone) return INVALID_MOVE;
  if (cardIndex < 0 || cardIndex >= zone.length) return INVALID_MOVE;

  const card = zone[cardIndex];
  if (!card || card.layers <= 0) return INVALID_MOVE;

  if (!G.crypto.pendingReveals[key]) G.crypto.pendingReveals[key] = {};
  if (G.crypto.pendingReveals[key][playerId]) return INVALID_MOVE;

  let decrypted: EncryptedCard;
  try {
    decrypted = decrypt(card, privateKey);
  } catch {
    return INVALID_MOVE;
  }

  zone[cardIndex] = decrypted;
  G.crypto.pendingReveals[key][playerId] = decrypted.ciphertext;

  if (decrypted.layers === 0) {
    const cardId = lookupCardIdFromPoint(
      G.crypto.cardPointLookup,
      decrypted.ciphertext,
    );
    if (cardId) {
      G.crypto.revealedCards[key] = cardId;
      pushLog(G, ctx, `Card revealed: ${cardId}.`);
    }
  }

  pushLog(G, ctx, `Player ${playerId} submitted a decryption share.`);
  maybeResolveForcedGoFishDraw(G, ctx);
  return G;
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

export const CryptoGoFishGame: Game<CryptoGoFishState> = {
  name: "crypto-gofish",

  setup: (ctx): CryptoGoFishState => {
    const numPlayers = (ctx.numPlayers as number) ?? 2;
    const playerIDs =
      (ctx.playOrder as string[]) ??
      Array.from({ length: numPlayers }, (_, i) => String(i));
    return createCryptoGoFishState({ numPlayers, playerIDs });
  },

  turn: {
    order: {
      first: () => 0,
      next: ({ G }) => {
        if (
          ["keyExchange", "keyEscrow", "encrypt", "shuffle"].includes(G.phase)
        ) {
          return G.setupPlayerIndex % G.playerOrder.length;
        }
        const idx = G.playerOrder.indexOf(G.turnPlayer);
        return idx >= 0 ? idx : 0;
      },
    },
  },

  phases: {
    setup: {
      start: true,
      moves: {
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
          client: false,
        },
        submitZkSigPublicKey: {
          move: ({ G, ctx, playerID }, playerId: string, zkSigPublicKey: string) =>
            submitZkSigPublicKey(G, ctx, playerId, zkSigPublicKey, playerID),
          client: false,
        },
        distributeKeyShares: {
          move: (
            { G, ctx },
            playerId: string,
            privateKey: string,
            shares: KeyShare[],
          ) => distributeKeyShares(G, ctx, playerId, privateKey, shares),
          client: false,
        },
        encryptDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            encryptDeck(G, ctx, playerId, privateKey),
          client: false,
        },
        commitShuffleSeed: {
          move: ({ G, ctx, playerID }, playerId: string, commitHashHex: string) =>
            commitShuffleSeed(G, ctx, playerId, commitHashHex, playerID),
          client: false,
        },
        revealShuffleSeed: {
          move: ({ G, ctx, playerID }, playerId: string, seedHex: string) =>
            revealShuffleSeed(G, ctx, playerId, seedHex, playerID),
          client: false,
        },
        shuffleDeck: {
          move: ({ G, ctx, events }, playerId: string, privateKey: string) =>
            shuffleDeck(G, ctx, playerId, privateKey, events),
          client: false,
        },
        voteAbortShuffle: {
          move: ({ G, ctx, playerID }, playerId: string) =>
            voteAbortShuffle(G, ctx, playerId, playerID),
          client: false,
        },
      },
      next: "play",
      endIf: ({ G }) => G.phase === "play",
    },

    play: {
      turn: {
        activePlayers: { all: "play" },
      },
      moves: {
        // Setup moves (resume / debug)
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
          client: false,
        },
        submitZkSigPublicKey: {
          move: ({ G, ctx, playerID }, playerId: string, zkSigPublicKey: string) =>
            submitZkSigPublicKey(G, ctx, playerId, zkSigPublicKey, playerID),
          client: false,
        },
        distributeKeyShares: {
          move: (
            { G, ctx },
            playerId: string,
            privateKey: string,
            shares: KeyShare[],
          ) => distributeKeyShares(G, ctx, playerId, privateKey, shares),
          client: false,
        },
        encryptDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            encryptDeck(G, ctx, playerId, privateKey),
          client: false,
        },
        commitShuffleSeed: {
          move: ({ G, ctx, playerID }, playerId: string, commitHashHex: string) =>
            commitShuffleSeed(G, ctx, playerId, commitHashHex, playerID),
          client: false,
        },
        revealShuffleSeed: {
          move: ({ G, ctx, playerID }, playerId: string, seedHex: string) =>
            revealShuffleSeed(G, ctx, playerId, seedHex, playerID),
          client: false,
        },
        shuffleDeck: {
          move: ({ G, ctx, events }, playerId: string, privateKey: string) =>
            shuffleDeck(G, ctx, playerId, privateKey, events),
          client: false,
        },

        voteAbortShuffle: {
          move: ({ G, ctx, playerID }, playerId: string) =>
            voteAbortShuffle(G, ctx, playerId, playerID),
          client: false,
        },

        // Gameplay
        peekHand: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            peekHand(G, ctx, playerId, privateKey),
          client: false,
        },
        askRank: {
          move: ({ G, ctx }, asker: string, target: string, rank: GoFishRank) =>
            askRank(G, ctx, asker, target, rank),
          client: false,
        },
        respondToAsk: {
          move: ({ G, ctx }, target: string) => respondToAsk(G, ctx, target),
          client: false,
        },
        goFish: {
          move: ({ G, ctx }, playerId: string) => goFish(G, ctx, playerId),
          client: false,
        },
        claimBooks: {
          move: ({ G, ctx }, playerId: string) => claimBooks(G, ctx, playerId),
          client: false,
        },
        submitZkProofRespondToAsk: {
          move: (
            { G, ctx, playerID },
            target: string,
            envelope: ZkProofEnvelope,
            payload: ZkRespondToAskPayload,
          ) =>
            submitZkProofRespondToAsk(
              G,
              ctx,
              target,
              envelope,
              payload,
              playerID,
            ),
          client: false,
        },
        submitZkProofClaimBooks: {
          move: (
            { G, ctx, playerID },
            playerId: string,
            envelope: ZkProofEnvelope,
            payload: ZkClaimBooksPayload,
          ) =>
            submitZkProofClaimBooks(G, ctx, playerId, envelope, payload, playerID),
          client: false,
        },
        submitZkVerdict: {
          move: (
            { G, ctx, playerID },
            verifier: string,
            verdict: ZkVerdict,
            signatureHex: string,
          ) => submitZkVerdict(G, ctx, verifier, verdict, signatureHex, playerID),
          client: false,
        },
        submitDecryptionShare: {
          move: (
            { G, ctx },
            zoneId: string,
            cardIndex: number,
            playerId: string,
            privateKey: string,
          ) =>
            submitDecryptionShare(
              G,
              ctx,
              zoneId,
              cardIndex,
              playerId,
              privateKey,
            ),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === "voided") return { draw: true, reason: "voided" };
    if (G.phase === "gameOver") return { winners: G.winners };
    return undefined;
  },
};

export const CryptoGoFishSecureGame: Game<CryptoGoFishState> = {
  ...CryptoGoFishGame,
  name: "crypto-gofish-secure",
  setup: (ctx): CryptoGoFishState => {
    const numPlayers = (ctx.numPlayers as number) ?? 2;
    const playerIDs =
      (ctx.playOrder as string[]) ??
      Array.from({ length: numPlayers }, (_, i) => String(i));
    const state = createCryptoGoFishState({ numPlayers, playerIDs });
    state.securityMode = "coop-reveal";
    // In secure mode, do not rely on demo-private key storage.
    delete (state.crypto as any).privateKeys;
    return state;
  },
};

export const CryptoGoFishZkAttestGame: Game<CryptoGoFishState> = {
  ...CryptoGoFishGame,
  name: "crypto-gofish-zk-attest",
  setup: (ctx): CryptoGoFishState => {
    const numPlayers = (ctx.numPlayers as number) ?? 2;
    const playerIDs =
      (ctx.playOrder as string[]) ??
      Array.from({ length: numPlayers }, (_, i) => String(i));
    const state = createCryptoGoFishState({ numPlayers, playerIDs });
    state.securityMode = "zk-attest";
    // In ZK mode, do not rely on demo-private key storage.
    delete (state.crypto as any).privateKeys;
    return state;
  },
};
