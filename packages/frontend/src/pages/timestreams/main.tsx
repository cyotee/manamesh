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
import {
  P2PMultiplayer,
  saveTimestreamsSession,
  loadTimestreamsSession,
  clearTimestreamsSession,
  type TimestreamsP2PSession,
} from "../../p2p/transport";
import type { JoinCodeConnection } from "../../p2p/transport";

/**
 * Keep window scroll where the *user* left it across boardgame.io re-renders.
 *
 * Browsers also fire `scroll` when they re-focus a mid-page control (rules toggle)
 * or when layout reflows (era border 1px→3px). We:
 *  1) Treat wheel / touch / keys / pointer (incl. scrollbar drag) as user gestures
 *  2) Record scrollY during those gestures (+ short momentum window)
 *  3) After React commits, snap back if something programmatically moved us
 *  4) Blur the fixed rules toggle so focus never steals the viewport
 */
function PreserveWindowScroll({ children }: { children: React.ReactNode }) {
  const yRef = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  /** Timestamp through which scroll events count as user-driven (incl. momentum). */
  const userGestureUntilRef = useRef(0);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const markUserGesture = (ms = 500) => {
      userGestureUntilRef.current = performance.now() + ms;
    };
    const onScroll = () => {
      const now = performance.now();
      // While pointer is held (scrollbar drag) always treat scroll as user-driven.
      if (pointerDownRef.current || now <= userGestureUntilRef.current) {
        yRef.current = window.scrollY;
        userGestureUntilRef.current = now + 500;
      }
    };
    const onPointerDown = () => {
      pointerDownRef.current = true;
      markUserGesture(800);
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      markUserGesture(400);
    };

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    const onWheel = () => markUserGesture(500);
    const onTouchStart = () => markUserGesture(800);
    const onTouchMove = () => markUserGesture(500);
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === " " ||
        e.key === "PageDown" ||
        e.key === "PageUp" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp"
      ) {
        markUserGesture(500);
      }
    };
    window.addEventListener("wheel", onWheel, opts);
    window.addEventListener("touchstart", onTouchStart, opts);
    window.addEventListener("touchmove", onTouchMove, opts);
    window.addEventListener("pointerdown", onPointerDown, opts);
    window.addEventListener("pointerup", onPointerUp, opts);
    window.addEventListener("pointercancel", onPointerUp, opts);
    window.addEventListener("mousedown", onPointerDown, opts);
    window.addEventListener("mouseup", onPointerUp, opts);
    window.addEventListener("keydown", onKeyDown, opts);
    window.addEventListener("scroll", onScroll, { passive: true });

    // Avoid browser scroll anchoring yanking the page when banners reflow.
    try {
      document.documentElement.style.overflowAnchor = "none";
      document.body.style.overflowAnchor = "none";
    } catch {
      /* ignore */
    }

    yRef.current = window.scrollY;
    return () => {
      window.removeEventListener("wheel", onWheel, opts);
      window.removeEventListener("touchstart", onTouchStart, opts);
      window.removeEventListener("touchmove", onTouchMove, opts);
      window.removeEventListener("pointerdown", onPointerDown, opts);
      window.removeEventListener("pointerup", onPointerUp, opts);
      window.removeEventListener("pointercancel", onPointerUp, opts);
      window.removeEventListener("mousedown", onPointerDown, opts);
      window.removeEventListener("mouseup", onPointerUp, opts);
      window.removeEventListener("keydown", onKeyDown, opts);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const ae = document.activeElement as HTMLElement | null;
    if (
      ae?.closest?.('[data-testid="rules-midgame-toggle"]') ||
      ae?.closest?.(".ts-era-column")
    ) {
      ae.blur();
    }
    if (Math.abs(window.scrollY - yRef.current) > 0.5) {
      window.scrollTo({ top: yRef.current, left: 0, behavior: "instant" as ScrollBehavior });
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
  /** Re-handshake after refresh: host restores G from localStorage for this match. */
  restoreFromPersist?: boolean;
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
  const [savedSession, setSavedSession] = useState<TimestreamsP2PSession | null>(
    () => (typeof window !== "undefined" ? loadTimestreamsSession() : null),
  );
  /** When set, next lobby start reuses this matchID and host restores board state. */
  const [resumeSession, setResumeSession] = useState<TimestreamsP2PSession | null>(
    null,
  );

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
    // Persist session so either peer can rejoin after refresh (re-handshake required).
    saveTimestreamsSession({
      matchID: params.matchID,
      playerID: params.playerID,
      role: params.role,
      homeEraAssignment: params.homeEraAssignment,
      rulesEnabled: params.rulesEnabled,
      playMode: params.playMode,
      stableSessionId: params.matchID,
      savedAt: Date.now(),
    });
    setSavedSession(loadTimestreamsSession());
    setResumeSession(null);
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
    setResumeSession(null);
    setSavedSession(loadTimestreamsSession());
    setPhase("menu");
  }, []);

  // Shared Local() master for dual-seat mode (must be stable across both clients).
  const localMultiplayer = useMemo(() => Local(), []);

  // One Client factory for both seats — only recreate when the dual session starts.
  // ?e2e=1 (or localStorage timestreams_e2e=1): plaintext + debugSeed for Playwright.
  const LocalDualClient = useMemo(() => {
    if (!localDualSession) return null;
    const e2e =
      typeof window !== "undefined" &&
      (new URLSearchParams(window.location.search).get("e2e") === "1" ||
        window.localStorage.getItem("timestreams_e2e") === "1");
    const game = gameWithExtras({
      moduleConfig: {
        homeEraAssignment: "selectable",
        playMode: e2e ? "plaintext" : "mental-poker",
        rulesEnabled: localDualSession.rulesEnabled,
        debugSeed: e2e,
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
        restoreFromPersist:
          gameParams.restoreFromPersist && gameParams.role === "host",
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
        {savedSession && (
          <div
            data-testid="resume-session-banner"
            style={{
              marginTop: 16,
              padding: 12,
              background: "#422006",
              border: "1px solid #eab308",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <strong>Resume last match?</strong>
            <div style={{ marginTop: 4, opacity: 0.9 }}>
              You were P{savedSession.playerID} ({savedSession.role}) · match{" "}
              <code style={{ fontSize: 11 }}>{savedSession.matchID}</code>
            </div>
            <p style={{ margin: "8px 0 0", opacity: 0.85, fontSize: 12 }}>
              Refresh drops the WebRTC link. Both players re-exchange join codes;
              the <strong>host</strong> restores the board from this browser’s
              saved state. Guest syncs after reconnect.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button
                data-testid="resume-as-host"
                onClick={() => {
                  setResumeSession(savedSession);
                  setLobbyRole("host");
                  setPhase("lobby");
                }}
                style={{
                  padding: "8px 12px",
                  background: "#ca8a04",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                }}
              >
                Resume as Host
              </button>
              <button
                data-testid="resume-as-guest"
                onClick={() => {
                  setResumeSession(savedSession);
                  setLobbyRole("guest");
                  setPhase("lobby");
                }}
                style={{
                  padding: "8px 12px",
                  background: "#0d9488",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                }}
              >
                Resume as Guest
              </button>
              <button
                data-testid="discard-session"
                onClick={() => {
                  clearTimestreamsSession();
                  setSavedSession(null);
                  setResumeSession(null);
                }}
                style={{
                  padding: "8px 12px",
                  background: "#334155",
                  color: "#e2e8f0",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                Discard saved match
              </button>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button
            data-testid="open-host-lobby"
            onClick={() => {
              setResumeSession(null);
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
              setResumeSession(null);
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
              Applies to Local 2-Seat and Host lobby (shared for both seats). Uncheck for
              free tools / manual card text. Mid-game you may only disable (cannot re-enable
              for the rest of the match).
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
          rulesEnabled={
            resumeSession?.rulesEnabled !== undefined
              ? !!resumeSession.rulesEnabled
              : rulesEnabled
          }
          game={gameDef}
          onGameStart={handleGameStart}
          onError={handleLobbyError}
          resumeMatchID={resumeSession?.matchID ?? null}
          resumeAsRole={resumeSession ? lobbyRole : null}
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              padding: 8,
              // Each seat scrolls independently so scoring OK / prompts are not
              // clipped by overflow:hidden on a half-width column.
              alignItems: "stretch",
              minHeight: "calc(100vh - 56px)",
            }}
          >
            <div
              style={{
                border: "1px solid #334155",
                borderRadius: 8,
                overflow: "auto",
                maxHeight: "calc(100vh - 64px)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  background: "#1e3a5f",
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "#e2e8f0",
                  position: "sticky",
                  top: 0,
                  zIndex: 5,
                }}
              >
                Player 0
              </div>
              <Dual playerID="0" matchID={localDualSession.matchID} />
            </div>
            <div
              style={{
                border: "1px solid #334155",
                borderRadius: 8,
                overflow: "auto",
                maxHeight: "calc(100vh - 64px)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  background: "#134e4a",
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "#e2e8f0",
                  position: "sticky",
                  top: 0,
                  zIndex: 5,
                }}
              >
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
            P2P {gameParams.role}
            {gameParams.restoreFromPersist ? " · RESUME" : ""} · match{" "}
            {gameParams.matchID} · you are P{gameParams.playerID}
            <button
              onClick={() => {
                // Leave but keep session ticket so either peer can rejoin.
                handleBack();
              }}
              style={{ marginLeft: 12, fontSize: 11 }}
            >
              Leave (keep resume)
            </button>
            <button
              onClick={() => {
                clearTimestreamsSession();
                setSavedSession(null);
                handleBack();
              }}
              style={{ marginLeft: 8, fontSize: 11 }}
            >
              End match
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
