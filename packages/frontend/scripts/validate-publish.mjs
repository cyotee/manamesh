/** Validate the staged registry package before npm pack/publish. */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const required = ["dist/public-api.js", "dist/public-api.d.ts", "dist/channel-transport.d.ts", "dist/channel.d.ts", "dist/extension-messages.d.ts", "dist/index.html", "bin/cli.js", "TRANSPORT-LICENSE"];
for (const file of required) {
  if (!fs.statSync(path.join(root, file)).isFile()) throw new Error(`Missing publish file: ${file}`);
}
for (const target of Object.values(pkg.exports).flatMap(value =>
  typeof value === "string" ? [value] : Object.values(value))) {
  if (target.startsWith("./src/") || !fs.existsSync(path.resolve(root, target))) {
    throw new Error(`Invalid registry export: ${target}`);
  }
}
for (const [name, version] of Object.entries(pkg.dependencies || {})) {
  if (/^(workspace|portal|link|file):/.test(version)) throw new Error(`Local runtime dependency: ${name}`);
}
const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
if (!/<script\b/i.test(html) || !/id=["']root["']/.test(html) || html.includes("Install succeeded.")) {
  throw new Error("Stage the real monorepo SPA in dist/index.html; placeholder pages cannot be published");
}
console.log("Staged registry package validated");
