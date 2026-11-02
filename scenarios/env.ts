// SPDX-License-Identifier: Apache-2.0
// What the bench was given by the CI (or a developer): the running server, the `ostrom` binary. A scenario that needs
// something missing is skipped with the reason, and stays « bloqué » in SCENARIOS.md until the piece exists.
export const SERVER_URL = process.env['OSTROM_E2E_SERVER_URL'] ?? '';
export const CLI_BIN = process.env['OSTROM_E2E_CLI_BIN'] ?? '';
export const FAKE_CLAUDE = new URL('../bin/fake-claude', import.meta.url).pathname;
export const FAKE_CODEX = new URL('../bin/fake-codex', import.meta.url).pathname;
// Where the server writes its sign-in mails (OSTROM_MAIL_DIR, mounted from the runner), and the Stripe webhook secret
// it was started with (a test value of the bench, never a real one).
export const MAIL_DIR = process.env['OSTROM_E2E_MAIL_DIR'] ?? '';
export const STRIPE_WEBHOOK_SECRET = process.env['OSTROM_E2E_STRIPE_WEBHOOK_SECRET'] ?? '';
// The port the fake GitHub of the identity scenarios listens on: the server was started pointing at it
// (OSTROM_GITHUB_WEB_URL and OSTROM_GITHUB_API_URL = http://127.0.0.1:<port>), with a fake OAuth client.
export const FAKE_GITHUB_PORT = Number(process.env['OSTROM_E2E_FAKE_GITHUB_PORT'] ?? '0');
// The console's origin, the only one a browser session may write from (OSTROM_CONSOLE_URL of the bench's server, audit
// S2-08, ostrom-server#58). The bench is plain HTTP, so the session cookie has no `__Host-` prefix (HTTPS only).
export const CONSOLE_ORIGIN = process.env['OSTROM_E2E_CONSOLE_ORIGIN'] ?? 'http://127.0.0.1:4600';
// The superuser URL of the bench's `ostrom` database: only to age a session (AUTH-007), never to make data.
export const DATABASE_ADMIN_URL = process.env['OSTROM_E2E_DATABASE_ADMIN_URL'] ?? '';
