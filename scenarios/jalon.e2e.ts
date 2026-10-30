// SPDX-License-Identifier: Apache-2.0
// The milestone journeys (SCENARIOS.md, priority « jalon »), against the real server image and the real `ostrom`
// binary: a real `ostrom login` approved from the browser, `ostrom claude` under the fake agent and the signed session
// package, a gate that blocks a push to main, a yes from a second account's browser bound to the SHA, the receipt.
// No switch to set: each describe probes the server and switches itself on the day its pieces are on main
// (login: ostrom-server#62 on top of ostrom-cli#40; journey: ostrom-server#43 and #26). Until then it is skipped, and
// the reason is in its title.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { commit, git, originSha, sandbox } from '../src/git.ts';
import { CLI_BIN, SERVER_URL } from './env.ts';
import {
  type Approval,
  type RealWorld,
  SECRET,
  answer,
  approvalFor,
  bash,
  deviceLogin,
  gateIdIn,
  journeyUnavailable,
  loginUnavailable,
  member,
  realWorld,
  receiptIdIn,
} from './lib.ts';
import { call, email, signIn } from './org.ts';

const reasonOf = async (probe: () => Promise<string>) => {
  try {
    return await probe();
  } catch (error) {
    return `probe failed: ${String(error)}`;
  }
};
const LOGIN_OFF = await reasonOf(loginUnavailable);
const JOURNEY_OFF = LOGIN_OFF || (await reasonOf(journeyUnavailable));
const skipped = (why: string) => (why ? ` [skipped: ${why}]` : '');

/** The CLI's top-level commands, read from `ostrom --help` (whoami and verify are not on ostrom-cli main yet). */
async function cliServes(command: string): Promise<boolean> {
  if (CLI_BIN === '' || SERVER_URL === '') return false;
  const { spawnSync } = await import('node:child_process');
  const help = spawnSync(CLI_BIN, ['--help'], { encoding: 'utf8', timeout: 10_000, env: { PATH: String(process.env['PATH']), NO_COLOR: '1' } });
  return new RegExp(`^\\s+${command}\\b`, 'm').test(`${help.stdout}${help.stderr}`);
}
const HAS_WHOAMI = await cliServes('whoami');
const HAS_VERIFY = await cliServes('verify');

const mode = (path: string) => statSync(path).mode & 0o777;

describe.skipIf(LOGIN_OFF !== '')(`jalon: real ostrom login${skipped(LOGIN_OFF)}`, () => {
  it('E2E-LOGIN-001 — device-flow login approved from the browser writes 0600 files, prints no secret, and the token speaks for the person', async () => {
    const m = await member(await signIn(email('dev-l')));
    const { run, userCode, answer: answered } = await deviceLogin(m.cli, m.browser);

    // The CLI showed a one-time code, the browser said yes to it, the CLI finished on its own.
    expect(userCode, run.stderr).toMatch(/^[A-Za-z0-9-]{1,32}$/);
    expect(answered, run.stderr).toBeLessThan(300);
    expect(run.code, run.stderr + run.stdout).toBe(0);
    expect(run.stdout).toContain(`@${m.login}`);
    expect(run.stdout + run.stderr).not.toMatch(SECRET);

    // What it wrote is the owner's only, and nothing in it reads in clear (the token is in the secret store: Keychain,
    // Secret Service, or `secrets.enc` encrypted under OSTROM_HOME on a Linux without one, ostrom-cli Secrets.kt).
    const home = m.cli.env['OSTROM_HOME'] ?? '';
    const credentials = join(home, 'credentials.json');
    expect(existsSync(credentials)).toBe(true);
    expect(mode(credentials)).toBe(0o600);
    expect(readFileSync(credentials, 'utf8')).toContain(m.login);
    expect(readFileSync(credentials, 'utf8')).not.toMatch(SECRET);
    const sealed = join(home, 'secrets.enc');
    if (existsSync(sealed)) {
      expect(mode(sealed)).toBe(0o600);
      expect(readFileSync(sealed, 'latin1')).not.toMatch(SECRET);
    }

    // The server issued a CLI token to this person (listed from their browser, never with its secret).
    const tokens = await call(m.browser.caller, 'GET', '/api/v1/tokens');
    expect(tokens.status).toBe(200);
    expect(JSON.stringify(tokens.body)).toMatch(/"kind":"cli"/i);
    expect(JSON.stringify(tokens.body)).not.toMatch(SECRET);

    // The token speaks for the person: `whoami` names them where the CLI has it; else a command that calls the server
    // with the token (`ostrom inbox`, GET /api/v1/approvals) succeeds.
    if (HAS_WHOAMI) {
      const who = await m.cli.ostrom(['whoami']);
      expect(who.code, who.stderr).toBe(0);
      expect(who.stdout).toContain(m.login);
      expect(who.stdout + who.stderr).not.toMatch(SECRET);
    } else {
      const inbox = await m.cli.ostrom(['inbox']);
      expect(inbox.code, inbox.stderr + inbox.stdout).toBe(0);
      expect(inbox.stdout + inbox.stderr).not.toMatch(SECRET);
    }
  }, 180_000);
});

describe.skipIf(JOURNEY_OFF !== '')(`jalon: ostrom claude, gate on push, yes from the browser bound to the SHA, receipt${skipped(JOURNEY_OFF)}`, () => {
  let w: RealWorld;
  let receipt: string | undefined;
  let gate: string | undefined;

  beforeAll(async () => {
    w = await realWorld();
  }, 240_000);

  it('E2E-CLAUDE-001 — ostrom claude launches the agent under the session package, writing nothing in the repo or ~/.claude', async () => {
    const sb = sandbox('api', w.repo);
    const before = git(sb.work, 'status', '--porcelain', '--ignored');
    const { run, log } = await w.dev.cli.claude(sb.work, { steps: [{ event: 'SessionStart', source: 'startup' }, { event: 'tool', tool: 'Bash', input: { command: 'ls' }, run: true }, { event: 'SessionEnd' }] });
    expect(run.code, run.stderr).toBe(0);
    expect(log?.steps.map((s) => s.blocked)).toEqual([false, false, false]);
    expect(log?.steps[1]?.hooks.length).toBeGreaterThan(0);
    expect(git(sb.work, 'status', '--porcelain', '--ignored')).toBe(before);
    expect(existsSync(join(w.dev.cli.home, '.claude'))).toBe(false);

    // The server kept the session (ostrom-server#26): this dev, this repo, ended, with its signed end receipt.
    const sessions = await call(w.dev.browser.caller, 'GET', '/api/v1/sessions');
    expect(sessions.status, JSON.stringify(sessions.body)).toBe(200);
    const mine = ((sessions.body['items'] as Record<string, unknown>[] | undefined) ?? []).filter((s) => s['repo'] === w.repo);
    expect(mine.length).toBeGreaterThan(0);
    const ended = mine.find((s) => s['ended'] === true || typeof s['endedAt'] === 'string');
    expect(ended, JSON.stringify(mine)).toBeDefined();
    expect(typeof ended?.['receiptId']).toBe('string');
    expect(typeof ended?.['packageDigest']).toBe('string');
  }, 120_000);

  it('E2E-GATE-001, E2E-YES-003, E2E-YESCLI-002, E2E-YES-001 — push blocked, the requester cannot say yes, a yes from a second account\'s browser lets exactly that SHA through', async () => {
    const sb = sandbox('api', w.repo);
    const shaA = commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const push = bash('git push origin main');

    // 1. The push is refused before it runs; the refusal names the request to wait for.
    const first = await w.dev.cli.claude(sb.work, push);
    const refused = first.log?.steps[0];
    expect(refused?.blocked, first.run.stderr).toBe(true);
    expect(refused?.reason).toMatch(/waiting for a yes/i);
    expect(originSha(sb, 'main')).not.toBe(shaA);
    gate = gateIdIn(refused?.reason ?? '');
    expect(gate).toBeDefined();

    // 2. E2E-YES-003: the requester, approver too, says yes from a fresh browser session: 403, naming the other
    // approver who must say yes (SelfApprovalRefusedException, ostrom-server#41), and the request stays pending.
    const own = (await approvalFor(await w.dev.fresh(), String(gate))) as Approval;
    expect(own, 'the requester is an approver of the gate: it has its own request').toBeDefined();
    const self = await answer(w.dev.browser, own);
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(JSON.stringify(self.body)).toMatch(/must say yes|cannot approve/i);
    expect(JSON.stringify(self.body)).toContain(w.rev.login);
    expect((await approvalFor(w.dev.browser, String(gate)))?.id).toBe(own.id);

    // 3. E2E-YESCLI-002, as the real CLI serves it: `ostrom approve` never answers (it opens the console page, where a
    // browser says yes, ostrom-cli ApprovalCommands.kt), and a token can never say yes (ostrom-server#41). The
    // requester's own token answering its request is refused, and nothing moves.
    const pat = await call(w.dev.browser.caller, 'POST', '/api/v1/tokens', { name: 'e2e requester', scopes: ['gates:ask', 'gates:read'], expiresInDays: 1 });
    expect(pat.status, JSON.stringify(pat.body)).toBe(201);
    const byToken = await call({ token: String(pat.body['secret']) }, 'POST', `/api/v1/approvals/${encodeURIComponent(own.id)}/answer`, { answer: 'approve', shownDigest: own.shownDigest });
    expect(byToken.status, JSON.stringify(byToken.body)).toBe(403);
    expect(originSha(sb, 'main')).not.toBe(shaA);

    // 4. rev-b says yes from its browser, signed in less than 5 minutes ago (step-up, ostrom-server#41), with the
    // digest it was shown; the same push now goes through and lands exactly shaA.
    const theirs = (await approvalFor(await w.rev.fresh(), String(gate))) as Approval;
    expect(theirs).toBeDefined();
    const yes = await answer(w.rev.browser, theirs);
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    const second = await w.dev.cli.claude(sb.work, push);
    expect(second.log?.steps[0]?.blocked, second.log?.steps[0]?.reason).toBe(false);
    expect(originSha(sb, 'main')).toBe(shaA);
    receipt = receiptIdIn(yes.body) ?? receiptIdIn(second.log?.steps[0]?.reason ?? '');

    // 5. E2E-YES-001: a new commit is a new request: the yes for shaA does not cover shaB.
    const shaB = commit(sb.work, 'b.txt', 'b\n', 'feat: b');
    const third = await w.dev.cli.claude(sb.work, push);
    expect(third.log?.steps[0]?.blocked).toBe(true);
    expect(gateIdIn(third.log?.steps[0]?.reason ?? '')).not.toBe(gate);
    expect(originSha(sb, 'main')).toBe(shaA);
    expect(shaB).not.toBe(shaA);

    // 6. The receipt of the yes is on the server, names the approver and the SHA it was given for.
    expect(receipt, JSON.stringify(yes.body)).toBeDefined();
    const kept = await call(w.dev.browser.caller, 'GET', `/api/v1/receipts/${encodeURIComponent(String(receipt))}`);
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(JSON.stringify(kept.body)).toContain(w.rev.login);
    expect(JSON.stringify(kept.body)).toContain(shaA);
  }, 300_000);

  it.skipIf(!HAS_VERIFY)(`E2E-RECEIPT-001 — the gate receipt verifies offline (no server reachable)${HAS_VERIFY ? '' : ' [skipped: no `ostrom verify` in the CLI yet]'}`, async () => {
    expect(receipt, 'E2E-GATE-001 gave a receipt').toBeDefined();
    const offline = await w.dev.cli.ostrom(['verify', String(receipt)], { env: { OSTROM_URL: 'http://127.0.0.1:9' } });
    expect(offline.code, offline.stderr).toBe(0);
    expect(offline.stdout).toMatch(/VERIFIED/);
    expect(offline.stdout).toContain(w.rev.login);
  }, 60_000);

  it('E2E-CLAUDE-003 — the gate hook starts within budget on an ordinary call', async () => {
    const sb = sandbox('api');
    const steps = Array.from({ length: 20 }, () => ({ event: 'tool', tool: 'Bash', input: { command: 'ls' } }));
    const { log } = await w.dev.cli.claude(sb.work, { steps });
    const ms = (log?.steps ?? []).flatMap((s) => s.hooks.filter((h) => h.event === 'PreToolUse').map((h) => h.ms)).sort((a, b) => a - b);
    expect(ms.length).toBe(20);
    // Prototype measure: 5.5 ms wall on a loaded Mac (28/10). CI budget with a ×3 margin and process start: 50 ms median.
    expect(ms[10]).toBeLessThan(50);
  }, 120_000);
});
