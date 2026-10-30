// SPDX-License-Identifier: Apache-2.0
// Helpers shared by the full-stack scenarios: one isolated person (own HOME and OSTROM_HOME, logged in through the
// fake GitHub), the real `ostrom` binary, the fake agent in place of Claude Code / Codex.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLog, Script } from '../src/fake-agent.ts';
import { FakeGitHub } from '../src/fake-github.ts';
import { GIT_ENV } from '../src/git.ts';
import { CLI_BIN, FAKE_CLAUDE, FAKE_CODEX, SERVER_URL } from './env.ts';

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

/** A person with a clean home, pointed at the bench's server and fake GitHub. Not logged in yet. */
export function person(login: string, github: FakeGitHub): Person {
  const home = mkdtempSync(join(tmpdir(), `ostrom-e2e-${login}-`));
  const env: Record<string, string> = {
    PATH: String(process.env['PATH']),
    HOME: home,
    OSTROM_HOME: join(home, '.ostrom'),
    OSTROM_URL: SERVER_URL,
    OSTROM_GITHUB_API_URL: github.url,
    OSTROM_GITHUB_WEB_URL: github.url,
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
