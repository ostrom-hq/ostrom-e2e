// What the bench was given by the CI (or a developer): the running server, the `ostrom` binary. A scenario that needs
// something missing is skipped with the reason, and stays « bloqué » in SCENARIOS.md until the piece exists.
export const SERVER_URL = process.env['OSTROM_E2E_SERVER_URL'] ?? '';
export const CLI_BIN = process.env['OSTROM_E2E_CLI_BIN'] ?? '';
export const FAKE_CLAUDE = new URL('../bin/fake-claude', import.meta.url).pathname;
export const FAKE_CODEX = new URL('../bin/fake-codex', import.meta.url).pathname;
