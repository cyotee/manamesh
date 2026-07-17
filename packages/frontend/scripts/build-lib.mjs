/**
 * Build thin public library entry for @cyotee/manamesh (no SPA game graph).
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const outdir = path.join(root, "dist");
fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src/public-api.ts")],
  outfile: path.join(outdir, "public-api.js"),
  bundle: true,
  platform: "neutral",
  format: "esm",
  external: [
    "boardgame.io",
    "boardgame.io/*",
    "@cyotee/boardgameio-p2p",
    "@cyotee/boardgameio-p2p/*",
    "@cyotee/boardgameio-crypto",
    "@cyotee/boardgameio-crypto/*",
    "react",
    "react-dom",
    "peerjs",
  ],
  logLevel: "info",
});

// Minimal ambient d.ts for consumers
fs.writeFileSync(
  path.join(outdir, "public-api.d.ts"),
  `export { P2P, P2PMultiplayer, type P2PChannel, type P2PMultiplayerOpts } from "@cyotee/boardgameio-p2p/channel";
export type { JoinCodeConnection } from "./p2p/transports/joincode-transport";
`
);
console.log("Library build written to dist/public-api.js");
