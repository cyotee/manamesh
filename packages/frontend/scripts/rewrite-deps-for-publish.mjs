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
// Registry artifacts are prebuilt; repository build hooks cannot run here.
pkg.scripts = { start: "node ./bin/cli.js" };
pkg.publishConfig = { access: "public" };
// The monorepo workflow builds and publishes this artifact; provenance must
// identify that repository, whose commit also pins the platform submodule.
pkg.repository = {
  type: "git",
  url: "git+https://github.com/cyotee/manamesh-games.git",
  directory: "packages/manamesh/packages/frontend",
};
pkg.files = ["dist/public-api.js", "dist/public-api.d.ts", "dist/channel-transport.d.ts", "dist/channel.d.ts", "dist/extension-messages.d.ts", "dist/index.html", "bin", "README.md", "LICENSE", "TRANSPORT-LICENSE"];
// Source subpaths are workspace integration points, not part of the thin
// registry package. Never advertise files omitted from the tarball.
pkg.exports = {
  ".": {
    types: "./dist/public-api.d.ts",
    default: "./dist/public-api.js",
  },
  "./package.json": "./package.json",
};
pkg.bin = { manamesh: "./bin/cli.js" };

fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
console.log("Rewrote", path, "for publish; deps=", pkg.dependencies);
