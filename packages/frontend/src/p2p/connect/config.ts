/**
 * Vite env → connect / Trystero options for ManaMesh lobbies.
 */

export type P2PBackendMode = "auto" | "trystero" | "joinCode";

function env(key: string): string | undefined {
  try {
    // Vite injects import.meta.env
    const v = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[
      key
    ];
    return typeof v === "string" && v.length ? v : undefined;
  } catch {
    return undefined;
  }
}

export function getP2PBackendMode(): P2PBackendMode {
  const raw = (env("VITE_P2P_BACKEND") || "auto").toLowerCase();
  if (raw === "trystero" || raw === "joincode" || raw === "joinCode") {
    return raw === "trystero" ? "trystero" : "joinCode";
  }
  if (raw === "join-code") return "joinCode";
  return "auto";
}

export function getTrysteroAppId(): string {
  return env("VITE_TRYSTERO_APP_ID") || "manamesh-v1";
}

export function getTrysteroConnectTimeoutMs(): number {
  const n = Number(env("VITE_TRYSTERO_CONNECT_TIMEOUT_MS") || "12000");
  return Number.isFinite(n) && n > 0 ? n : 12_000;
}

export function getTimestreamsMaxPlayers(): number {
  const n = Number(env("VITE_TIMESTREAMS_MAX_PLAYERS") || "4");
  if (n === 6) return 6;
  return 4;
}

export function getPokerMaxPlayers(): number {
  const n = Number(env("VITE_POKER_MAX_PLAYERS") || "6");
  return Math.min(6, Math.max(2, Number.isFinite(n) ? n : 6));
}

/** Optional TURN for WebRTC (shared by join-code and Trystero). */
export function getTurnConfig(): RTCIceServer[] | undefined {
  const urls = env("VITE_TURN_URLS");
  if (!urls) return undefined;
  const username = env("VITE_TURN_USERNAME");
  const credential = env("VITE_TURN_CREDENTIAL");
  const server: RTCIceServer = {
    urls: urls.split(",").map((s) => s.trim()).filter(Boolean),
  };
  if (username) server.username = username;
  if (credential) server.credential = credential;
  return [server];
}

export function matchIdFromRoomCode(gamePrefix: string, roomCode: string): string {
  const clean = roomCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  return `${gamePrefix}_${clean}`;
}
