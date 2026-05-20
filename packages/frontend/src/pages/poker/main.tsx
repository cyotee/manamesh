import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { PokerGame, PokerBoard } from "@manamesh/poker";
import { PokerLobby } from "./PokerLobby";
import { P2PMultiplayer } from "../../p2p/transport";
import { JoinCodeTransport } from "../../p2p/transports/joincode-transport";
import type { JoinCodeConnection } from "../../p2p/transport";

console.log("[ManaMesh] poker page boot");

type GamePhase = 'lobby' | 'game';

interface GameStartParams {
  connection: JoinCodeConnection;
  role: 'host' | 'guest';
  playerID: string;
  matchID: string;
  numPlayers: number;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

function PokerApp() {
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [gameParams, setGameParams] = useState<GameStartParams | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGameStart = useCallback((params: GameStartParams) => {
    console.log('[PokerApp] Game starting with params:', params);
    setGameParams(params);
    setPhase('game');
  }, []);

  const handleLobbyError = useCallback((err: Error) => {
    console.error('[PokerApp] Lobby error:', err);
    setError(err.message);
  }, []);

  const handleBackToLobby = useCallback(() => {
    setGameParams(null);
    setError(null);
    setPhase('lobby');
  }, []);

  if (phase === 'lobby') {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room') || undefined;
    const isHost = urlParams.get('host') === 'true' || roomCode === undefined;

    return (
      <PokerLobby
        displayName={getPlayerName()}
        isHost={isHost}
        roomCode={roomCode}
        maxPlayers={6}
        minBuyIn={1000}
        smallBlind={5}
        bigBlind={10}
        game={PokerGame}
        onGameStart={handleGameStart}
        onError={handleLobbyError}
      />
    );
  }

  if (!gameParams) {
    return (
      <div style={{ padding: 20, color: 'white' }}>
        <p>Error: No game parameters</p>
        <button onClick={handleBackToLobby}>Back to Lobby</button>
      </div>
    );
  }

  const multiplayer = P2PMultiplayer({
    connection: gameParams.connection,
    role: gameParams.role,
    matchID: gameParams.matchID,
    playerID: gameParams.playerID,
    numPlayers: gameParams.numPlayers,
  });

  return (
    <Client
      game={PokerGame}
      board={PokerBoard}
      multiplayer={multiplayer}
    />
  );
}

function getPlayerName(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('manamesh_player_name');
    if (stored) return stored;
  }
  return `Player_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

root.render(
  <React.StrictMode>
    <PokerApp />
  </React.StrictMode>
);