#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: manamesh [options]

Serve the ManaMesh platform SPA (prebuilt).

Options:
  --port, -p <n>   Port (default: 3000, or PORT env)
  --help, -h       Show this help
`);
  process.exit(0);
}

let port = Number(process.env.PORT) || 3000;
const portIdx = args.findIndex((a) => a === "--port" || a === "-p");
if (portIdx >= 0 && args[portIdx + 1]) port = Number(args[portIdx + 1]) || port;

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("Error: prebuilt dist/index.html not found. Build the package first.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let rel = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.normalize(path.join(distDir, rel));
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(distDir, "index.html")));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(fs.readFileSync(filePath));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ManaMesh listening at http://127.0.0.1:${port}/`);
  console.log("Press Ctrl+C to stop.");
});
