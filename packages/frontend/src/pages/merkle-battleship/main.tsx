import React, { useState, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import {
  MerkleBattleshipGame,
  MerkleBattleshipBoard,
} from "@manamesh/game-battleship-merkle";
import { RoomCodeLobby } from "../../components/RoomCodeLobby";
import { P2PLobby } from "../../components/P2PLobby";
import { P2PMultiplayer } from "../../p2p/transport";
import type { P2PChannel } from "@cyotee/boardgameio-p2p/channel";
import type { JoinCodeConnection } from "../../p2p";

console.log("[ManaMesh] merkle-battleship page boot");

type Phase = "menu" | "lobby" | "game" | "local";

interface GameStartParams {
  connection?: P2PChannel | JoinCodeConnection | null;
  hostConnections?: Map<string, P2PChannel>;
  role: "host" | "guest";
  playerID: string;
  matchID: string;
  numPlayers: number;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

function MerkleBattleshipApp() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [lobbyRole, setLobbyRole] = useState<"host" | "guest">("host");
  const [gameParams, setGameParams] = useState<GameStartParams | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGameStart = useCallback((params: GameStartParams) => {
    setGameParams(params);
    setPhase("game");
  }, []);

  const Board = useMemo(() => {
    if (!gameParams) return null;
    const conn = gameParams.connection;
    // Inject signal channel when JoinCodeConnection-shaped
    const Wrapped: React.FC<any> = (props) => (
      <MerkleBattleshipBoard
        {...props}
        p2pConnection={
          conn && "sendSignal" in conn
            ? (conn as JoinCodeConnection)
            : undefined
        }
      />
    );
    return Wrapped;
  }, [gameParams]);

  const P2PClient = useMemo(() => {
    if (!gameParams || !Board) return null;
    const hasChannel =
      gameParams.connection ||
      (gameParams.hostConnections && gameParams.hostConnections.size > 0);
    if (!hasChannel) return null;
    return Client({
      game: MerkleBattleshipGame,
      board: Board,
      multiplayer: P2PMultiplayer({
        connection: (gameParams.connection as P2PChannel) ?? undefined,
        hostConnections: gameParams.hostConnections,
        role: gameParams.role,
        matchID: gameParams.matchID,
        playerID: gameParams.playerID,
        numPlayers: gameParams.numPlayers,
      }),
      numPlayers: gameParams.numPlayers,
    });
  }, [gameParams, Board]);

  if (phase === "menu") {
    return (
      <div
        style={{
          padding: 24,
          maxWidth: 560,
          margin: "40px auto",
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "system-ui",
        }}
      >
        <h1>Merkle Battleship</h1>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>
          Binding ship placement via Merkle commitments. 2 players · Quick
          connect (Trystero) or Advanced join codes.
        </p>
        <p style={{ fontSize: 12, color: "#64748b" }}>
          Package:{" "}
          <code>@manamesh/game-battleship-merkle</code> · repo{" "}
          <code>game-battleship-merkle</code>
        </p>
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button
            type="button"
            data-testid="mb-host"
            onClick={() => {
              setLobbyRole("host");
              setPhase("lobby");
            }}
            style={{
              padding: "10px 16px",
              background: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 6,
            }}
          >
            Host P2P
          </button>
          <button
            type="button"
            data-testid="mb-guest"
            onClick={() => {
              setLobbyRole("guest");
              setPhase("lobby");
            }}
            style={{
              padding: "10px 16px",
              background: "#0d9488",
              color: "white",
              border: "none",
              borderRadius: 6,
            }}
          >
            Join P2P
          </button>
          <button
            type="button"
            data-testid="mb-local"
            onClick={() => setPhase("local")}
            style={{
              padding: "10px 16px",
              background: "#334155",
              color: "white",
              border: "none",
              borderRadius: 6,
            }}
          >
            Local (same browser)
          </button>
        </div>
      </div>
    );
  }

  if (phase === "local") {
    return (
      <div>
        <button type="button" onClick={() => setPhase("menu")} style={{ margin: 8 }}>
          ← Menu
        </button>
        <Client
          game={MerkleBattleshipGame}
          board={MerkleBattleshipBoard}
          multiplayer={Local()}
        />
      </div>
    );
  }

  if (phase === "lobby") {
    return (
      <div>
        <button type="button" onClick={() => setPhase("menu")} style={{ margin: 8 }}>
          ← Menu
        </button>
        <RoomCodeLobby
          key={`mb-lobby-${lobbyRole}`}
          gameId="merkle-battleship"
          title="Merkle Battleship Lobby"
          displayName={
            localStorage.getItem("manamesh_player_name") || "Player"
          }
          isHost={lobbyRole === "host"}
          maxPlayers={2}
          minPlayers={2}
          onError={(e) => setError(e.message)}
          onGameStart={(params) => {
            handleGameStart({
              connection: params.connection ?? null,
              hostConnections: params.hostConnections,
              role: params.role,
              playerID: params.playerID,
              matchID: params.matchID,
              numPlayers: 2,
            });
          }}
          renderAdvanced={() => (
            <div style={{ marginTop: 12 }}>
              <P2PLobby
                key={`mb-sdp-${lobbyRole}`}
                onConnected={(connection, role) => {
                  handleGameStart({
                    connection,
                    role,
                    playerID: role === "host" ? "0" : "1",
                    matchID: `mb_sdp_${Date.now()}`,
                    numPlayers: 2,
                  });
                }}
                onBack={() => setPhase("menu")}
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
        <p>Missing game params</p>
        <button type="button" onClick={() => setPhase("menu")}>
          Menu
        </button>
      </div>
    );
  }

  const BoardClient = P2PClient;
  return (
    <div>
      <button type="button" onClick={() => setPhase("menu")} style={{ margin: 8 }}>
        ← Menu
      </button>
      <BoardClient playerID={gameParams.playerID} matchID={gameParams.matchID} />
    </div>
  );
}

root.render(
  <React.StrictMode>
    <MerkleBattleshipApp />
  </React.StrictMode>,
);
