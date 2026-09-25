import React from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { SimpleCardGame } from "../../game/game";
import { GameBoard } from "../../components/GameBoard";

console.log("[ManaMesh] game page boot");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

const LocalClient = Client({
  game: SimpleCardGame,
  board: GameBoard,
  multiplayer: Local(),
  numPlayers: 2,
  debug: false,
});

root.render(
  <React.StrictMode>
    {Array.from({ length: 2 }, (_, seat) => (
      <section key={seat} aria-label={`Player ${seat}`}>
        <LocalClient playerID={String(seat)} matchID="local-simple" />
      </section>
    ))}
  </React.StrictMode>
);
