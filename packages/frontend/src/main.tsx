import React from "react";
import ReactDOM from "react-dom/client";

// If the UI is blank, this log helps confirm Vite loaded main.tsx.
console.log("[ManaMesh] main.tsx boot");

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("[ManaMesh] Missing #root element");
}

const root = ReactDOM.createRoot(rootEl);

async function boot() {
  try {
    const mod = await import("./App");
    const App = mod.default;

    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (err) {
    console.error("[ManaMesh] App import/render failed", err);
    root.render(
      <div
        style={{
          padding: 24,
          maxWidth: 900,
          margin: "0 auto",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          color: "#e4e4e4",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>
          ManaMesh failed to boot
        </h1>
        <div style={{ opacity: 0.9, marginBottom: 12 }}>
          Check DevTools Console for details.
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid #3a3a5c",
            borderRadius: 8,
            padding: 12,
            overflow: "auto",
          }}
        >
          {String(err)}
        </pre>
      </div>,
    );
  }
}

void boot();
