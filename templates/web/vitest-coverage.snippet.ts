// SPDX-License-Identifier: Apache-2.0
// Coverage block for vite.config.ts (test.coverage). 100 % on all four metrics; the run fails below.
// Exclusions are files that contain no logic (entry point mounting React, generated API client) and each one carries
// its justification here. Anything else is tested. `/* v8 ignore next */` needs a `// coverage: <why>` line above it.
coverage: {
  provider: 'v8',
  include: ['src/**/*.{ts,tsx}', 'ee/**/*.{ts,tsx}'],
  exclude: [
    'src/**/*.test.{ts,tsx}',
    'ee/**/*.test.{ts,tsx}',
    'src/test/**',
    'src/main.tsx', // coverage: mounts <App/> into #root, exercised by the Playwright e2e only
    'src/shared/api/generated/**', // coverage: generated from ostrom-core's API contract
    '**/*.d.ts',
  ],
  reporter: ['text', 'json-summary', 'html', 'lcov'],
  thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
},
