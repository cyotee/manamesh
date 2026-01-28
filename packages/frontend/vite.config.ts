/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        // Only use singlefile plugin for production builds
        command === 'build' ? viteSingleFile() : null,
    ].filter(Boolean),
    server: { port: 3000 },
    build: {
        // Inline all assets for single-file output
        assetsInlineLimit: 100000000, // 100MB - inline everything
        cssCodeSplit: false,
        rollupOptions: {
            output: {
                // Prevent code splitting
                manualChunks: undefined,
                inlineDynamicImports: true,
            },
        },
    },
    test: {
        setupFiles: ['./vitest.setup.ts'],
    },
}));