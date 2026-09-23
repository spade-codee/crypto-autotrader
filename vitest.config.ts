import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Seventeen test files each start their own PGlite — Postgres in WebAssembly.
    // Left to one worker per core, a 16-core machine starts them all at once and
    // the slowest time out under load. Four workers run the suite just as fast
    // (47–49 s against 48 s, measured 2026-09-23) with a fraction of the peak
    // load. The CI workflow narrows it further with --maxWorkers=2.
    maxWorkers: 4,
  },
});
