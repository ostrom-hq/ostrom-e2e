// SPDX-License-Identifier: Apache-2.0
// Helpers shared by the full-stack scenarios: one isolated person (own HOME and OSTROM_HOME), the real `ostrom`
// binary, the fake agent in place of Claude Code / Codex. Two worlds: the prototype's (`world()`, logged in through the
// fake GitHub, OSTROM_E2E_JALON=1) kept for bypass.e2e.ts, and the real one (`realWorld()`): people signed in by their
// e-mailed link in the browser, the real `ostrom login` approved from that browser, the gate made by a workflow.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLog, Script } from '../src/fake-agent.ts';
import { FakeGitHub } from '../src/fake-github.ts';
import { GIT_ENV } from '../src/git.ts';
import { isServed } from '../src/probe.ts';
import { CLI_BIN, FAKE_CLAUDE, FAKE_CODEX, SERVER_URL } from './env.ts';
import { type Person as Browser, address, call, email, invite, join, orgOf, orgsUnavailable, profileOf, signIn, url } from './org.ts';

export interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

export interface Person {
  readonly login: string;
  readonly home: string;
  readonly env: Record<string, string>;
  /**
   * Runs the real `ostrom` binary as this person. Asynchronous on purpose: the fake GitHub lives in this process and
   * must keep answering while the CLI (and the server it calls) talk to it.
   */
  ostrom(args: readonly string[], opts?: { cwd?: string; input?: string; env?: Record<string, string> }): Promise<Run>;
  /** `ostrom claude` with the fake agent playing `script`; returns the CLI run and the agent's log. */
  claude(cwd: string, script: Script, args?: readonly string[]): Promise<{ run: Run; log: AgentLog | undefined }>;
}

/**
 * The console's origin: where the server sends the device page (`verificationUri`), and the origin a browser write
 * carries (allowed origins of the server since ostrom-server#58). The CLI shows a sign-in page only on GitHub's, the
 * server's or this origin (`OSTROM_CONSOLE_URL`, ostrom-cli#40).
 */
export const CONSOLE_URL = process.env['OSTROM_E2E_CONSOLE_URL'] ?? 'http://127.0.0.1:4600';

/** A person with a clean home, pointed at the bench's server (and the fake GitHub when given). Not logged in yet. */
export function person(login: string, github?: FakeGitHub): Person {
  const home = mkdtempSync(join(tmpdir(), `ostrom-e2e-${login}-`));
  const env: Record<string, string> = {
    PATH: String(process.env['PATH']),
    HOME: home,
    OSTROM_HOME: join(home, '.ostrom'),
    OSTROM_URL: SERVER_URL,
    OSTROM_CONSOLE_URL: CONSOLE_URL,
    ...(github ? { OSTROM_GITHUB_API_URL: github.url, OSTROM_GITHUB_WEB_URL: github.url } : {}),
    OSTROM_CLAUDE_BIN: FAKE_CLAUDE,
    OSTROM_CODEX_BIN: FAKE_CODEX,
    NO_COLOR: '1',
    ...GIT_ENV,
  };
  const ostrom: Person['ostrom'] = (args, opts = {}) =>
    new Promise((resolve, reject) => {
      const t0 = performance.now();
      const child = spawn(CLI_BIN, [...args], { cwd: opts.cwd ?? home, env: { ...env, ...opts.env }, timeout: 90_000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr, ms: Math.round(performance.now() - t0) }));
      child.stdin.end(opts.input ?? '');
    });
  return {
    login,
    home,
    env,
    ostrom,
    async claude(cwd, script, args = []) {
      const dir = mkdtempSync(join(tmpdir(), 'ostrom-e2e-agent-'));
      writeFileSync(join(dir, 'script.json'), JSON.stringify(script));
      const run = await ostrom(['claude', ...args], { cwd, env: { FAKE_AGENT_SCRIPT: join(dir, 'script.json'), FAKE_AGENT_LOG: join(dir, 'log.json') } });
      let log: AgentLog | undefined;
      try {
        log = JSON.parse(readFileSync(join(dir, 'log.json'), 'utf8')) as AgentLog;
      } catch {
        log = undefined;
      }
      return { run, log };
    },
  };
}

/** Logs a person in through the device flow of the fake GitHub (`ostrom login --server`). */
export function login(p: Person, github: FakeGitHub): Promise<Run> {
  github.deviceLogin(p.login);
  return p.ostrom(['login', '--server', SERVER_URL]);
}

/** The gate id the CLI or the hook named in a refusal (`ostrom wait <id>` / `ostrom approve <id>`). */
export function gateIdIn(text: string): string | undefined {
  return /ostrom (?:wait|approve) ([A-Za-z0-9_-]+)/.exec(text)?.[1];
}

/** True when the server and the CLI serve the milestone journeys (set by QA in the workflow, OSTROM_E2E_JALON=1). */
export const JALON_READY = CLI_BIN !== '' && SERVER_URL !== '' && process.env['OSTROM_E2E_JALON'] === '1';

export interface World {
  readonly github: FakeGitHub;
  /** The requester, first member of the organisation. */
  readonly dev: Person;
  /** An approver of the gate « push to main » of acme/api. */
  readonly rev: Person;
}

/**
 * The organisation of the milestone, built through the real surfaces (CLI.md § 3.1 and § 3.2): dev-a logs in first,
 * invites rev-b and rev-c, rev-b logs in, dev-a adds the harness « git-safety » on acme/api with rev-b and rev-c as
 * approvers (rev-c never logs in: two approvers, one active) and enforces it.
 */
export async function world(): Promise<World> {
  const github = new FakeGitHub();
  await github.start();
  const dev = person('dev-a', github);
  const rev = person('rev-b', github);
  const run = async (what: string, p: Promise<Run>): Promise<void> => {
    const r = await p;
    if (r.code !== 0) throw new Error(`world: ${what} exited ${r.code}\n${r.stderr}${r.stdout}`);
  };
  await run('dev-a login', login(dev, github));
  await run('invite', dev.ostrom(['invite', '@rev-b', '@rev-c']));
  await run('rev-b login', login(rev, github));
  await run('harness add', dev.ostrom(['harness', 'add', 'git-safety', '--scope', 'repo:acme/api', '--set', 'deploy_approvers=@rev-b,@rev-c', '--enforce']));
  return { github, dev, rev };
}

/** A tool call the fake agent makes and really runs (Bash). */
export function bash(command: string): { steps: { event: string; tool: string; input: { command: string }; run: boolean }[] } {
  return { steps: [{ event: 'tool', tool: 'Bash', input: { command }, run: true }] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The real milestone: real server image, real `ostrom` binary, people signed in by their e-mailed link.

/** The one-time code `ostrom login` prints (`! Copy your one-time code: ABCD-EFGH`, DeviceLogin.kt). */
export function userCodeIn(text: string): string | undefined {
  return /one-time code: ([A-Za-z0-9-]{1,32})/.exec(text)?.[1];
}

/** A CLI token of any kind (`osc_…`, `osp_…`, `osa_…`, TokenKind of the server) or a sign-in link token (`opk_…`). */
export const SECRET = /\bo(?:sc|sp|sa|pk)_[A-Za-z0-9_-]{8,}/;

/**
 * Runs the real `ostrom login` as `p` and plays the browser: reads the one-time code the CLI prints, then says yes with
 * `browser`'s session (`POST /api/v1/auth/device/answer {userCode, approve: true}`), and waits for the CLI to finish.
 */
export function deviceLogin(p: Person, browser: Browser): Promise<{ run: Run; userCode: string | undefined; answer: number | undefined }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(CLI_BIN, ['login', '--server', SERVER_URL], { cwd: p.home, env: p.env, timeout: 120_000 });
    let stdout = '';
    let stderr = '';
    let userCode: string | undefined;
    let answer: number | undefined;
    let answering: Promise<void> = Promise.resolve();
    const seen = () => {
      if (userCode !== undefined) return;
      userCode = userCodeIn(stderr + stdout);
      if (userCode === undefined) return;
      const code = userCode;
      answering = call(browser.caller, 'POST', '/api/v1/auth/device/answer', { userCode: code, approve: true }).then((r) => {
        answer = r.status;
        if (r.status >= 300) child.kill();
      });
    };
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
      seen();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      seen();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      void answering.then(() => resolve({ run: { code, stdout, stderr, ms: Math.round(performance.now() - t0) }, userCode, answer }), reject);
    });
    child.stdin.end('');
  });
}

/**
 * Why the real `ostrom login` cannot run yet, or '' when it can: a server, a binary, and a device poll on the contract's
 * shape (ostrom-server#62: 428 `authorization_pending` while pending, an `AuthToken` once approved). Before #62 the
 * server answers a pending poll 200 `{status: 'pending'}`, which the CLI of ostrom-cli#40 does not read.
 */
export async function loginUnavailable(): Promise<string> {
  if (SERVER_URL === '') return 'no server';
  if (CLI_BIN === '') return 'no ostrom binary';
  const orgs = await orgsUnavailable();
  if (orgs) return orgs;
  if (!(await isServed(SERVER_URL, '/api/v1/auth/device/answer', 'POST'))) return 'not served yet: POST /api/v1/auth/device/answer';
  const from = address();
  const started = await fetch(url('/api/v1/auth/device'), { method: 'POST', headers: { 'x-forwarded-for': from } });
  if (started.status !== 200) return `POST /api/v1/auth/device → ${started.status}`;
  const { deviceCode } = (await started.json()) as { deviceCode?: string };
  const polled = await fetch(url('/api/v1/auth/device/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
    body: JSON.stringify({ deviceCode }),
  });
  const text = await polled.text();
  if (polled.status === 428) return '';
  if (polled.status === 400 && text.includes('slow_down')) return '';
  return `device poll not on the contract yet: a pending poll answers ${polled.status} ${text.slice(0, 80)}, not 428 (ostrom-server#62)`;
}

/**
 * Why the gate journey cannot run yet, or '' when it can: the login above, the compiler (workflows, gate catalogue,
 * signed session packages: ostrom-server#43) and the sessions (segments, sign of life, signed end receipt:
 * ostrom-server#26). Probed on paths main does not serve under another route (`/api/v1/gates/{id}` is served on
 * main, so the catalogue is probed by its `signed` child).
 */
export async function journeyUnavailable(): Promise<string> {
  const login = await loginUnavailable();
  if (login) return login;
  const sample = '00000000-0000-4000-8000-000000000000';
  const needed: [string, string, string][] = [
    ['POST', '/api/v1/workflows', '#43'],
    ['GET', '/api/v1/gates/catalog/signed', '#43'],
    ['GET', '/api/v1/packages/current', '#43'],
    ['POST', '/api/v1/sessions', '#26'],
    ['POST', `/api/v1/sessions/${sample}/end`, '#26'],
    ['POST', '/api/v1/gates', 'gates'],
    ['POST', `/api/v1/approvals/${sample}/answer`, 'gates'],
  ];
  const missing: string[] = [];
  for (const [method, path, pr] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path.replace(sample, '{id}')} (${pr})`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

/** A person of the real world: their terminal (the real `ostrom`) and their browser (e-mailed link). */
export interface Member {
  readonly email: string;
  /** The login the server gave them (`GET /api/v1/auth/me`). */
  readonly login: string;
  readonly cli: Person;
  browser: Browser;
  /** Signs in again by the e-mailed link: a yes needs a session signed in less than 5 minutes ago (ostrom-server#41). */
  fresh(): Promise<Browser>;
}

export interface RealWorld {
  readonly orgId: string;
  /** The requester, owner of the organisation. */
  readonly dev: Member;
  /** The approver of pushes to main of `repo`, admin of the same organisation. */
  readonly rev: Member;
  readonly repo: string;
}

/** The member signed in as `browser`, with a clean terminal (not logged in yet). */
export async function member(browser: Browser): Promise<Member> {
  const me = await profileOf(browser.caller);
  const login = me.login;
  if (me.status !== 200 || login === '') throw new Error(`profile → ${me.status} ${JSON.stringify(me.body)}`);
  const m: Member = {
    email: browser.email,
    login,
    cli: person(login),
    browser,
    async fresh() {
      m.browser = await signIn(browser.email);
      return m.browser;
    },
  };
  return m;
}

/** Logs `m`'s terminal in for real (device flow approved from their browser); throws with the CLI's output if not. */
export async function cliLogin(m: Member): Promise<Run> {
  const { run, answer } = await deviceLogin(m.cli, m.browser);
  if (run.code !== 0 || (answer ?? 0) >= 300) throw new Error(`ostrom login of ${m.login} exited ${run.code} (answer ${answer})\n${run.stderr}${run.stdout}`);
  return run;
}

/**
 * The organisation of the milestone, built through the real surfaces: dev-a signs in and owns an organisation, invites
 * rev-b as admin, rev-b joins; both log their terminal in with the real `ostrom login`; dev-a saves an accepted
 * workflow whose gate node (action class `push-main`, contract `GateAction`) names dev-a and rev-b as approvers of pushes
 * to main of `repo` (as scripts/load-setup.ts does, plus dev-a: E2E-YES-003 needs the requester to be an approver while
 * another one exists). Any refusal throws with the server's answer.
 */
export async function realWorld(repo = 'acme/api'): Promise<RealWorld> {
  const dev = await member(await signIn(email('dev-a')));
  const org = await orgOf(dev.browser);
  const revEmail = email('rev-b');
  const invited = await invite(dev.browser, org.id, [revEmail], 'admin');
  if (invited.status !== 200) throw new Error(`invite → ${invited.status} ${JSON.stringify(invited.body)}`);
  const joined = await join(revEmail);
  if (joined.accepted.status !== 200) throw new Error(`rev-b join → ${joined.accepted.status} ${JSON.stringify(joined.accepted.body)}`);
  const rev = await member(joined.person);
  await cliLogin(dev);
  await cliLogin(rev);
  const workflow = await call(dev.browser.caller, 'POST', '/api/v1/workflows', {
    id: `e2e-push-main-${Date.now().toString(36)}`,
    name: 'E2E push to main',
    domain: 'delivery',
    status: 'accepted',
    foundAt: new Date().toISOString(),
    nodes: [{ id: 'push-main', kind: 'gate', label: 'Push to main', approvers: [dev.login, rev.login], actions: [{ class: 'push-main', label: 'Push to the main branch', patterns: [], repos: [repo] }] }],
    edges: [],
  });
  if (workflow.status >= 300) throw new Error(`workflow → ${workflow.status} ${JSON.stringify(workflow.body)}`);
  return { orgId: org.id, dev, rev, repo };
}

/** An approval as the approvals routes give it (contract `ApprovalRequest`). */
export type Approval = { id: string; group?: string; gate?: string; shownDigest?: string; status?: string } & Record<string, unknown>;

/** `browser`'s own pending request for `gate` (one request per approver, « first yes wins »), as load/lib.js finds it. */
export async function approvalFor(browser: Browser, gate: string): Promise<Approval | undefined> {
  const r = await call(browser.caller, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50');
  if (r.status !== 200) throw new Error(`GET /api/v1/approvals → ${r.status} ${JSON.stringify(r.body)}`);
  return ((r.body['items'] as Approval[] | undefined) ?? []).find((a) => a.group === gate || a.gate === gate || a.id === gate);
}

/** Says yes (or no) to an approval from a browser session, with the digest it was shown (load/lib.js `approve`). */
export const answer = (browser: Browser, approval: Approval, what: 'approve' | 'deny' = 'approve') =>
  call(browser.caller, 'POST', `/api/v1/approvals/${encodeURIComponent(approval.id)}/answer`, { answer: what, shownDigest: approval.shownDigest });

/** The receipt id an answer or a hook text names (`receipt <id>`, `receiptId`, `approval.receiptId`, `receipt.id`). */
export function receiptIdIn(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const nested = b['receipt'];
    const approval = b['approval'];
    if (typeof b['receiptId'] === 'string') return b['receiptId'];
    if (approval && typeof approval === 'object' && typeof (approval as Record<string, unknown>)['receiptId'] === 'string') return (approval as Record<string, string>)['receiptId'];
    if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>)['id'] === 'string') return (nested as Record<string, string>)['id'];
    if (typeof nested === 'string') return nested;
    return undefined;
  }
  return typeof body === 'string' ? /receipt ([A-Za-z0-9_-]{6,})/.exec(body)?.[1] : undefined;
}
