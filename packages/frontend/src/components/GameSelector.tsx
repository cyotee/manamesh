/**
 * Game Selector Component
 *
 * Displays available games as selectable cards.
 */

import React from "react";
import { GAMES, type GameInfo } from "../game/registry";

interface GameSelectorProps {
  onSelectGame: (gameId: string) => void;
  onBack?: () => void;
}

const GameCard: React.FC<{
  game: GameInfo;
  onClick: () => void;
}> = ({ game, onClick }) => {
  const getGameIcon = (id: string): string => {
    switch (id) {
      case "merkle-battleship":
        return "🚢";
      case "poker":
        return "🃏"; // Playing card
      case "war":
        return "⚔️"; // Crossed swords
      case "gofish":
        return "🐟";
      case "gofish-secure":
        return "🐠";
      case "gofish-zk":
        return "🧾";
      case "simple":
        return "🎴"; // Flower playing card
      default:
        return "🎮"; // Game die
    }
  };

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px",
        backgroundColor: "#16213e",
        border: "2px solid #3a3a5c",
        borderRadius: "12px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        minWidth: "200px",
        textAlign: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#4CAF50";
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "0 8px 16px rgba(0,0,0,0.3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#3a3a5c";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ fontSize: "48px", marginBottom: "12px" }}>
        {getGameIcon(game.id)}
      </div>
      <div
        style={{
          fontSize: "20px",
          fontWeight: "bold",
          color: "#e4e4e4",
          marginBottom: "8px",
        }}
      >
        {game.name}
      </div>
      <div
        style={{
          fontSize: "14px",
          color: "#a0a0a0",
          marginBottom: "12px",
          lineHeight: "1.4",
        }}
      >
        {game.description}
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "#6a8a9a",
          padding: "4px 12px",
          backgroundColor: "#0f3460",
          borderRadius: "12px",
        }}
      >
        {game.minPlayers === game.maxPlayers
          ? `${game.minPlayers} players`
          : `${game.minPlayers}-${game.maxPlayers} players`}
      </div>
    </button>
  );
};

export const GameSelector: React.FC<GameSelectorProps> = ({
  onSelectGame,
  onBack,
}) => {
  return (
    <div
      style={{
        padding: "40px",
        maxWidth: "900px",
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            padding: "8px 16px",
            cursor: "pointer",
            backgroundColor: "#3a3a5c",
            color: "#e4e4e4",
            border: "none",
            borderRadius: "4px",
          }}
        >
          ← Back
        </button>
      )}

      <h1 style={{ marginBottom: "8px", color: "#e4e4e4" }}>ManaMesh</h1>
      <p style={{ color: "#a0a0a0", marginBottom: "16px" }}>
        Decentralized Card Game Platform
      </p>

      <div
        style={{
          backgroundColor: "#0f3460",
          padding: "12px 24px",
          borderRadius: "8px",
          marginBottom: "40px",
          display: "inline-block",
          border: "1px solid #3a3a5c",
        }}
      >
        <span style={{ color: "#6fcf6f" }}>🔒 P2P</span>
        <span style={{ color: "#a0a0a0", margin: "0 8px" }}>|</span>
        <span style={{ color: "#a0a0a0" }}>No servers required</span>
      </div>

      <h2 style={{ marginBottom: "24px", color: "#e4e4e4" }}>Choose a Game</h2>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "20px",
          justifyContent: "center",
        }}
      >
        {GAMES.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            onClick={() => onSelectGame(game.id)}
          />
        ))}
      </div>
    </div>
  );
};
