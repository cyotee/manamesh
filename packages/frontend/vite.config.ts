/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

// Compute path to repo root dist/ so the single SPA lands next to the asset zip.
const rootDist = path.resolve(__dirname, '../../../../dist');

export default defineConfig(({ command }) => ({
    plugins: [
      react(),
      {
        name: 'strip-boardgame-debug-svelte',
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
    server: { port: 3000 },
    base: './',
    resolve: {
        alias: [
            { find: '@tanstack/query-core', replacement: require.resolve('@tanstack/query-core') },
            { find: '@', replacement: path.resolve(__dirname, 'src') },
            { find: 'boardgame.io/react', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/react.ts') },
            { find: 'boardgame.io/multiplayer', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/multiplayer.ts') },
            { find: '@manamesh/timestreams', replacement: path.resolve(__dirname, '../../../timestreams') },
            { find: 'boardgame.io/core', replacement: path.resolve(__dirname, '../../../boardgame.io/packages/core.ts') },
            { find: 'boardgame.io', replacement: path.resolve(__dirname, '../../../boardgame.io') },
            { find: '@manamesh/boardgameio-crypto/mental-poker', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/mental-poker/index.ts') },
            { find: '@manamesh/boardgameio-crypto/sha256', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/sha256.ts') },
            { find: '@manamesh/boardgameio-crypto/stable-json', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/stable-json.ts') },
            { find: '@manamesh/boardgameio-crypto/ecdsa', replacement: path.resolve(__dirname, '../../../boardgameio-crypto/src/ecdsa.ts') },
            { find: '@manamesh/boardgameio-crypto', replacement: path.resolve(__dirname, '../../../boardgameio-crypto') },
            // Exact bare react imports (use regex ^ $ to avoid prefix matching subpaths like react/jsx-runtime)
            { find: /^react$/, replacement: path.join(path.dirname(require.resolve('react/package.json')), 'index.js') },
            { find: 'react/jsx-runtime', replacement: path.join(path.dirname(require.resolve('react/package.json')), 'jsx-runtime.js') },
            { find: /^react-dom$/, replacement: path.join(path.dirname(require.resolve('react-dom/package.json')), 'index.js') },
            { find: 'react-dom/client', replacement: path.join(path.dirname(require.resolve('react-dom/package.json')), 'client.js') },
            // Kill boardgame.io debug svelte to prevent stray import statements in bundle (breaks classic script on file://)
            { find: /Debug\.svelte|\/debug\/Debug|boardgame\.io\/debug/, replacement: 'data:text/javascript,export default null;' },
        ],
    },
    optimizeDeps: {
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
        emptyOutDir: false, // preserve zip and other files in dist/
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