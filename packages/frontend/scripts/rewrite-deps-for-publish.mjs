/**
 * Rewrite package.json dependencies for registry publish:
 * - Published surface is the thin public-api + SPA static assets + bin
 * - Only registry-reachable runtime deps for the library entry
 * - Drop unpublished @manamesh/* game packages and monorepo SPA-only deps
 */
import fs from "node:fs";

const path = process.argv[2] || "package.json";
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));

// Library re-exports only need these at runtime for consumers of public-api
pkg.dependencies = {
  "@cyotee/boardgameio-p2p": "^0.5.0",
  "@cyotee/boardgameio-crypto": "^0.1.0",
  "boardgame.io": "npm:@cyotee/boardgame.io@0.50.3",
};
pkg.peerDependencies = {
  react: "^18.0.0 || ^19.0.0",
  "react-dom": "^18.0.0 || ^19.0.0",
};
pkg.peerDependenciesMeta = {
  react: { optional: true },
  "react-dom": { optional: true },
};
delete pkg.devDependencies;
delete pkg.private;
pkg.publishConfig = { access: "public" };
pkg.files = ["dist", "bin", "README.md", "LICENSE"];
pkg.bin = { manamesh: "./bin/cli.js" };

fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
console.log("Rewrote", path, "for publish; deps=", pkg.dependencies);
