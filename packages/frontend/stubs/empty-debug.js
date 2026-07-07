// Real, resolvable stub used to replace boardgame.io's Svelte debug panel
// (`boardgame.io/src/client/debug/Debug.svelte`). A physical file resolves
// cleanly in BOTH the vite dev server's esbuild dependency pre-scan and the
// production rollup build, unlike a `data:` URI alias which the esbuild scanner
// mis-treats as a filesystem path. See vite.config.ts resolve.alias.
export default null;
export const Debug = null;
