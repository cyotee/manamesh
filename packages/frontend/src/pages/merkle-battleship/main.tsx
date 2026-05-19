import React from "react";
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { MerkleBattleshipGame } from "../../game/modules/merkle-battleship";
import { MerkleBattleshipBoard } from "../../components/MerkleBattleshipBoard";

console.log("[ManaMesh] game page boot");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

root.render(
  <React.StrictMode>
    <Client
      game={MerkleBattleshipGame}
      board={MerkleBattleshipBoard}
      multiplayer={Local()}
    />
  </React.StrictMode>
);
