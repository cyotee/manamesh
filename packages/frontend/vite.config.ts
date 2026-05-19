/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
    plugins: [react()],
    server: { port: 3000 },
    resolve: {
        alias: {
            '@tanstack/query-core': require.resolve('@tanstack/query-core'),
            '@': path.resolve(__dirname, 'src'),
        },
    },
    optimizeDeps: {
        include: [
            '@rainbow-me/rainbowkit',
            'wagmi',
            'viem',
            '@tanstack/react-query',
            '@tanstack/query-core',
        ],
    },
    build: {
        assetsInlineLimit: 0,
        cssCodeSplit: true,
        rollupOptions: {
            input: {
                'dev-console': path.resolve(__dirname, 'src/pages/dev-console/index.html'),
                'war': path.resolve(__dirname, 'src/pages/war/index.html'),
                'poker': path.resolve(__dirname, 'src/pages/poker/index.html'),
                'onepiece': path.resolve(__dirname, 'src/pages/onepiece/index.html'),
                'gofish': path.resolve(__dirname, 'src/pages/gofish/index.html'),
                'simple': path.resolve(__dirname, 'src/pages/simple/index.html'),
                'merkle-battleship': path.resolve(__dirname, 'src/pages/merkle-battleship/index.html'),
                'threshold-tally': path.resolve(__dirname, 'src/pages/threshold-tally/index.html'),
            },
            output: {
                manualChunks: (id) => {
                    if (id.includes('/src/crypto/')) return 'manamesh-crypto';
                    if (id.includes('/src/p2p/')) return 'manamesh-p2p';
                    if (id.includes('/src/assets/')) return 'manamesh-assets';
                    if (id.includes('/src/deck/')) return 'manamesh-deck';
                    if (id.includes('boardgame.io')) return 'vendor-bgio';
                    if (id.includes('libp2p')) return 'vendor-libp2p';
                    if (id.includes('helia')) return 'vendor-helia';
                    if (id.includes('elliptic') || id.includes('/node_modules/elliptic/')) return 'vendor-crypto-libs';
                    if (id.includes('viem') || id.includes('wagmi') || id.includes('@rainbow-me')) return 'vendor-web3';
                },
            },
        },
    },
    test: {
        setupFiles: ['./vitest.setup.ts'],
    },
}));