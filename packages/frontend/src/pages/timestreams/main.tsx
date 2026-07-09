import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import {
  TimestreamsModule,
  TimestreamsBoard,
  loadPackCatalogFromHttp,
  DEFAULT_PACK_BASE_URL,
} from "@manamesh/timestreams";
import type { PackCatalog, PackCatalogLoadResult } from "@manamesh/timestreams";
import { TimestreamsLobby } from "./TimestreamsLobby";
import { P2PMultiplayer } from "../../p2p/transport";
import type { JoinCodeConnection } from "../../p2p/transport";

/**
 * Keep window scroll where the *user* left it.
 *
 * Important: do NOT trust every `scroll` event — browsers also fire scroll when
 * they re-focus a checkbox/input near the top (Rules toggle). Only record
 * positions from real user gestures (wheel / touch / keys); after re-renders,
 * snap back if something programmatically moved the viewport.
 */
function PreserveWindowScroll({ children }: { children: React.ReactNode }) {
  const yRef = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  /** Timestamp through which scroll events count as user-driven (incl. momentum). */
  const userGestureUntilRef = useRef(0);

  useEffect(() => {
    const markUserGesture = () => {
      userGestureUntilRef.current = performance.now() + 400;
    };
    const onScroll = () => {
      const now = performance.now();
      if (now <= userGestureUntilRef.current) {
        yRef.current = window.scrollY;
        // Extend window while momentum continues without new wheel events.
        userGestureUntilRef.current = now + 400;
      }
    };

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("wheel", markUserGesture, opts);
    window.addEventListener("touchstart", markUserGesture, opts);
    window.addEventListener("touchmove", markUserGesture, opts);
    window.addEventListener("keydown", (e) => {
      // Only navigation keys that scroll the page.
      if (
        e.key === " " ||
        e.key === "PageDown" ||
        e.key === "PageUp" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp"
      ) {
        markUserGesture();
      }
    }, opts);
    window.addEventListener("scroll", onScroll, { passive: true });

    yRef.current = window.scrollY;
    return () => {
      window.removeEventListener("wheel", markUserGesture, opts);
      window.removeEventListener("touchstart", markUserGesture, opts);
      window.removeEventListener("touchmove", markUserGesture, opts);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    // Defocus rules-toggle controls so the browser cannot keep scrolling them into view.
    const ae = document.activeElement as HTMLElement | null;
    if (ae?.closest?.('[data-testid="rules-midgame-toggle"]')) {
      ae.blur();
    }
    if (Math.abs(window.scrollY - yRef.current) > 0.5) {
      window.scrollTo(0, yRef.current);
    }
  });

  return <>{children}</>;
}

// Catch render crashes so we never get a blank page.
class ErrorBoundary extends React.Component<
  { fallback?: React.ReactNode; children: React.ReactNode },
  { hasError: boolean; err?: unknown }
> {
  constructor(props: { fallback?: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, err: error };
  }
  componentDidCatch(error: unknown, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{ padding: 20, color: "#f87171" }}>
            Something went wrong rendering this part.
            <br />
            {String(this.state.err)}
          </div>
        )
      );
    }
    return this.props.children;
  }
}

console.log("[ManaMesh] timestreams page boot");

type AppPhase = "menu" | "lobby" | "game" | "local-dual";

interface GameStartParams {
  connection: JoinCodeConnection | null;
  role: "host" | "guest";
  playerID: string;
  matchID: string;
  numPlayers: number;
  homeEraAssignment: "selectable" | "random";
  playMode?: "plaintext" | "mental-poker";
  rulesEnabled?: boolean;
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    "<div style='color:red;padding:20px;font-family:sans-serif'>ERROR: #root not found.</div>";
  throw new Error("[ManaMesh] Missing #root element");
}
const root = ReactDOM.createRoot(rootEl);

const gameDef = TimestreamsModule.getBoardgameIOGame();

/** Wrap game so Local/P2P clients get fixed moduleConfig + pack catalog. */
function gameWithExtras(extras: {
  moduleConfig?: {
    homeEraAssignment?: "selectable" | "random";
    playMode?: "plaintext" | "mental-poker";
    rulesEnabled?: boolean;
  };
  packCatalog?: PackCatalog | null;
  packName?: string;
}) {
  return {
    ...gameDef,
    setup: (arg: unknown, setupData?: Record<string, unknown>) => {
      const setup = gameDef.setup as
        | ((a: unknown, d?: unknown) => unknown)
        | undefined;
      if (!setup) return {};
      return setup(arg, {
        ...setupData,
        moduleConfig: {
          ...extras.moduleConfig,
          ...(setupData?.moduleConfig as object | undefined),
        },
        packCatalog: extras.packCatalog ?? (setupData as any)?.packCatalog,
        packName: extras.packName ?? (setupData as any)?.packName,
      });
    },
  };
}

function TimestreamsApp() {
  const [phase, setPhase] = useState<AppPhase>("menu");
  const [gameParams, setGameParams] = useState<GameStartParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lobbyRole, setLobbyRole] = useState<"host" | "guest">("host");
  // Menu-level default for local dual + lobby initial value.
  const [rulesEnabled, setRulesEnabled] = useState(true);
  const [useAssetPack, setUseAssetPack] = useState(true);
  const [packInfo, setPackInfo] = useState<PackCatalogLoadResult | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  /**
   * Snapshot of config for a dual-seat session. Created once when entering
   * local-dual so Client does not remount when menu pack/rules state updates.
   */
  const [localDualSession, setLocalDualSession] = useState<{
    matchID: string;
    rulesEnabled: boolean;
    packCatalog: PackCatalog | null;
    packName?: string;
  } | null>(null);

  // Auto-load scanned pack from Vite-served /timestreams-pack/
  useEffect(() => {
    if (!useAssetPack) {
      setPackInfo(null);
      setPackError(null);
      return;
    }
    let cancelled = false;
    setPackLoading(true);
    setPackError(null);
    loadPackCatalogFromHttp(DEFAULT_PACK_BASE_URL)
      .then((result) => {
        if (!cancelled) {
          setPackInfo(result);
          console.log(
            "[TimestreamsApp] Pack loaded:",
            result.packName,
            result.availableEras,
            result.cardCount,
            "cards",
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setPackError(msg);
          setPackInfo(null);
          console.error("[TimestreamsApp] Pack load failed:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setPackLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [useAssetPack]);

  const packExtras = useMemo(
    () =>
      useAssetPack && packInfo
        ? { packCatalog: packInfo.catalog, packName: packInfo.packName }
        : { packCatalog: null as PackCatalog | null, packName: undefined as string | undefined },
    [useAssetPack, packInfo],
  );

  const handleGameStart = useCallback((params: GameStartParams) => {
    console.log("[TimestreamsApp] Game starting:", params);
    setGameParams(params);
    setPhase("game");
  }, []);

  const handleLobbyError = useCallback((err: Error) => {
    console.error("[TimestreamsApp] Lobby error:", err);
    setError(err.message);
  }, []);

  const handleBack = useCallback(() => {
    setGameParams(null);
    setError(null);
    setLocalDualSession(null);
    setPhase("menu");
  }, []);

  // Shared Local() master for dual-seat mode (must be stable across both clients).
  const localMultiplayer = useMemo(() => Local(), []);

  // One Client factory for both seats — only recreate when the dual session starts.
  const LocalDualClient = useMemo(() => {
    if (!localDualSession) return null;
    const game = gameWithExtras({
      moduleConfig: {
        homeEraAssignment: "selectable",
        playMode: "mental-poker",
        rulesEnabled: localDualSession.rulesEnabled,
      },
      packCatalog: localDualSession.packCatalog,
      packName: localDualSession.packName,
    });
    return Client({
      game,
      board: TimestreamsBoard,
      multiplayer: localMultiplayer,
      numPlayers: 2,
      debug: false,
    });
  }, [localDualSession, localMultiplayer]);

  // P2P client factory — recreated when gameParams change.
  const P2PClient = useMemo(() => {
    if (!gameParams?.connection) return null;
    const moduleConfig = {
      homeEraAssignment: gameParams.homeEraAssignment,
      playMode: gameParams.playMode ?? "mental-poker",
      rulesEnabled: gameParams.rulesEnabled ?? true,
    };
    const setupData = {
      moduleConfig,
      packCatalog: packExtras.packCatalog,
      packName: packExtras.packName,
    };
    const game = gameWithExtras({ moduleConfig, ...packExtras });
    return Client({
      game,
      board: TimestreamsBoard,
      multiplayer: P2PMultiplayer({
        connection: gameParams.connection,
        role: gameParams.role,
        matchID: gameParams.matchID,
        playerID: gameParams.playerID,
        numPlayers: gameParams.numPlayers,
        setupData,
      }),
      numPlayers: gameParams.numPlayers,
      debug: false,
    });
  }, [gameParams, packExtras]);

  // ---- Menu ----
  if (phase === "menu") {
    return (
      <div
        style={{
          padding: 20,
          maxWidth: 640,
          margin: "40px auto",
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "system-ui",
        }}
      >
        <h1>Timestreams</h1>
        <p>
          Serverless P2P card game. Host creates an invite code; guest pastes it,
          returns an answer code; both play over a direct WebRTC link (no game server).
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button
            data-testid="open-host-lobby"
            onClick={() => {
              setLobbyRole("host");
              setPhase("lobby");
            }}
            style={{ padding: "10px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: 6 }}
          >
            Host P2P Game
          </button>
          <button
            data-testid="open-guest-lobby"
            onClick={() => {
              setLobbyRole("guest");
              setPhase("lobby");
            }}
            style={{ padding: "10px 16px", background: "#0d9488", color: "white", border: "none", borderRadius: 6 }}
          >
            Join as Guest
          </button>
          <button
            data-testid="local-dual"
            onClick={() => {
              // Freeze pack/rules for this session so later pack reloads / menu
              // toggles do not remount the Client (which resets scroll + state).
              setLocalDualSession({
                matchID: "local_dual_" + Date.now(),
                rulesEnabled,
                packCatalog: packExtras.packCatalog,
                packName: packExtras.packName,
              });
              setPhase("local-dual");
            }}
            style={{ padding: "10px 16px", background: "#334155", color: "white", border: "none", borderRadius: 6 }}
          >
            Local 2-Seat (same browser)
          </button>
        </div>

        <label
          data-testid="menu-asset-pack-toggle"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 20,
            padding: 12,
            background: useAssetPack ? "#14532d" : "#1e2937",
            border: useAssetPack ? "1px solid #22c55e" : "1px solid #334155",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: "0.9em",
          }}
        >
          <input
            type="checkbox"
            checked={useAssetPack}
            onChange={(e) => setUseAssetPack(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Asset pack</strong>
            {packLoading
              ? " (loading…)"
              : packInfo
                ? ` — ${packInfo.packName} v${packInfo.packVersion} · ${packInfo.cardCount} cards · eras: ${packInfo.availableEras.join(", ")}`
                : packError
                  ? " (failed)"
                  : " (off)"}
            <br />
            <span style={{ color: "#94a3b8", fontSize: "0.85em" }}>
              Load scanned decks from{" "}
              <code style={{ color: "#cbd5e1" }}>{DEFAULT_PACK_BASE_URL}</code>. Claim Stone /
              Medieval / Modern / Future for real cards + art. Renaissance &amp; Industrial fall
              back to placeholders until those sets are in the pack.
            </span>
            {packError && (
              <span style={{ display: "block", color: "#f87171", marginTop: 4 }}>
                Pack error: {packError}
              </span>
            )}
          </span>
        </label>

        <label
          data-testid="menu-rules-toggle"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 12,
            padding: 12,
            background: rulesEnabled ? "#1e2937" : "#422006",
            border: rulesEnabled ? "1px solid #334155" : "1px solid #eab308",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: "0.9em",
          }}
        >
          <input
            type="checkbox"
            checked={rulesEnabled}
            onChange={(e) => setRulesEnabled(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Rules engine</strong>
            {rulesEnabled ? " (on)" : " (OFF — structural play only)"}
            <br />
            <span style={{ color: "#94a3b8", fontSize: "0.85em" }}>
              Applies to Local 2-Seat and as the default for Host lobby. Uncheck to test
              P2P/UI without play effects, gates, or triggers. Also toggleable mid-game on the board.
            </span>
          </span>
        </label>

        <p style={{ fontSize: "0.85em", opacity: 0.8, marginTop: 16 }}>
          For remote play with another person: open Host here, send the invite code (chat/email),
          they open Join as Guest, paste the invite, send the answer code back, you paste it — game starts.
          STUN only (Google); peers on hard symmetric NAT may need TURN later.
        </p>
        {error && <p style={{ color: "#f87171" }}>Note: {error}</p>}
      </div>
    );
  }

  // ---- Lobby (P2P join-code exchange) ----
  if (phase === "lobby") {
    return (
      <ErrorBoundary
        fallback={
          <div style={{ padding: 20, color: "#f87171" }}>
            Lobby failed to render.{" "}
            <button onClick={handleBack}>Back</button>
          </div>
        }
      >
        <div style={{ marginBottom: 8, padding: "8px 20px" }}>
          <button onClick={handleBack} style={{ fontSize: 12 }}>
            ← Menu
          </button>
        </div>
        <TimestreamsLobby
          displayName={getPlayerName()}
          isHost={lobbyRole === "host"}
          rulesEnabled={rulesEnabled}
          game={gameDef}
          onGameStart={handleGameStart}
          onError={handleLobbyError}
        />
      </ErrorBoundary>
    );
  }

  // ---- Local dual-seat (same browser, real rules engine, no network) ----
  if (phase === "local-dual") {
    if (!LocalDualClient || !localDualSession) {
      return (
        <div style={{ padding: 20, color: "white" }}>
          <p>Starting local dual-seat…</p>
          <button onClick={handleBack}>Back</button>
        </div>
      );
    }
    const Dual = LocalDualClient;
    return (
      <PreserveWindowScroll>
        <div style={{ background: "#0f172a", minHeight: "100vh", overflowAnchor: "none" }}>
          <div style={{ padding: "8px 12px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={handleBack}>← Menu</button>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>
              Local dual-seat — both players in one browser (shared Local master). Use this to
              exercise rules without WebRTC; use Host/Guest for real remote P2P.
            </span>
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 4,
                background: localDualSession.rulesEnabled ? "#14532d" : "#78350f",
                color: "#fef3c7",
              }}
            >
              Rules start: {localDualSession.rulesEnabled ? "ON" : "OFF"} (mid-game toggle is on each board)
            </span>
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 4,
                background: localDualSession.packCatalog ? "#14532d" : "#334155",
                color: "#e2e8f0",
              }}
            >
              Pack: {localDualSession.packName || "off"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8 }}>
            <div style={{ border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "#1e3a5f", padding: "4px 8px", fontSize: 12, color: "#e2e8f0" }}>
                Player 0
              </div>
              <Dual playerID="0" matchID={localDualSession.matchID} />
            </div>
            <div style={{ border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "#134e4a", padding: "4px 8px", fontSize: 12, color: "#e2e8f0" }}>
                Player 1
              </div>
              <Dual playerID="1" matchID={localDualSession.matchID} />
            </div>
          </div>
        </div>
      </PreserveWindowScroll>
    );
  }

  // ---- Connected P2P game ----
  if (!gameParams || !P2PClient) {
    return (
      <div style={{ padding: 20, color: "white" }}>
        <p>Error: No game parameters / connection</p>
        <button onClick={handleBack}>Back</button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <PreserveWindowScroll>
        <div style={{ background: "#0f172a", minHeight: "100vh", overflowAnchor: "none" }}>
          <div style={{ padding: "4px 12px", background: "#1e2937", color: "#94a3b8", fontSize: 12 }}>
            P2P {gameParams.role} · match {gameParams.matchID} · you are P{gameParams.playerID}
            <button onClick={handleBack} style={{ marginLeft: 12, fontSize: 11 }}>
              Leave
            </button>
          </div>
          <P2PClient
            playerID={gameParams.playerID}
            matchID={gameParams.matchID}
          />
        </div>
      </PreserveWindowScroll>
    </ErrorBoundary>
  );
}

function getPlayerName(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("manamesh_player_name");
    if (stored) return stored;
  }
  return `Player_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

try {
  root.render(
    <React.StrictMode>
      <TimestreamsApp />
    </React.StrictMode>,
  );
} catch (err) {
  console.error("[ManaMesh] Render failed:", err);
  rootEl.innerHTML = `<div style="color:#f87171;padding:20px;font-family:sans-serif;background:#1e2937">Failed to start app: ${String(err)}</div>`;
}
