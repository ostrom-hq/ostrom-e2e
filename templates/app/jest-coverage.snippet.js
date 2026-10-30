// SPDX-License-Identifier: Apache-2.0
// Coverage settings for jest.config.js of ostrom-app (jest-expo preset). 100 % on all four metrics; jest exits non-zero
// below. Each excluded path carries its justification. `/* istanbul ignore next */` needs a `// coverage: <why>` above.
module.exports = {
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    'ee/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/*.d.ts',
    '!src/shared/api/generated/**', // coverage: generated from ostrom-core's API contract
  ],
  coverageReporters: ['text', 'json-summary', 'html', 'lcov'],
  coverageThreshold: { global: { lines: 100, branches: 100, functions: 100, statements: 100 } },
};
