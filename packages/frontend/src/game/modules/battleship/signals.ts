import type { MerkleProofStep } from "../../../crypto";

import type { CellBit, Coord } from "./types";
import { CELL_COUNT, GRID_SIZE } from "./types";
import { proofForIndex } from "./commitment";
import { coordToIndex } from "./logic";

type BattleshipSignalBase = {
  game: "battleship";
  matchID: string;
};

export type BattleshipGuessSignal = BattleshipSignalBase & {
  type: "bs_guess";
  fromPlayerId: string;
  coord: Coord;
};

export type BattleshipRevealSignal = BattleshipSignalBase & {
  type: "bs_reveal";
  toPlayerId: string;
  ownerId: string;
  coord: Coord;
  index: number;
  bit: 0 | 1;
  saltHex: string;
  proof: MerkleProofStep[];
};

export type BattleshipFullRevealSignal = BattleshipSignalBase & {
  type: "bs_full_reveal";
  toPlayerId: string;
  ownerId: string;
  boardBits: CellBit[];
  saltsHex: string[];
};

export type BattleshipAuditResultSignal = BattleshipSignalBase & {
  type: "bs_audit_result";
  toPlayerId: string;
  fromPlayerId: string;
  secureAndValid: boolean;
  details: {
    myRootMatches: boolean;
    myFleetLegal: boolean;
    myGuessMismatches: number;
    oppRootMatches: boolean;
    oppFleetLegal: boolean;
    oppGuessMismatches: number;
  };
};

export type BattleshipSignal =
  | BattleshipGuessSignal
  | BattleshipRevealSignal
  | BattleshipFullRevealSignal
  | BattleshipAuditResultSignal;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isCoord(v: unknown): v is Coord {
  return (
    isObject(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    Number.isInteger(v.x) &&
    Number.isInteger(v.y) &&
    v.x >= 0 &&
    v.x < GRID_SIZE &&
    v.y >= 0 &&
    v.y < GRID_SIZE
  );
}

export function isBattleshipSignal(raw: unknown): raw is BattleshipSignal {
  if (!isObject(raw)) return false;
  if (raw.game !== "battleship") return false;
  if (typeof raw.matchID !== "string") return false;
  if (typeof raw.type !== "string") return false;
  return true;
}

export type ApplyRevealAction = {
  coord: Coord;
  reveal: {
    gameId: string;
    ownerId: string;
    index: number;
    bit: 0 | 1;
    saltHex: string;
    proof: MerkleProofStep[];
  };
};

export type HandleBattleshipSignalResult = {
  outgoingSignals: BattleshipSignal[];
  applyRevealActions: ApplyRevealAction[];
  receivedFullReveal: {
    ownerId: string;
    boardBits: CellBit[];
    saltsHex: string[];
  } | null;
  receivedAuditResult: BattleshipAuditResultSignal | null;
};

export function handleBattleshipSignal(params: {
  raw: unknown;
  matchID: string;
  myId: string;
  opponentId: string | null;
  // Defender-side state (to answer guesses).
  boardBits: CellBit[] | null;
  saltsHex: string[] | null;
  haveMyCommitment: boolean;
}): HandleBattleshipSignalResult {
  const empty: HandleBattleshipSignalResult = {
    outgoingSignals: [],
    applyRevealActions: [],
    receivedFullReveal: null,
    receivedAuditResult: null,
  };

  if (!isBattleshipSignal(params.raw)) return empty;
  if ((params.raw as any).matchID !== params.matchID) return empty;

  const type = (params.raw as any).type;

  if (type === "bs_guess") {
    const s = params.raw as Partial<BattleshipGuessSignal>;
    if (typeof s.fromPlayerId !== "string") return empty;
    if (!isCoord(s.coord)) return empty;
    if (s.fromPlayerId === params.myId) return empty;

    const bits = params.boardBits;
    const salts = params.saltsHex;
    if (!params.opponentId) return empty;
    if (!bits || !salts) return empty;
    if (!params.haveMyCommitment) return empty;

    const idx = coordToIndex(s.coord);
    const bit = bits[idx];
    const saltHex = salts[idx];
    const proof = proofForIndex(params.matchID, params.myId, bits, salts, idx);

    const reveal: BattleshipRevealSignal = {
      game: "battleship",
      matchID: params.matchID,
      type: "bs_reveal",
      toPlayerId: s.fromPlayerId,
      ownerId: params.myId,
      coord: s.coord,
      index: idx,
      bit,
      saltHex,
      proof,
    };

    return {
      ...empty,
      outgoingSignals: [reveal],
    };
  }

  if (type === "bs_reveal") {
    const s = params.raw as Partial<BattleshipRevealSignal>;
    if (s.toPlayerId !== params.myId) return empty;
    if (!isCoord(s.coord)) return empty;
    if (typeof s.ownerId !== "string") return empty;
    if (typeof s.index !== "number") return empty;
    if (s.bit !== 0 && s.bit !== 1) return empty;
    if (typeof s.saltHex !== "string") return empty;
    if (!Array.isArray(s.proof)) return empty;

    return {
      ...empty,
      applyRevealActions: [
        {
          coord: s.coord,
          reveal: {
            gameId: params.matchID,
            ownerId: s.ownerId,
            index: s.index,
            bit: s.bit,
            saltHex: s.saltHex,
            proof: s.proof as MerkleProofStep[],
          },
        },
      ],
    };
  }

  if (type === "bs_full_reveal") {
    const s = params.raw as Partial<BattleshipFullRevealSignal>;
    if (s.toPlayerId !== params.myId) return empty;
    if (typeof s.ownerId !== "string") return empty;
    if (!Array.isArray(s.boardBits) || s.boardBits.length !== CELL_COUNT)
      return empty;
    if (!Array.isArray(s.saltsHex) || s.saltsHex.length !== CELL_COUNT)
      return empty;

    return {
      ...empty,
      receivedFullReveal: {
        ownerId: s.ownerId,
        boardBits: s.boardBits as CellBit[],
        saltsHex: s.saltsHex as string[],
      },
    };
  }

  if (type === "bs_audit_result") {
    const s = params.raw as Partial<BattleshipAuditResultSignal>;
    if (s.toPlayerId !== params.myId) return empty;
    if (typeof s.fromPlayerId !== "string") return empty;
    if (typeof s.secureAndValid !== "boolean") return empty;
    if (!isObject(s.details)) return empty;

    return {
      ...empty,
      receivedAuditResult: s as BattleshipAuditResultSignal,
    };
  }

  return empty;
}
