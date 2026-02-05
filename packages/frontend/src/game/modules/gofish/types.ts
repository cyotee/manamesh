/**
 * Go Fish (Crypto) Types
 *
 * Minimal Go Fish state for demo-private mental poker.
 * Cards remain encrypted in shared state; owners can "peek" by decrypting
 * using demo-stored private keys (NOT secure; mirrors CryptoPoker demo mode).
 */

import type { ZoneDefinition } from "../types";

export type GoFishSuit = "hearts" | "diamonds" | "clubs" | "spades";
export type GoFishRank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

export interface GoFishCard {
  id: string;
  name: string;
  suit: GoFishSuit;
  rank: GoFishRank;
}

export interface CryptoGoFishPlayerState {
  publicKey: string | null;
  /** secp256k1 compressed public key hex for signing ZK verdicts (no 0x). */
  zkSigPublicKey: string | null;
  hasDistributedShares: boolean;
  hasEncrypted: boolean;
  hasShuffled: boolean;
  hasPeeked: boolean;
  peekedCards: GoFishCard[];
  books: number;
}

export type CryptoGoFishPhase =
  | "keyExchange"
  | "keyEscrow"
  | "encrypt"
  | "shuffle"
  | "play"
  | "gameOver"
  | "voided";

export interface PendingAsk {
  asker: string;
  target: string;
  rank: GoFishRank;
  status: "pending" | "resolved";
  timestamp: number;
}

export interface PendingReveal {
  purpose: "respondToAsk" | "claimBooks";
  zoneId: string;
  indices: number[];
  initiatedBy: string;
  timestamp: number;
}

export type ZkProofPurpose = "respondToAsk" | "claimBooks";
export type ZkVerdict = "valid" | "invalid";

/**
 * Proof envelope (kept JSON-serializable for boardgame.io state sync).
 *
 * NOTE: This is scaffolding; verification is not yet performed in moves.
 */
export interface ZkProofEnvelope {
  vkeyId: string;
  publicSignals: string[];
  proof: unknown;
}

export interface ZkRespondToAskPayload {
  zoneId: string;
  giveIndices: number[];
}

export interface ZkClaimBooksPayload {
  zoneId: string;
  bookCount: number;
  removeIndices: number[];
}

export type ZkPayload = ZkRespondToAskPayload | ZkClaimBooksPayload;

export interface PendingZkCheck {
  id: string;
  purpose: ZkProofPurpose;
  submittedBy: string;
  envelope: ZkProofEnvelope;
  payload: ZkPayload;
  timestamp: number;
  /** Deterministic verifier role (defaults to playerOrder[0]). */
  verifier: string;
  /** SHA-256 hex of stableStringify({purpose,id,submittedBy,envelope,payload}). */
  payloadHash: string;
  /** Set by verifier once async verification is complete. */
  verdict: ZkVerdict | null;
  /** Compact signature hex (r||s), no 0x. */
  verdictSig: string | null;
}

export interface ShuffleRngState {
  phase: "commit" | "reveal" | "ready";
  commits: Record<string, string | null>;
  reveals: Record<string, string | null>;
  /** Final agreed seed once all reveals are present. */
  finalSeedHex: string | null;

  /** Deterministic liveness bookkeeping (boardgame.io ctx.numMoves). */
  startedAtMove: number | null;
  /** Updated whenever a shuffle-related move makes progress. */
  lastProgressMove: number | null;

  /** Players voting to abort a stalled shuffle. */
  abortVotes: Record<string, boolean>;
}

/**
 * Deterministic "stall window" for shuffle commit-reveal liveness.
 *
 * Measured in boardgame.io `ctx.numMoves` (not wall-clock time).
 */
export const GOFISH_SHUFFLE_STALL_WINDOW_MOVES = 12;

export interface CryptoGoFishState {
  players: Record<string, CryptoGoFishPlayerState>;
  phase: CryptoGoFishPhase;

  /** Demo-private stores keys in shared state; coop-reveal uses decryption shares. */
  securityMode: "demo-private" | "coop-reveal" | "zk-attest";

  crypto: import("../../../crypto/plugin/crypto-plugin").CryptoPluginState;
  cardIds: string[];

  playerOrder: string[];
  setupPlayerIndex: number;

  /** Player whose turn it is to ask / go fish */
  turnPlayer: string;

  /** If set, this player must draw (after a missed ask) before asking again. */
  awaitingGoFishFor: string | null;
  /** Rank that was asked for on the miss (used to decide if the drawer continues). */
  awaitingGoFishRank: GoFishRank | null;

  /** When set, the forced-draw card must be revealed before deciding if turn continues. */
  awaitingGoFishDrawCardKey: string | null;

  pendingAsk: PendingAsk | null;
  pendingReveal: PendingReveal | null;
  /** ZK flow: player submits proof; deterministic verifier signs verdict. */
  pendingZk: PendingZkCheck | null;

  /** Commit-reveal seed used to make shuffling deterministic. */
  shuffleRng: ShuffleRngState;
  winners: string[];

  /** Shared action log (latest first). */
  log: { timestamp: number; message: string }[];

  zones: Record<string, Record<string, GoFishCard[]>>;
}

export const GOFISH_ZONES: ZoneDefinition[] = [
  {
    id: "deck",
    name: "Deck",
    visibility: "hidden",
    shared: true,
    ordered: true,
    features: ["shuffle", "draw"],
  },
  {
    id: "hand",
    name: "Hand",
    visibility: "owner-only",
    shared: false,
    ordered: false,
    features: ["peek"],
  },
];
