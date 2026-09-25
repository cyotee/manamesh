import React, { useState, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { OnePieceGame } from "@manamesh/onepiece";
import { OnePiecePhaserBoard } from "../../components/OnePiecePhaserBoard";
import { RoomCodeLobby } from "../../components/RoomCodeLobby";
import { P2PLobby } from "../../components/P2PLobby";
import { P2PMultiplayer } from "../../p2p/transport";
import type { P2PChannel } from "@cyotee/boardgameio-p2p/channel";

console.log("[ManaMesh] onepiece page boot");

type Phase = "menu" | "lobby" | "game" | "local";

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

function LocalOnePieceGame() {
  const [playerID, setPlayerID] = useState("0");
  const LocalClient = useMemo(() => Client({
    game: OnePieceGame,
    board: OnePiecePhaserBoard,
    multiplayer: Local(),
    numPlayers: 2,
    debug: false,
  }), []);
  return <>
    <label>Local seat: <select aria-label="Local seat" value={playerID}
      onChange={(event) => setPlayerID(event.target.value)}>
      <option value="0">Player 0</option>
      <option value="1">Player 1</option>
    </select></label>
    {["0", "1"].map((seat) => (
      <div key={seat} hidden={seat !== playerID}>
        <LocalClient playerID={seat} matchID="local-onepiece" />
      </div>
    ))}
  </>;
}

function OnePieceApp() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [lobbyRole, setLobbyRole] = useState<"host" | "guest">("host");
  const [gameParams, setGameParams] = useState<GameStartParams | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGameStart = useCallback((params: GameStartParams) => {
    setGameParams(params);
    setPhase("game");
  }, []);

  const P2PClient = useMemo(() => {
    if (!gameParams) return null;
    const hasChannel =
      gameParams.connection ||
      (gameParams.hostConnections && gameParams.hostConnections.size > 0);
    if (!hasChannel) return null;
    return Client({
      game: OnePieceGame,
      board: OnePiecePhaserBoard,
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
        <h1>One Piece TCG</h1>
        <p style={{ color: "#94a3b8", fontSize: 14 }}>
          P2P multiplayer via shared table code, or local 2-seat in one browser.
        </p>
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button
            type="button"
            data-testid="op-host"
            onClick={() => {
              setLobbyRole("host");
              setPhase("lobby");
            }}
            style={{ padding: "10px 16px", background: "#2563eb", color: "white", border: "none", borderRadius: 6 }}
          >
            Host P2P
          </button>
          <button
            type="button"
            data-testid="op-guest"
            onClick={() => {
              setLobbyRole("guest");
              setPhase("lobby");
            }}
            style={{ padding: "10px 16px", background: "#0d9488", color: "white", border: "none", borderRadius: 6 }}
          >
            Join P2P
          </button>
          <button
            type="button"
            data-testid="op-local"
            onClick={() => setPhase("local")}
            style={{ padding: "10px 16px", background: "#334155", color: "white", border: "none", borderRadius: 6 }}
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
        <button
          type="button"
          onClick={() => setPhase("menu")}
          style={{ margin: 8 }}
        >
          ← Menu
        </button>
        <LocalOnePieceGame />
      </div>
    );
  }

  if (phase === "lobby") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setPhase("menu")}
          style={{ margin: 8 }}
        >
          ← Menu
        </button>
        <RoomCodeLobby
          gameId="onepiece"
          title="One Piece Lobby"
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
              numPlayers: params.numPlayers,
            });
          }}
          renderAdvanced={() => (
            <div style={{ marginTop: 12 }}>
              <P2PLobby
                onConnected={(connection, role) => {
                  handleGameStart({
                    connection,
                    role,
                    playerID: role === "host" ? "0" : "1",
                    matchID: `op_sdp_${Date.now()}`,
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
    <OnePieceApp />
  </React.StrictMode>,
);
