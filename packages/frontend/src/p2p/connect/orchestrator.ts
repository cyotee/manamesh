/**
 * Connection orchestrator: try Trystero Quick connect, fall back to join-code
 * signal for non-auth failures. Password / handshake rejects do not fall open.
 */

import type { P2PChannel } from "@cyotee/boardgameio-p2p/channel";
import type { TrysteroTableSession } from "@cyotee/boardgameio-p2p/trystero";
import {
  generateRoomCode,
  isValidRoomCode,
  joinTrysteroTable,
  normalizeRoomCode,
} from "@cyotee/boardgameio-p2p/trystero";
import {
  getP2PBackendMode,
  getTrysteroAppId,
  getTrysteroConnectTimeoutMs,
  getTurnConfig,
  matchIdFromRoomCode,
  type P2PBackendMode,
} from "./config";

export type ConnectMode = "auto" | "trystero" | "joinCode";

export type OrchestratorGameId =
  | "timestreams"
  | "poker"
  | "onepiece"
  | "merkle-battleship";

export type QuickConnectRequest = {
  gameId: OrchestratorGameId;
  role: "host" | "guest";
  /** Guest must supply; host may omit to generate */
  roomCode?: string;
  password?: string;
  maxPlayers: number;
  /** Force mode; default from env */
  mode?: ConnectMode;
  matchID?: string;
  /** Injectable for tests */
  joinTable?: typeof joinTrysteroTable;
};

export type QuickConnectSuccess = {
  backend: "trystero";
  session: TrysteroTableSession;
  roomCode: string;
  matchID: string;
  playerID: string;
  connection?: P2PChannel;
  hostConnections?: Map<string, P2PChannel>;
};

export type QuickConnectFallback = {
  backend: "fallback-joinCode";
  reason: string;
  roomCode: string;
  matchID: string;
};

export type QuickConnectResult = QuickConnectSuccess | QuickConnectFallback;

export class PasswordAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordAuthError";
  }
}

/**
 * Attempt Trystero table join. On timeout/relay failure returns fallback signal.
 * On password/handshake auth failure throws {@link PasswordAuthError} (no fallback).
 */
export async function tryQuickConnect(
  req: QuickConnectRequest,
): Promise<QuickConnectResult> {
  const mode: ConnectMode = req.mode ?? getP2PBackendMode();
  const roomCode = normalizeRoomCode(
    req.roomCode || (req.role === "host" ? generateRoomCode(7) : ""),
  );

  if (mode === "joinCode") {
    return {
      backend: "fallback-joinCode",
      reason: "joinCode_only_mode",
      roomCode: roomCode || "",
      matchID: req.matchID || matchIdFromRoomCode(req.gameId.slice(0, 2), roomCode || "x"),
    };
  }

  if (!isValidRoomCode(roomCode)) {
    throw new Error("invalid_room_code");
  }

  const matchID =
    req.matchID || matchIdFromRoomCode(prefixFor(req.gameId), roomCode);
  const joinTable = req.joinTable ?? joinTrysteroTable;

  try {
    const session = await joinTable({
      appId: getTrysteroAppId(),
      roomCode,
      password: req.password || undefined,
      role: req.role,
      gameId: req.gameId,
      matchID,
      maxPlayers: req.maxPlayers,
      turnConfig: getTurnConfig(),
      connectTimeoutMs: getTrysteroConnectTimeoutMs(),
    });

    return {
      backend: "trystero",
      session,
      roomCode,
      matchID,
      playerID: session.playerID,
      connection: session.connection,
      hostConnections: session.hostConnections,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Auth / password / handshake rejects — do not fall open
    if (
      msg.includes("password") ||
      msg.includes("handshake_reject") ||
      msg.includes("trystero_join_error") ||
      msg.includes("wrong password") ||
      msg.includes("second_host") ||
      msg.includes("table_full") ||
      msg.includes("game_id")
    ) {
      throw new PasswordAuthError(msg);
    }

    // Timeout / relay / generic — allow join-code fallback when mode is auto
    if (mode === "trystero") {
      throw err instanceof Error ? err : new Error(msg);
    }

    try {
      // best-effort leave if session partially opened — joinTable already leaves on reject
    } catch {
      /* ignore */
    }

    return {
      backend: "fallback-joinCode",
      reason: msg || "trystero_failed",
      roomCode,
      matchID,
    };
  }
}

function prefixFor(gameId: OrchestratorGameId): string {
  switch (gameId) {
    case "timestreams":
      return "ts";
    case "poker":
      return "pk";
    case "onepiece":
      return "op";
    case "merkle-battleship":
      return "mb";
    default:
      return "mm";
  }
}

export {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  getP2PBackendMode,
  type P2PBackendMode,
};
