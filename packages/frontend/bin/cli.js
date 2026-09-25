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

let portValue = process.env.PORT ?? "3000";
const portIdx = args.findIndex((a) => a === "--port" || a === "-p");
if (portIdx >= 0) portValue = args[portIdx + 1];
if (typeof portValue !== "string" || !/^\d+$/.test(portValue) || Number(portValue) > 65535) {
  console.error("Error: port must be an integer from 0 to 65535.");
  process.exit(1);
}
const port = Number(portValue);

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

// Compare path components, not a string prefix (dist-private is not in dist).
const realDist = fs.realpathSync(distDir);
const withinDist = file => {
  const relative = path.relative(realDist, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const server = http.createServer((req, res) => {
  const reply = (status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    reply(405, "Method Not Allowed", { Allow: "GET, HEAD" }); return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (!urlPath.startsWith("/") || urlPath.includes("\0") || urlPath.includes("\\")) throw new Error();
  } catch {
    reply(400, "Bad Request"); return;
  }
  let filePath = path.resolve(realDist, `.${urlPath === "/" ? "/index.html" : urlPath}`);
  if (!withinDist(filePath)) { reply(403, "Forbidden"); return; }
  try {
    // Resolve symlinks before reading; an in-directory link must not expose
    // files outside the package's static tree.
    try {
      filePath = fs.realpathSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      if (path.extname(urlPath) || !(req.headers.accept || "").includes("text/html")) {
        reply(404, "Not Found"); return;
      }
      filePath = fs.realpathSync(path.join(realDist, "index.html"));
    }
    if (!withinDist(filePath)) { reply(403, "Forbidden"); return; }
    if (!fs.statSync(filePath).isFile()) { reply(404, "Not Found"); return; }
    const body = fs.readFileSync(filePath);
    reply(200, body, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
    });
  } catch {
    reply(500, "Internal Server Error");
  }
});

server.on("error", error => {
  console.error(`Unable to start ManaMesh: ${error.code || "server error"}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`ManaMesh listening at http://127.0.0.1:${server.address().port}/`);
  console.log("Press Ctrl+C to stop.");
});
