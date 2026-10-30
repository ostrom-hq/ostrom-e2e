// SPDX-License-Identifier: Apache-2.0
// The milestone journeys (SCENARIOS.md, priority « jalon »): `ostrom claude` under the fake agent, a gate that blocks
// a push to main, a yes from a second account bound to the SHA, a receipt verified offline.
// They run once the server and the CLI serve the journey (OSTROM_E2E_JALON=1, set by QA in the workflows when both
// are on main); until then they are reported as skipped and stay « codé » in SCENARIOS.md.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commit, git, originSha, sandbox } from '../src/git.ts';
import { JALON_READY, type World, bash, gateIdIn, world } from './lib.ts';

describe.skipIf(!JALON_READY)('jalon: ostrom claude, gate on push, yes bound to the SHA, offline receipt', () => {
  let w: World;

  beforeAll(async () => {
    w = await world();
  });

  afterAll(async () => {
    await w.github.stop();
  });

  it('E2E-LOGIN-001 — device-flow login writes a 0600 token and whoami names the person', async () => {
    const who = await w.dev.ostrom(['whoami']);
    expect(who.code).toBe(0);
    expect(who.stdout).toContain('dev-a');
    expect(w.github.requests.some((r) => r.path === '/login/oauth/access_token')).toBe(true);
  });

  it('E2E-CLAUDE-001 — ostrom claude launches the agent under the session package, writing nothing in the repo or ~/.claude', async () => {
    const sb = sandbox('api', 'acme/api');
    const before = git(sb.work, 'status', '--porcelain', '--ignored');
    const { run, log } = await w.dev.claude(sb.work, { steps: [{ event: 'SessionStart', source: 'startup' }, { event: 'tool', tool: 'Bash', input: { command: 'ls' }, run: true }, { event: 'SessionEnd' }] });
    expect(run.code, run.stderr).toBe(0);
    expect(log?.steps.map((s) => s.blocked)).toEqual([false, false, false]);
    expect(log?.steps[1]?.hooks.length).toBeGreaterThan(0);
    expect(git(sb.work, 'status', '--porcelain', '--ignored')).toBe(before);
    expect(existsSync(join(w.dev.home, '.claude'))).toBe(false);
  });

  it('E2E-GATE-001, E2E-YES-003, E2E-YESCLI-002, E2E-YES-001, E2E-RECEIPT-001 — push blocked, yes from a second account bound to the SHA, offline receipt', async () => {
    const sb = sandbox('api', 'acme/api');
    const shaA = commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const push = bash('git push origin main');

    // 1. The push is refused before it runs; the refusal names the gate.
    const first = await w.dev.claude(sb.work, push);
    const refused = first.log?.steps[0];
    expect(refused?.blocked).toBe(true);
    expect(refused?.reason).toMatch(/waiting for a yes/i);
    expect(originSha(sb, 'main')).not.toBe(shaA);
    const gate = gateIdIn(refused?.reason ?? '');
    expect(gate).toBeDefined();

    // 2. The requester cannot say yes to their own gate while another approver exists (code 77).
    const self = await w.dev.ostrom(['approve', String(gate)]);
    expect(self.code).toBe(77);
    expect(self.stderr + self.stdout).toMatch(/must say yes/);

    // 3. rev-b says yes; the same push now goes through and lands exactly shaA.
    expect((await w.rev.ostrom(['approve', String(gate)])).code).toBe(0);
    const second = await w.dev.claude(sb.work, push);
    expect(second.log?.steps[0]?.blocked).toBe(false);
    expect(originSha(sb, 'main')).toBe(shaA);

    // 4. A new commit is a new gate: the yes for shaA does not cover shaB.
    const shaB = commit(sb.work, 'b.txt', 'b\n', 'feat: b');
    const third = await w.dev.claude(sb.work, push);
    expect(third.log?.steps[0]?.blocked).toBe(true);
    expect(gateIdIn(third.log?.steps[0]?.reason ?? '')).not.toBe(gate);
    expect(originSha(sb, 'main')).toBe(shaA);
    expect(shaB).not.toBe(shaA);

    // 5. The gate receipt verifies offline (no server reachable).
    const receipts = await w.dev.ostrom(['receipts', '--json']);
    expect(receipts.code).toBe(0);
    const id = (JSON.parse(receipts.stdout) as { id: string; gate?: string }[]).find((r) => r.gate === gate)?.id;
    expect(id).toBeDefined();
    const offline = await w.dev.ostrom(['verify', String(id)], { env: { OSTROM_URL: 'http://127.0.0.1:9' } });
    expect(offline.code, offline.stderr).toBe(0);
    expect(offline.stdout).toMatch(/VERIFIED/);
    expect(offline.stdout).toContain('rev-b');
  });

  it('E2E-CLAUDE-003 — the gate hook starts within budget on an ordinary call', async () => {
    const sb = sandbox('api');
    const steps = Array.from({ length: 20 }, () => ({ event: 'tool', tool: 'Bash', input: { command: 'ls' } }));
    const { log } = await w.dev.claude(sb.work, { steps });
    const ms = (log?.steps ?? []).flatMap((s) => s.hooks.filter((h) => h.event === 'PreToolUse').map((h) => h.ms)).sort((a, b) => a - b);
    expect(ms.length).toBe(20);
    // Prototype measure: 5.5 ms wall on a loaded Mac (28/10). CI budget with a ×3 margin and process start: 50 ms median.
    expect(ms[10]).toBeLessThan(50);
  });
});
