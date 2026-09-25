import React from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { ThresholdTallyGame } from "../../game/modules/threshold-tally";
import { ThresholdTallyBoard } from "../../components/ThresholdTallyBoard";

console.log("[ManaMesh] game page boot");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

const LocalClient = Client({
  game: ThresholdTallyGame,
  board: ThresholdTallyBoard,
  multiplayer: Local(),
  numPlayers: 3,
  debug: false,
});

root.render(
  <React.StrictMode>
    {Array.from({ length: 3 }, (_, seat) => (
      <section key={seat} aria-label={`Player ${seat}`}>
        <LocalClient playerID={String(seat)} matchID="local-threshold-tally" />
      </section>
    ))}
  </React.StrictMode>
);
