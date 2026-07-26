/**
 * Shared Quick-connect lobby: room code + optional password, FIFO roster,
 * host Start / auto-start when full. Advanced SDP is parent-provided slot.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { P2PChannel } from "@cyotee/boardgameio-p2p/channel";
import type { TrysteroTableSession } from "@cyotee/boardgameio-p2p/trystero";
import {
  tryQuickConnect,
  PasswordAuthError,
  generateRoomCode,
  type OrchestratorGameId,
  type ConnectMode,
} from "../p2p/connect";

export type RoomCodeGameStart = {
  role: "host" | "guest";
  playerID: string;
  matchID: string;
  numPlayers: number;
  roomCode: string;
  connection?: P2PChannel;
  hostConnections?: Map<string, P2PChannel>;
  backend: "trystero" | "joinCode";
  session?: TrysteroTableSession;
};

export type RoomCodeLobbyProps = {
  gameId: OrchestratorGameId;
  displayName: string;
  isHost: boolean;
  maxPlayers: number;
  minPlayers?: number;
  title?: string;
  /** Render Advanced SDP join-code UI when fallback or user expands */
  renderAdvanced?: (opts: {
    forced: boolean;
    reason?: string;
    onBackToQuick?: () => void;
  }) => React.ReactNode;
  onGameStart: (params: RoomCodeGameStart) => void;
  onError: (error: Error) => void;
  /** Force connect mode */
  mode?: ConnectMode;
};

const box: React.CSSProperties = {
  margin: "10px 0",
  padding: 12,
  background: "#1e2937",
  borderRadius: 6,
};

export const RoomCodeLobby: React.FC<RoomCodeLobbyProps> = ({
  gameId,
  displayName,
  isHost,
  maxPlayers,
  minPlayers = 2,
  title,
  renderAdvanced,
  onGameStart,
  onError,
  mode,
}) => {
  const [roomCode, setRoomCode] = useState(() =>
    isHost ? generateRoomCode(7) : "",
  );
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>();
  const [seated, setSeated] = useState<string[]>(isHost ? ["0"] : []);
  const sessionRef = useRef<TrysteroTableSession | null>(null);
  const startedRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [playerID, setPlayerID] = useState(isHost ? "0" : "");
  const [matchID, setMatchID] = useState("");

  const startGame = useCallback(
    (sess: TrysteroTableSession, code: string, mid: string) => {
      if (startedRef.current) return;
      const seatedIds = sess.getSeatedPlayerIDs();
      const numPlayers = seatedIds.length;
      if (numPlayers < minPlayers) return;
      startedRef.current = true;
      onGameStart({
        role: sess.role,
        playerID: sess.playerID,
        matchID: mid,
        numPlayers,
        roomCode: code,
        connection: sess.connection,
        hostConnections: sess.hostConnections,
        backend: "trystero",
        session: sess,
      });
    },
    [minPlayers, onGameStart],
  );

  const connectQuick = useCallback(async () => {
    setError("");
    setStatus("connecting");
    try {
      const result = await tryQuickConnect({
        gameId,
        role: isHost ? "host" : "guest",
        roomCode: roomCode || undefined,
        password: password || undefined,
        maxPlayers,
        mode,
      });

      if (result.backend === "fallback-joinCode") {
        setFallbackReason(result.reason);
        setShowAdvanced(true);
        setStatus("fallback");
        setError(
          `Quick connect failed (${result.reason}). Use Advanced join codes (2 players).`,
        );
        return;
      }

      sessionRef.current = result.session;
      setRoomCode(result.roomCode);
      setMatchID(result.matchID);
      setPlayerID(result.playerID);
      setSeated(result.session.getSeatedPlayerIDs());
      setSessionReady(true);
      setStatus("waiting");

      // Guest enters the boardgame.io client as soon as seated (host Start
      // creates the master; guest sync-req retries if host not ready yet).
      if (result.session.role === "guest") {
        startGame(result.session, result.roomCode, result.matchID);
        return;
      }

      result.session.onRosterChange = (ids) => {
        setSeated([...ids]);
        // Auto-start when full
        if (ids.length >= maxPlayers) {
          startGame(result.session, result.roomCode, result.matchID);
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus("error");
      setError(msg);
      if (!(err instanceof PasswordAuthError)) {
        onError(err instanceof Error ? err : new Error(msg));
      }
    }
  }, [
    gameId,
    isHost,
    roomCode,
    password,
    maxPlayers,
    mode,
    minPlayers,
    onError,
    startGame,
  ]);

  // joinCode-only mode: open Advanced panel. Do NOT auto-open a Trystero
  // session on mount — host must set optional password first, then Create table.
  useEffect(() => {
    if (mode === "joinCode") {
      setShowAdvanced(true);
    }
    return () => {
      if (!startedRef.current) {
        sessionRef.current?.leave();
      }
    };
  }, [mode]);

  const handleHostStart = () => {
    const sess = sessionRef.current;
    if (!sess || !matchID) return;
    startGame(sess, roomCode, matchID);
  };

  const canStart =
    isHost &&
    sessionReady &&
    seated.length >= minPlayers &&
    !startedRef.current;

  /** Host has not opened the room yet — can still edit code/password. */
  const hostCanCreate = isHost && !sessionReady && status !== "connecting";

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 700,
        margin: "0 auto",
        background: "#0f172a",
        color: "#e2e8f0",
      }}
    >
      <h2>{title || "Multiplayer Lobby"}</h2>
      <p>
        {displayName} · <strong>{isHost ? "Host" : "Guest"}</strong> · max{" "}
        {maxPlayers} seats
      </p>

      {!showAdvanced && (
        <div style={box} data-testid="quick-connect">
          <h3>Quick connect (table code)</h3>
          <p style={{ fontSize: 13, color: "#94a3b8" }}>
            Everyone joins with the <strong>same room code</strong> and optional
            password. No SDP paste.
          </p>
          <label style={{ display: "block", marginTop: 8 }}>
            Room code
            <input
              data-testid="room-code-input"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              disabled={isHost && sessionReady}
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: 8,
                fontFamily: "monospace",
                fontSize: 18,
                letterSpacing: 2,
              }}
              maxLength={8}
              placeholder="6–8 characters"
            />
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Password (optional)
            <input
              data-testid="room-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={sessionReady}
              style={{ display: "block", width: "100%", marginTop: 4, padding: 8 }}
              placeholder={isHost ? "Set before creating table" : "If host set one"}
            />
          </label>

          {hostCanCreate && (
            <button
              data-testid="host-create-table"
              onClick={() => void connectQuick()}
              style={{ marginTop: 12, padding: "8px 16px" }}
            >
              Create table
            </button>
          )}

          {!isHost && !sessionReady && (
            <button
              data-testid="join-quick"
              onClick={() => void connectQuick()}
              style={{ marginTop: 12, padding: "8px 16px" }}
            >
              Connect
            </button>
          )}

          {status === "connecting" && <p>Connecting…</p>}
          {status === "waiting" && (
            <div style={{ marginTop: 12 }}>
              <p>
                Seated: {seated.length}/{maxPlayers}{" "}
                <code style={{ fontSize: 12 }}>[{seated.join(", ")}]</code>
              </p>
              <p style={{ fontSize: 12, color: "#94a3b8" }}>
                You are player {playerID}. Share code{" "}
                <strong>{roomCode}</strong>
                {password ? " (+ password)" : ""}.
              </p>
              {canStart && (
                <button
                  data-testid="host-start"
                  onClick={handleHostStart}
                  style={{ marginTop: 8, padding: "8px 16px" }}
                >
                  Start game ({seated.length} players)
                </button>
              )}
              {seated.length >= maxPlayers && (
                <p style={{ color: "#86efac" }}>Table full — auto-starting…</p>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: "#f87171" }} data-testid="connect-error">
          {error}
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          data-testid="toggle-advanced"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ background: "transparent", color: "#94a3b8", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          {showAdvanced
            ? "Hide Advanced join codes"
            : "Advanced: join codes (2 players, no relays)"}
        </button>
      </div>

      {showAdvanced && renderAdvanced?.({
        forced: !!fallbackReason,
        reason: fallbackReason,
        onBackToQuick: () => {
          setShowAdvanced(false);
          setFallbackReason(undefined);
          setError("");
        },
      })}
    </div>
  );
};
