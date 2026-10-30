// Helpers shared by the full-stack scenarios: one isolated person (own HOME and OSTROM_HOME, logged in through the
// fake GitHub), the real `ostrom` binary, the fake agent in place of Claude Code / Codex.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLog, Script } from '../src/fake-agent.ts';
import type { FakeGitHub } from '../src/fake-github.ts';
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
