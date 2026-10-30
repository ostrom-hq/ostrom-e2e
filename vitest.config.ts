// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

// Two projects: `unit` (the bench's own code, 100 % coverage like every Ostrom repository) and `e2e` (the full-stack
// scenarios of SCENARIOS.md, run against the real server, the real `ostrom` binary and the fake agent).
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'e2e',
          include: ['scenarios/**/*.e2e.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
