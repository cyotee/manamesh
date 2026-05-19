import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../App";

console.log("[ManaMesh] dev-console boot");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[ManaMesh] Missing #root element");
const root = ReactDOM.createRoot(rootEl);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
