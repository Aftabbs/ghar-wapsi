import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Served from https://aftabbs.github.io/ghar-wapsi/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/ghar-wapsi/' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        methods: resolve(import.meta.dirname, 'methods.html'),
      },
    },
  },
});
