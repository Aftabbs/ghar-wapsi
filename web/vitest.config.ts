import { defineConfig } from 'vitest/config';

// Unit tests only; browser tests in e2e/ run under Playwright.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
