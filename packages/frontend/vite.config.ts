/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compute path to repo root dist/ so the single SPA lands next to the asset zip.
// Override with TIMESTREAMS_VERCEL_OUT for a clean Vercel deploy folder.
const rootDist = process.env.TIMESTREAMS_VERCEL_OUT
  ? path.resolve(process.env.TIMESTREAMS_VERCEL_OUT)
  : path.resolve(__dirname, '../../../../dist');
const isVercelBuild = !!process.env.TIMESTREAMS_VERCEL_OUT;

// Real stub file that replaces boardgame.io's Svelte debug panel. Aliasing to a
// physical file (instead of a `data:` URI) resolves cleanly in both the dev
// server's esbuild dependency pre-scan and the production build.
const emptyDebugStub = path.resolve(__dirname, 'stubs/empty-debug.js');

/** Scanned Timestreams asset pack (manifests + card PNGs). */
const timestreamsPackRoot = path.resolve(
  __dirname,
  '../../../timestreams/assets/packs/timestreams',
);

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Serve packages/timestreams/assets/packs/timestreams at /timestreams-pack/ */
function serveTimestreamsPack() {
  return {
    name: 'serve-timestreams-pack',
    configureServer(server: { middlewares: { use: (path: string, fn: Function) => void } }) {
      server.middlewares.use('/timestreams-pack', (req: any, res: any, next: any) => {
        try {
          const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
          const rel = urlPath.replace(/^\/+/, '');
          const filePath = path.normalize(path.join(timestreamsPackRoot, rel));
          if (!filePath.startsWith(timestreamsPackRoot)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }
          if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            // try index / manifest for bare dirs
            const asManifest = path.join(filePath, 'manifest.json');
            if (fs.existsSync(asManifest) && fs.statSync(asManifest).isFile()) {
              res.setHeader('Content-Type', 'application/json');
              res.end(fs.readFileSync(asManifest));
              return;
            }
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(fs.readFileSync(filePath));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
    plugins: [
      react(),
      serveTimestreamsPack(),
      {
        name: 'strip-boardgame-debug-svelte',
        // 'pre' so this resolveId runs before Vite's core resolver in the dev
        // server; otherwise core resolve turns `./debug/Debug.svelte` into the
        // real Svelte file and import-analysis chokes on it.
        enforce: 'pre',
        resolveId(id) {
          if (id.includes('Debug.svelte') || id.includes('/client/debug/') || id.includes('boardgame.io/debug')) {
            return '\0empty-debug';
          }
        },
        load(id) {
          if (id === '\0empty-debug') {
            return 'export default null; export const Debug = null;';
          }
        },
      },
      viteSingleFile({ removeViteModuleLoader: true }),
    ], // strip debug + removeViteModuleLoader + IIFE for clean classic script on file://
    server: {
      port: 3000,
      fs: {
        allow: [
          path.resolve(__dirname, '../../..'),
          timestreamsPackRoot,
        ],
      },
    },
    // Absolute base for Vercel so /timestreams-pack/ resolves from site root.
    base: isVercelBuild ? '/' : './',
    resolve: {
        alias: [
            { find: '@tanstack/query-core', replacement: require.resolve('@tanstack/query-core') },
            { find: '@', replacement: path.resolve(__dirname, 'src') },
            { find: 'boardgame.io/react', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/react.ts') },
            { find: 'boardgame.io/multiplayer', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/multiplayer.ts') },
            { find: '@manamesh/timestreams', replacement: path.resolve(__dirname, '../../../timestreams') },
            { find: 'boardgame.io/core', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/core.ts') },
            { find: 'boardgame.io/internal', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/internal.ts') },
            { find: 'boardgame.io/master', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/master.ts') },
            { find: 'boardgame.io/client', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/client.ts') },
            { find: 'boardgame.io', replacement: path.resolve(__dirname, '../../../boardgame.io') },
            // Channel transport only (avoid loading PeerJS entry for app path)
            { find: '@cyotee/boardgameio-p2p/channel', replacement: path.resolve(__dirname, '../../../boardgameIO-p2p/src/channel-transport.ts') },
            { find: '@cyotee/boardgameio-p2p', replacement: path.resolve(__dirname, '../../../boardgameIO-p2p/src/index.ts') },
            { find: '@cyotee/boardgameio-crypto/mental-poker', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/mental-poker/index.ts') },
            { find: '@cyotee/boardgameio-crypto/sha256', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/sha256.ts') },
            { find: '@cyotee/boardgameio-crypto/stable-json', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/stable-json.ts') },
            { find: '@cyotee/boardgameio-crypto/ecdsa', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/ecdsa.ts') },
            { find: '@cyotee/boardgameio-crypto/secp256k1', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/secp256k1.ts') },
            { find: '@cyotee/boardgameio-crypto', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src') },
            // Exact bare react imports (use regex ^ $ to avoid prefix matching subpaths like react/jsx-runtime)
            { find: /^react$/, replacement: path.join(path.dirname(require.resolve('react/package.json')), 'index.js') },
            { find: 'react/jsx-runtime', replacement: path.join(path.dirname(require.resolve('react/package.json')), 'jsx-runtime.js') },
            { find: /^react-dom$/, replacement: path.join(path.dirname(require.resolve('react-dom/package.json')), 'index.js') },
            { find: 'react-dom/client', replacement: path.join(path.dirname(require.resolve('react-dom/package.json')), 'client.js') },
            // NOTE: boardgame.io's Svelte debug panel is stubbed via the
            // `strip-boardgame-debug-svelte` plugin (dev serve + build) and the
            // esbuild scan plugin below (dev dep-scan) — a regex resolve.alias
            // can't be used here because it does substring replacement and
            // mangles `./debug/Debug.svelte` into a bogus path.
        ],
    },
    optimizeDeps: {
        // Stub the boardgame.io Svelte debug import during esbuild's dependency
        // pre-scan (the vite/rollup `strip-boardgame-debug-svelte` plugin does
        // not run in this phase). Maps the whole import to a real .js stub.
        esbuildOptions: {
            plugins: [
                {
                    name: 'stub-svelte-debug',
                    setup(build) {
                        build.onResolve({ filter: /Debug\.svelte|\/client\/debug\/|boardgame\.io\/debug/ }, () => ({ path: emptyDebugStub }));
                    },
                },
            ],
        },
        include: [
            '@rainbow-me/rainbowkit',
            'wagmi',
            'viem',
            '@tanstack/react-query',
            '@tanstack/query-core',
            'react/jsx-runtime',
            'react',
            'react-dom',
        ],
    },
    build: {
        outDir: rootDist,
        // Vercel build: clean folder. Local monorepo dist: keep zip / other artifacts.
        emptyOutDir: isVercelBuild,
        assetsInlineLimit: 100000000,
        cssCodeSplit: false,
        rollupOptions: {
            // Only the timestreams SPA entry. Single file output.
            input: {
                timestreams: path.resolve(__dirname, 'src/pages/timestreams/index.html'),
            },
            output: {
                format: 'iife',
                inlineDynamicImports: true,
                manualChunks: undefined,
            },
            external(id) {
                // Avoid pulling in boardgame.io debug svelte files (no svelte plugin; debug not needed for prod SPA)
                if (id.includes('Debug.svelte') || id.includes('/client/debug/') || id.includes('boardgame.io/debug')) return true;
                return false;
            },
        },
    },
    test: {
        setupFiles: ['./vitest.setup.ts'],
    },
}));