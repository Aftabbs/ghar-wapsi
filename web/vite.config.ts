import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages serves a project site under its repository name: /<repo>/.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'homeward';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? `/${repo}/` : '/',
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
