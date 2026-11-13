// SPDX-License-Identifier: Apache-2.0
// Bypass attempts from the audit of the gate (SCENARIOS.md, family BYPASS, priority « jalon »; PARCOURS 5.3 « Action
// protégée : la porte s'ouvre »): each one is a real command the fake agent runs, under the real `ostrom run claude`, in a
// git sandbox; the assertion is on what reached the bare origin and on the hook's refusal, not on a message. They play
// in the milestone's world (`realWorld()`: people signed in by their e-mailed link, the real `ostrom login`, the gate
// « push to main » made by a workflow) and switch themselves on with jalon.e2e.ts: when the server or the CLI is
// missing, the describe is skipped and its title names what is missing. E2E-BYPASS-034 follows a refusal made by the
// hook alone into the organisation's audit log (`gate.denied_locally`, ostrom-server#333, ostrom-cli#125, audit A6).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { commit, git, originSha, sandbox } from '../src/git.ts';
import { type Approval, type RealWorld, answer, approvalFor, bash, gateIdIn, journeyUnavailable, realWorld } from './lib.ts';
import { call, email, orgOf, signIn } from './org.ts';

const OFF = await journeyUnavailable().catch((error: unknown) => `probe failed: ${String(error)}`);
const title = `bypass attempts on the gate « push to main »${OFF ? ` [skipped: ${OFF}; PARCOURS 5.3]` : ''}`;

/** One agent session: SessionStart (the session the gate asks in), then each command, run for real unless blocked. */
const session = (...commands: string[]) => ({ steps: [{ event: 'SessionStart', source: 'startup' }, ...commands.flatMap((c) => bash(c).steps)] });

/** A line of an organisation's audit log (`GET /api/v1/audit`, contract `AuditEvent`). */
type AuditLine = { event: string; actor: string; subject: string; meta: Record<string, string>; integrity: string; hash: string; signature: string } & Record<string, unknown>;

const linesOf = (body: Record<string, unknown>) => (body['items'] as AuditLine[] | undefined) ?? [];

describe.skipIf(OFF !== '')(title, () => {
  let w: RealWorld;

  beforeAll(async () => {
    w = await realWorld();
  }, 240_000);

  /** Plays `commands` in one session of dev-a; each one's refusal and the gate its reason names, in order. */
  const attempts = async (cwd: string, commands: string[]) => {
    const { run, log } = await w.dev.cli.claude(cwd, session(...commands), ['--repo', w.repo]);
    return commands.map((command, i) => {
      const step = log?.steps[i + 1];
      return { command, blocked: step?.blocked === true, gate: gateIdIn(step?.reason ?? ''), why: `${command}: ${step?.reason ?? run.stderr}` };
    });
  };

  it('E2E-BYPASS-001 — options before the verb `push` still ask for the gate', async () => {
    const sb = sandbox('api', w.repo);
    const before = originSha(sb, 'main');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const spaced = `${sb.root}/my work`;
    git(sb.root, 'clone', '-q', sb.origin, spaced);
    git(spaced, 'remote', 'set-url', 'origin', `https://github.com/${w.repo}.git`);
    git(spaced, 'config', `url.${sb.origin}.pushInsteadOf`, `https://github.com/${w.repo}.git`);
    commit(spaced, 'b.txt', 'b\n', 'feat: b');
    const results = [
      ...(await attempts(sb.work, [
        `git -C ${sb.work} push origin main`,
        'git -c core.sshCommand=ssh push origin main',
        'git --no-pager push origin main',
        `git --git-dir ${sb.work}/.git push origin main`,
      ])),
      // A quoted path with a space, from a session opened in that checkout: the gate of main.
      ...(await attempts(spaced, [`git -C "${spaced}" push origin HEAD:main`])),
    ];
    // Each one is refused before it runs: either it asks for the gate of main (a request to say yes to), or the CLI
    // denies it outright, without asking, because it cannot tie a yes to what git would really send (`-c …`,
    // `--git-dir`: « Ostrom: denied »). Never through.
    for (const r of results) {
      expect(r.blocked, r.why).toBe(true);
      expect(r.gate !== undefined || /Ostrom: denied/.test(r.why), r.why).toBe(true);
    }
    // The plain forms ask for the gate.
    expect(results[0]?.gate, results[0]?.why).toBeDefined();
    expect(results[2]?.gate, results[2]?.why).toBeDefined();
    // From a session opened in another checkout, the same push is denied outright: the session's gates do not cover it.
    const [elsewhere] = await attempts(sb.work, [`git -C "${spaced}" push origin HEAD:main`]);
    expect(elsewhere?.blocked, elsewhere?.why).toBe(true);
    expect(elsewhere?.why).toMatch(/do not cover/);
    expect(originSha(sb, 'main')).toBe(before);
  }, 180_000);

  it('E2E-BYPASS-005 — the yes of an ordinary push never covers a force-push of the same commit', async () => {
    const sb = sandbox('api', w.repo);
    const before = originSha(sb, 'main');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    // One session: the ordinary push is refused and waits; the same push read through a pipe finds the same request;
    // rev-b says yes to it from the browser; then, in the same session (a yes holds for its session), each force-push of
    // the same commit is refused again, on a request of its own.
    const go = join(sb.root, 'go');
    const forced = ['git push --force origin main', 'git push -f origin main', 'git push origin +main', 'git push --force-with-lease origin main', 'git push -uf origin main'];
    const commands = ['git push origin main', 'git push origin main 2>&1 | tail -n 5', `while [ ! -f '${go}' ]; do sleep 1; done`, ...forced];
    const running = w.dev.cli.claude(sb.work, session(...commands), ['--repo', w.repo]);
    try {
      let mine: Approval | undefined;
      for (let i = 0; i < 60 && mine === undefined; i++) {
        const r = await call(w.dev.browser.caller, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50');
        mine = ((r.body['items'] as Approval[] | undefined) ?? [])[0];
        if (mine === undefined) await new Promise((done) => setTimeout(done, 1000));
      }
      expect(mine, 'the refused push opened a request').toBeDefined();
      const theirs = (await approvalFor(await w.rev.fresh(), String(mine?.group ?? mine?.gate ?? mine?.id))) as Approval;
      expect(theirs, 'rev-b has its own request for the push').toBeDefined();
      const yes = await answer(w.rev.browser, theirs);
      expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    } finally {
      writeFileSync(go, '');
    }
    const { run, log } = await running;
    const step = (i: number) => log?.steps[i + 1];
    const first = step(0);
    expect(first?.blocked, first?.reason ?? run.stderr).toBe(true);
    const gate = gateIdIn(first?.reason ?? '');
    expect(gate, first?.reason).toBeDefined();
    expect(gateIdIn(step(1)?.reason ?? ''), step(1)?.reason).toBe(gate);
    forced.forEach((command, k) => {
      const s = step(3 + k);
      expect(s?.blocked, `${command}: ${s?.reason ?? run.stderr}`).toBe(true);
      expect(gateIdIn(s?.reason ?? ''), `${command}: ${s?.reason}`).not.toBe(gate);
    });
    expect(originSha(sb, 'main')).toBe(before);
  }, 300_000);

  it('E2E-BYPASS-024 — a push that lands on main without naming it opens the gate of main', async () => {
    const sb = sandbox('api', w.repo);
    const before = originSha(sb, 'main');
    git(sb.work, 'branch', '--set-upstream-to=origin/main', 'main');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const results = await attempts(sb.work, ['git push origin HEAD', 'git push', 'git -c push.default=matching push origin', 'git -c remote.origin.push=refs/heads/main:refs/heads/main push origin']);
    for (const r of results) expect(r.blocked, r.why).toBe(true);
    expect(originSha(sb, 'main')).toBe(before);
  }, 180_000);

  it('E2E-BYPASS-034 — a push the hook refuses on the workstation is written to its organisation’s audit log as gate.denied_locally, and to no other', async () => {
    const sb = sandbox('api', w.repo);
    const before = originSha(sb, 'main');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    // `--git-dir` changes where git reads: the hook cannot tie a yes to what git would send, so it refuses outright,
    // without asking Ostrom (GateTexts.redirected), then tells Ostrom once (POST /api/v1/gates/local-denials).
    const command = `git --git-dir ${sb.work}/.git push origin main`;
    const [refused] = await attempts(sb.work, [command]);
    expect(refused?.blocked, refused?.why).toBe(true);
    expect(refused?.gate, refused?.why).toBeUndefined();
    expect(refused?.why).toMatch(/Ostrom: denied/);
    expect(originSha(sb, 'main')).toBe(before);

    // The owner reads the organisation's audit log: one signed line for this very command (other scenarios of the
    // file refuse pushes of their own sandboxes in the same organisation). The hook does not wait for the answer:
    // the line is read until it is there, for 15 s at most.
    const mine = (body: Record<string, unknown>) => linesOf(body).filter((l) => (l.meta?.['command'] ?? '').includes(`${sb.work}/.git`));
    const path = '/api/v1/audit?event=gate.denied_locally';
    let log = await call(w.dev.browser.caller, 'GET', path);
    for (let i = 0; i < 30 && log.status === 200 && mine(log.body).length === 0; i++) {
      await new Promise((done) => setTimeout(done, 500));
      log = await call(w.dev.browser.caller, 'GET', path);
    }
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    const found = mine(log.body);
    expect(found.length, `a gate.denied_locally line for « ${command} » in ${JSON.stringify(log.body)}`).toBe(1);
    const line = found[0] as AuditLine;
    const id = line.meta['session'] ?? '';
    expect(line.event).toBe('gate.denied_locally');
    expect(id, JSON.stringify(line)).not.toBe('');
    expect(line.subject).toBe(`session:${id}`);
    expect(line.meta['class'], JSON.stringify(line)).toBe('push-main');
    expect(line.meta['reason'], JSON.stringify(line)).toBe('redirected');
    expect(line.meta['repo'], JSON.stringify(line)).toBe(w.repo);
    expect(line.meta['command'], JSON.stringify(line)).toContain('--git-dir');
    expect(line.meta['command'], JSON.stringify(line)).toContain('push origin main');
    // Written by the session's credential (the launch's agent token, or dev-a's own), signed in the org's chain.
    expect(line.actor === w.dev.login || /^agent:/.test(line.actor), JSON.stringify(line)).toBe(true);
    expect(line.integrity, JSON.stringify(line)).toBe('verified');
    expect(line.hash, JSON.stringify(line)).toMatch(/^[0-9a-f]{64}$/);
    expect(line.signature, JSON.stringify(line)).not.toBe('');
    // The session it names is dev-a's, in this organisation.
    const theSession = await call(w.dev.browser.caller, 'GET', `/api/v1/sessions/${encodeURIComponent(id)}`);
    expect(theSession.status, JSON.stringify(theSession.body)).toBe(200);

    // Another organisation sees none of it: nothing in its own log, a 404 when it names the first one, and a 404 on
    // the session.
    const zoe = await signIn(email('zoe'));
    const theirOrg = await orgOf(zoe);
    expect(theirOrg.id).not.toBe(w.orgId);
    const theirs = await call(zoe.caller, 'GET', path);
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    expect(linesOf(theirs.body)).toEqual([]);
    const everything = await call(zoe.caller, 'GET', '/api/v1/audit');
    expect(everything.status, JSON.stringify(everything.body)).toBe(200);
    expect(JSON.stringify(everything.body)).not.toContain(id);
    expect(JSON.stringify(everything.body)).not.toContain(sb.work);
    const naming = await call({ ...zoe.caller, org: w.orgId }, 'GET', path);
    expect(naming.status, JSON.stringify(naming.body)).toBe(404);
    expect(JSON.stringify(naming.body ?? '')).not.toContain(id);
    expect((await call(zoe.caller, 'GET', `/api/v1/sessions/${encodeURIComponent(id)}`)).status).toBe(404);
  }, 180_000);
});
