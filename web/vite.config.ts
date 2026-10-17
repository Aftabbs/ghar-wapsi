import { defineConfig } from 'vite';

// Served from https://aftabbs.github.io/ghar-wapsi/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/ghar-wapsi/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
