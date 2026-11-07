/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Recorded tool decisions (C1-F card):
// - Vite as the React build tool: standard for the role default stack, no
//   configuration beyond the dev-time /api proxy to the NestJS server.
// - The proxy is dev-only; production serving/reverse-proxying is not part
//   of this slice (no deployment in this card).
// - vitest with jsdom for unit tests: same "fast unit, no browser" posture
//   as the server slice; Playwright-style e2e is a later card's concern.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
