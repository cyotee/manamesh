/**
 * Build thin public library entry for @cyotee/manamesh (no SPA game graph).
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const outdir = path.join(root, "dist");
const transportRoot = path.resolve(root, "../../../boardgameIO-p2p");
fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src/public-api.ts")],
  outfile: path.join(outdir, "public-api.js"),
  bundle: true,
  platform: "neutral",
  format: "esm",
  // Ship the checked-out security fixes, not the older registry transport.
  alias: {
    "@cyotee/boardgameio-p2p/channel": path.join(transportRoot, "src/channel-transport.ts"),
  },
  plugins: [{
    name: "node-compatible-engine-entry",
    setup(build) {
      // The engine's legacy entry directories have no ESM exports map.
      build.onResolve({ filter: /^boardgame\.io\/(core|internal)$/ }, ({ path: entry }) => ({
        path: `boardgame.io/dist/cjs/${entry.split("/")[1]}.js`, external: true,
      }));
    },
  }],
  external: [
    "boardgame.io",
    "boardgame.io/*",
    "@cyotee/boardgameio-crypto",
    "@cyotee/boardgameio-crypto/*",
    "react",
    "react-dom",
    "peerjs",
  ],
  logLevel: "info",
});

// Match src/public-api.ts exactly; every target is supplied by the transport package.
fs.writeFileSync(
  path.join(outdir, "public-api.d.ts"),
  `export {
  P2PMultiplayer, P2PTransport, BrowserStorage,
  type P2PChannel, type P2PTransportOpts, type P2PRole,
} from "./channel-transport.js";
`
);
for (const name of ["channel-transport", "channel", "extension-messages"]) {
  const declaration = fs.readFileSync(path.join(transportRoot, "dist", `${name}.d.ts`), "utf8")
    .replaceAll('"./channel"', '"./channel.js"')
    .replaceAll('"./extension-messages"', '"./extension-messages.js"');
  fs.writeFileSync(path.join(outdir, `${name}.d.ts`), declaration);
}
console.log("Library build written to dist/public-api.js");
