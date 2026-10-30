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
