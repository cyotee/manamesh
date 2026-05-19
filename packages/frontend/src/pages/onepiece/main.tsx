import React from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { OnePieceGame } from "../../game/modules/onepiece";
import { OnePiecePhaserBoard } from "../../components/OnePiecePhaserBoard";

console.log("[ManaMesh] game page boot");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

root.render(
  <React.StrictMode>
    <Client
      game={OnePieceGame}
      board={OnePiecePhaserBoard}
      multiplayer={Local()}
    />
  </React.StrictMode>
);
