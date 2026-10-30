// SPDX-License-Identifier: Apache-2.0
// The fake coding agent of the bench. `ostrom claude` / `ostrom codex` launch it in place of the real agent
// (OSTROM_CLAUDE_BIN / OSTROM_CODEX_BIN = bin/fake-claude, bin/fake-codex). It loads the hooks Ostrom gave it, plays a
// script of agent events through them exactly as the agent would (stdin payload, timeout, exit 2, JSON decisions),
// really runs the Bash commands its hooks let through (so a `git push` reaches the local remote), and writes what
// happened to FAKE_AGENT_LOG for the scenario to assert on. It never calls a model.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { type Dialect, type HookTable, loadHooks, matches, verdict } from './hooks.ts';

export interface Step {
  /** `tool` = PreToolUse, then the tool if allowed, then PostToolUse. Other values are hook events played as is. */
  readonly event: string;
  readonly tool?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  /** Bash only: really run `input.command` when the hooks allow it. */
  readonly run?: boolean;
  readonly prompt?: string;
  readonly source?: string;
}

export interface Script {
  readonly sessionId?: string;
  readonly steps: readonly Step[];
  readonly exitCode?: number;
}

export interface HookRun {
  readonly event: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
  readonly timedOut: boolean;
}

export interface StepLog {
  readonly step: Step;
  readonly hooks: readonly HookRun[];
  readonly blocked: boolean;
  readonly reason: string;
  readonly additionalContext: string;
  readonly ran?: { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string };
}

export interface AgentLog {
  readonly dialect: Dialect;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly sessionId: string;
  readonly steps: readonly StepLog[];
}

export const DEFAULT_SCRIPT: Script = { steps: [{ event: 'SessionStart', source: 'startup' }, { event: 'SessionEnd' }] };

type Env = Readonly<Record<string, string | undefined>>;

function runHooks(table: HookTable, event: string, tool: string | undefined, payload: object, cwd: string, env: Env): HookRun[] {
  const runs: HookRun[] = [];
  for (const h of table[event] ?? []) {
    if (!matches(h.matcher, tool)) continue;
    const t0 = performance.now();
    const r = spawnSync('/bin/sh', ['-c', h.command], {
      cwd,
      env: { ...env, CLAUDE_PROJECT_DIR: cwd },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: h.timeoutMs,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    runs.push({ event, command: h.command, exitCode: r.status, stdout: r.stdout, stderr: r.stderr, ms: Math.round(performance.now() - t0), timedOut });
  }
  return runs;
}

function judge(runs: readonly HookRun[]): { blocked: boolean; reason: string; additionalContext: string } {
  let blocked = false;
  const reasons: string[] = [];
  const contexts: string[] = [];
  for (const r of runs) {
    const v = r.timedOut ? verdict(null, '', '') : verdict(r.exitCode, r.stdout, r.stderr);
    if (v.blocked) {
      blocked = true;
      reasons.push(v.reason);
    }
    if (v.additionalContext) contexts.push(v.additionalContext);
  }
  return { blocked, reason: reasons.join('\n'), additionalContext: contexts.join('\n') };
}

/** Plays a script; returns the log. Pure apart from the hook and Bash processes it starts. */
export function play(dialect: Dialect, argv: readonly string[], env: Env, cwd: string, script: Script): AgentLog {
  const table = loadHooks(dialect, argv, env);
  const sessionId = script.sessionId ?? `fake-${process.pid}`;
  const base = { session_id: sessionId, transcript_path: '', cwd };
  const steps: StepLog[] = [];
  for (const step of script.steps) {
    if (step.event !== 'tool') {
      const payload = { ...base, hook_event_name: step.event, prompt: step.prompt, source: step.source };
      const hooks = runHooks(table, step.event, undefined, payload, cwd, env);
      steps.push({ step, hooks, ...judge(hooks) });
      continue;
    }
    const tool = step.tool ?? 'Bash';
    const input = step.input ?? {};
    const pre = runHooks(table, 'PreToolUse', tool, { ...base, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }, cwd, env);
    const v = judge(pre);
    if (v.blocked) {
      steps.push({ step, hooks: pre, ...v });
      continue;
    }
    let ran: StepLog['ran'];
    if (step.run === true && tool === 'Bash') {
      const r = spawnSync('/bin/sh', ['-c', String(input['command'] ?? '')], { cwd, env: { ...env }, encoding: 'utf8' });
      ran = { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    }
    const response = ran === undefined ? {} : { stdout: ran.stdout, stderr: ran.stderr, exit_code: ran.exitCode };
    const post = runHooks(table, 'PostToolUse', tool, { ...base, hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: response }, cwd, env);
    const entry: StepLog = { step, hooks: [...pre, ...post], ...v };
    steps.push(ran === undefined ? entry : { ...entry, ran });
  }
  const kept: Record<string, string> = {};
  for (const [k, val] of Object.entries(env)) if (val !== undefined && (k.startsWith('OSTROM_') || k === 'CLAUDE_CONFIG_DIR' || k === 'CODEX_HOME')) kept[k] = val;
  return { dialect, argv, env: kept, cwd, sessionId, steps };
}

/** Entry point of bin/fake-claude and bin/fake-codex: `fake-agent.ts <dialect> [agent args…]`. */
export function main(argv: readonly string[], env: Env, cwd: string): number {
  const [dialect, ...rest] = argv;
  if (dialect !== 'claude' && dialect !== 'codex') throw new Error(`fake agent: unknown dialect ${String(dialect)}`);
  const path = env['FAKE_AGENT_SCRIPT'];
  const script = path ? (JSON.parse(readFileSync(path, 'utf8')) as Script) : DEFAULT_SCRIPT;
  const log = play(dialect, rest, env, cwd, script);
  const out = env['FAKE_AGENT_LOG'];
  if (out) writeFileSync(out, JSON.stringify(log, null, 2));
  // Like the agents, the session file the SessionStart hook expects (prototype: OSTROM_SESSION_FILE).
  const sessionFile = env['OSTROM_SESSION_FILE'];
  if (sessionFile) writeFileSync(sessionFile, log.sessionId);
  return script.exitCode ?? 0;
}
