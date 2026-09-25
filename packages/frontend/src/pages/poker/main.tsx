import { PokerProtectedApp } from "./PokerProtectedApp";
import React, { useState, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { PokerGame, PokerBoard } from "@manamesh/poker";
import { RoomCodeLobby } from "../../components/RoomCodeLobby";
import { P2PLobby } from "../../components/P2PLobby";
import { P2PMultiplayer } from "../../p2p/transport";
import type { P2PChannel } from "@cyotee/boardgameio-p2p/channel";
import { getPokerMaxPlayers } from "../../p2p/connect";
import { WalletProvider, E2eWalletToolbar } from "../../wallet";

console.log("[ManaMesh] poker page boot");

type GamePhase = "lobby" | "game";

interface GameStartParams {
  connection?: P2PChannel | null;
  hostConnections?: Map<string, P2PChannel>;
  role: "host" | "guest";
  playerID: string;
  matchID: string;
  numPlayers: number;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

function PokerApp() {
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [gameParams, setGameParams] = useState<GameStartParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lobbyRole, setLobbyRole] = useState<"host" | "guest">("host");

  const handleGameStart = useCallback((params: GameStartParams) => {
    console.log("[PokerApp] Game starting with params:", params);
    setGameParams(params);
    setPhase("game");
  }, []);

  const handleLobbyError = useCallback((err: Error) => {
    console.error("[PokerApp] Lobby error:", err);
    setError(err.message);
  }, []);

  const handleBackToLobby = useCallback(() => {
    setGameParams(null);
    setError(null);
    setPhase("lobby");
  }, []);

  const P2PClient = useMemo(() => {
    if (!gameParams) return null;
    const hasChannel =
      gameParams.connection ||
      (gameParams.hostConnections && gameParams.hostConnections.size > 0);
    if (!hasChannel) return null;
    return Client({
      game: PokerGame,
      board: PokerBoard,
      multiplayer: P2PMultiplayer({
        connection: gameParams.connection ?? undefined,
        hostConnections: gameParams.hostConnections,
        role: gameParams.role,
        matchID: gameParams.matchID,
        playerID: gameParams.playerID,
        numPlayers: gameParams.numPlayers,
      }),
      numPlayers: gameParams.numPlayers,
    });
  }, [gameParams]);

  if (phase === "lobby") {
    return (
      <div>
        <div style={{ padding: 12, display: "flex", gap: 8, background: "#0f172a" }}>
          <a href="?protected=1">Protected protocol preview</a>
          <button
            type="button"
            onClick={() => setLobbyRole("host")}
            style={{
              padding: "6px 12px",
              background: lobbyRole === "host" ? "#2563eb" : "#334155",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Host
          </button>
          <button
            type="button"
            onClick={() => setLobbyRole("guest")}
            style={{
              padding: "6px 12px",
              background: lobbyRole === "guest" ? "#0d9488" : "#334155",
              color: "white",
              border: "none",
              borderRadius: 4,
            }}
          >
            Guest
          </button>
        </div>
        {error && (
          <p style={{ color: "#f87171", padding: 12 }}>Note: {error}</p>
        )}
        <RoomCodeLobby
          key={`poker-lobby-${lobbyRole}`}
          gameId="poker"
          title="Poker Lobby"
          displayName={getPlayerName()}
          isHost={lobbyRole === "host"}
          maxPlayers={getPokerMaxPlayers()}
          minPlayers={2}
          onError={handleLobbyError}
          onGameStart={(params) => {
            handleGameStart({
              connection: params.connection ?? null,
              hostConnections: params.hostConnections,
              role: params.role,
              playerID: params.playerID,
              matchID: params.matchID,
              numPlayers: params.numPlayers,
            });
          }}
          renderAdvanced={() => (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: "#94a3b8", fontSize: 13, padding: "0 20px" }}>
                Advanced: 2-player SDP join codes only.
              </p>
              <P2PLobby
                key={`poker-sdp-${lobbyRole}`}
                onConnected={(connection, role) => {
                  handleGameStart({
                    connection,
                    role,
                    playerID: role === "host" ? "0" : "1",
                    matchID: `pk_sdp_${Date.now()}`,
                    numPlayers: 2,
                  });
                }}
                onBack={() => setError(null)}
              />
            </div>
          )}
        />
      </div>
    );
  }

  if (!gameParams || !P2PClient) {
    return (
      <div style={{ padding: 20, color: "white" }}>
        <p>Error: No game parameters</p>
        <button onClick={handleBackToLobby}>Back to Lobby</button>
      </div>
    );
  }

  const BoardClient = P2PClient;
  return (
    <div>
      <div style={{ padding: 8 }}>
        <button onClick={handleBackToLobby}>← Lobby</button>
        <span style={{ marginLeft: 12, color: "#94a3b8" }}>
          P{gameParams.playerID} · {gameParams.role} · {gameParams.matchID}
        </span>
      </div>
      <BoardClient
        playerID={gameParams.playerID}
        matchID={gameParams.matchID}
      />
    </div>
  );
}

function getPlayerName(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("manamesh_player_name");
    if (stored) return stored;
  }
  return `Player_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

root.render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("protected") === "1" ? <PokerProtectedApp /> : <WalletProvider>
      <div data-testid="poker-app-root">
        <E2eWalletToolbar />
        <PokerApp />
      </div>
    </WalletProvider>}
  </React.StrictMode>,
);
