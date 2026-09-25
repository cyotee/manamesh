import React from "react";
import ReactDOM from "react-dom/client";

console.log("[ManaMesh] dev-console boot");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

root.render(
  <React.StrictMode>
    <main style={{ padding: 24 }}>
      <h1>ManaMesh development pages</h1>
      <nav aria-label="Game development pages">
        <ul>
          {[
            ["timestreams", "Timestreams"],
            ["poker", "Poker"],
            ["onepiece", "One Piece"],
            ["merkle-battleship", "Merkle Battleship"],
            ["simple", "Simple card game"],
            ["threshold-tally", "Threshold Tally demo"],
          ].map(([path, label]) => <li key={path}>
            <a href={`../${path}/`}>{label}</a>
          </li>)}
        </ul>
      </nav>
    </main>
  </React.StrictMode>,
);
