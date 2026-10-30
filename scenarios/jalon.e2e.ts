// The milestone journeys (SCENARIOS.md, priority « jalon »): `ostrom claude` under the fake agent, a gate that blocks
// a push to main, a yes from a second account bound to the SHA, a receipt verified offline.
// They run once the server and the CLI serve the journey (OSTROM_E2E_JALON=1, set by QA in the workflows when both
// are on main); until then they are reported as skipped and stay « codé » in SCENARIOS.md.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/fake-github.ts';
import { commit, git, originSha, sandbox } from '../src/git.ts';
import { CLI_BIN, SERVER_URL } from './env.ts';
import { gateIdIn, login, type Person, person } from './lib.ts';

const READY = CLI_BIN !== '' && SERVER_URL !== '' && process.env['OSTROM_E2E_JALON'] === '1';

describe.skipIf(!READY)('jalon: ostrom claude, gate on push, yes bound to the SHA, offline receipt', () => {
  const github = new FakeGitHub();
  let dev: Person;
  let rev: Person;

  beforeAll(async () => {
    await github.start();
    dev = person('dev-a', github);
    rev = person('rev-b', github);
    // The organisation, its repository acme/api and the gate « push to main, approvers rev-b and rev-c (rev-c never logs in: two approvers, one active) » are created
    // through the real surfaces (login of the first member, invite, harness add + enforce): CLI.md § 3.1 and § 3.2.
    expect(login(dev, github).code).toBe(0);
    expect(dev.ostrom(['invite', '@rev-b', '@rev-c']).code).toBe(0);
    expect(login(rev, github).code).toBe(0);
    expect(dev.ostrom(['harness', 'add', 'git-safety', '--set', 'approvers=@rev-b,@rev-c', '--enforce']).code).toBe(0);
  });

  afterAll(async () => {
    await github.stop();
  });

  it('E2E-LOGIN-001 — device-flow login writes a 0600 token and whoami names the person', () => {
    const who = dev.ostrom(['whoami']);
    expect(who.code).toBe(0);
    expect(who.stdout).toContain('dev-a');
    expect(github.requests.some((r) => r.path === '/login/oauth/access_token')).toBe(true);
  });

  it('E2E-CLAUDE-001 — ostrom claude launches the agent under the session package, writing nothing in the repo or ~/.claude', () => {
    const sb = sandbox('api');
    const before = git(sb.work, 'status', '--porcelain', '--ignored');
    const { run, log } = dev.claude(sb.work, { steps: [{ event: 'SessionStart', source: 'startup' }, { event: 'tool', tool: 'Bash', input: { command: 'ls' }, run: true }, { event: 'SessionEnd' }] });
    expect(run.code, run.stderr).toBe(0);
    expect(log?.steps.map((s) => s.blocked)).toEqual([false, false, false]);
    expect(log?.steps[1]?.hooks.length).toBeGreaterThan(0);
    expect(git(sb.work, 'status', '--porcelain', '--ignored')).toBe(before);
    expect(existsSync(join(dev.home, '.claude'))).toBe(false);
  });

  it('E2E-GATE-001, E2E-YES-003, E2E-YESCLI-002, E2E-YES-001, E2E-RECEIPT-001 — push blocked, yes from a second account bound to the SHA, offline receipt', () => {
    const sb = sandbox('api');
    const shaA = commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const push = { steps: [{ event: 'tool', tool: 'Bash', input: { command: 'git push origin main' }, run: true }] };

    // 1. The push is refused before it runs; the refusal names the gate.
    const first = dev.claude(sb.work, push);
    const refused = first.log?.steps[0];
    expect(refused?.blocked).toBe(true);
    expect(refused?.reason).toMatch(/waiting for a yes/i);
    expect(originSha(sb, 'main')).not.toBe(shaA);
    const gate = gateIdIn(refused?.reason ?? '');
    expect(gate).toBeDefined();

    // 2. The requester cannot say yes to their own gate while another approver exists (code 77).
    const self = dev.ostrom(['approve', String(gate)]);
    expect(self.code).toBe(77);
    expect(self.stderr + self.stdout).toMatch(/must say yes/);

    // 3. rev-b says yes; the same push now goes through and lands exactly shaA.
    expect(rev.ostrom(['approve', String(gate)]).code).toBe(0);
    const second = dev.claude(sb.work, push);
    expect(second.log?.steps[0]?.blocked).toBe(false);
    expect(originSha(sb, 'main')).toBe(shaA);

    // 4. A new commit is a new gate: the yes for shaA does not cover shaB.
    const shaB = commit(sb.work, 'b.txt', 'b\n', 'feat: b');
    const third = dev.claude(sb.work, push);
    expect(third.log?.steps[0]?.blocked).toBe(true);
    expect(gateIdIn(third.log?.steps[0]?.reason ?? '')).not.toBe(gate);
    expect(originSha(sb, 'main')).toBe(shaA);
    expect(shaB).not.toBe(shaA);

    // 5. The gate receipt verifies offline (no server reachable).
    const receipts = dev.ostrom(['receipts', '--json']);
    expect(receipts.code).toBe(0);
    const id = (JSON.parse(receipts.stdout) as { id: string; gate?: string }[]).find((r) => r.gate === gate)?.id;
    expect(id).toBeDefined();
    const offline = dev.ostrom(['verify', String(id)], { env: { OSTROM_URL: 'http://127.0.0.1:9' } });
    expect(offline.code, offline.stderr).toBe(0);
    expect(offline.stdout).toMatch(/VERIFIED/);
    expect(offline.stdout).toContain('rev-b');
  });

  it('E2E-CLAUDE-003 — the gate hook starts within budget on an ordinary call', () => {
    const sb = sandbox('api');
    const steps = Array.from({ length: 20 }, () => ({ event: 'tool', tool: 'Bash', input: { command: 'ls' } }));
    const { log } = dev.claude(sb.work, { steps });
    const ms = (log?.steps ?? []).flatMap((s) => s.hooks.filter((h) => h.event === 'PreToolUse').map((h) => h.ms)).sort((a, b) => a - b);
    expect(ms.length).toBe(20);
    // Prototype measure: 5.5 ms wall on a loaded Mac (28/10). CI budget with a ×3 margin and process start: 50 ms median.
    expect(ms[10]).toBeLessThan(50);
  });
});
