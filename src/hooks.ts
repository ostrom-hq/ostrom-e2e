// SPDX-License-Identifier: Apache-2.0
// How a coding agent finds and judges its hooks, reduced to what the bench needs to play them like the real agent.
// Claude Code: settings JSON `{ "hooks": { "<Event>": [ { "matcher": "Bash", "hooks": [ { "type": "command",
// "command": "...", "timeout": <seconds> } ] } ] } }`, from `--settings <file|json>`, `--plugin-dir <dir>`
// (`<dir>/hooks/hooks.json`) and `$CLAUDE_CONFIG_DIR/settings.json`. Codex: the same shape in `$CODEX_HOME/hooks.json`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Dialect = 'claude' | 'codex';

export interface HookCommand {
  readonly matcher: string;
  readonly command: string;
  readonly timeoutMs: number;
}

export type HookTable = Readonly<Record<string, readonly HookCommand[]>>;

/** Claude Code's default hook timeout (60 s) when a hook does not set one. */
export const DEFAULT_TIMEOUT_MS = 60_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Reads the `hooks` table of one settings document; anything malformed is ignored, as the agents do. */
export function parseHookTable(doc: unknown): HookTable {
  const out: Record<string, HookCommand[]> = {};
  const hooks = isRecord(doc) ? doc['hooks'] : undefined;
  if (!isRecord(hooks)) return out;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const list: HookCommand[] = [];
    for (const g of groups) {
      if (!isRecord(g) || !Array.isArray(g['hooks'])) continue;
      const matcher = typeof g['matcher'] === 'string' ? g['matcher'] : '';
      for (const h of g['hooks']) {
        if (!isRecord(h) || typeof h['command'] !== 'string') continue;
        const t = h['timeout'];
        list.push({ matcher, command: h['command'], timeoutMs: typeof t === 'number' && t > 0 ? t * 1000 : DEFAULT_TIMEOUT_MS });
      }
    }
    out[event] = list;
  }
  return out;
}

/** Concatenates tables in order (every matching hook runs, like the agents do). */
export function mergeTables(tables: readonly HookTable[]): HookTable {
  const out: Record<string, HookCommand[]> = {};
  for (const t of tables) for (const [e, l] of Object.entries(t)) out[e] = [...(out[e] ?? []), ...l];
  return out;
}

function argValues(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    const next = argv[i + 1];
    if (a === flag && next !== undefined) out.push(next);
    else if (a.startsWith(`${flag}=`)) out.push(a.slice(flag.length + 1));
  });
  return out;
}

function readJson(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined;
}

/** Every hook the agent would load for this launch, in the agent's order. */
export function loadHooks(dialect: Dialect, argv: readonly string[], env: Readonly<Record<string, string | undefined>>): HookTable {
  const docs: unknown[] = [];
  if (dialect === 'codex') {
    const home = env['CODEX_HOME'];
    if (home) docs.push(readJson(join(home, 'hooks.json')));
  } else {
    const dir = env['CLAUDE_CONFIG_DIR'];
    if (dir) docs.push(readJson(join(dir, 'settings.json')));
    for (const s of argValues(argv, '--settings')) docs.push(s.trimStart().startsWith('{') ? JSON.parse(s) : readJson(s));
    for (const d of argValues(argv, '--plugin-dir')) docs.push(readJson(join(d, 'hooks', 'hooks.json')));
  }
  return mergeTables(docs.map(parseHookTable));
}

/** Claude Code matchers: empty or `*` matches every tool, otherwise an anchored regular expression. */
export function matches(matcher: string, tool: string | undefined): boolean {
  if (matcher === '' || matcher === '*') return true;
  if (tool === undefined) return false;
  return new RegExp(`^(?:${matcher})$`).test(tool);
}

export interface Verdict {
  readonly blocked: boolean;
  readonly reason: string;
  readonly additionalContext: string;
}

/**
 * What the agent does with a hook's result. Exit 2 blocks with stderr as the reason. Exit 0 may carry JSON:
 * `hookSpecificOutput.permissionDecision` = deny (or ask: the bench has nobody to ask, so it counts as a block),
 * `decision` = block, or `continue` = false. Any other exit code, or a timeout, is a non-blocking error: the action
 * goes on — exactly why Ostrom must refuse before the agent's deadline.
 */
export function verdict(exitCode: number | null, stdout: string, stderr: string): Verdict {
  if (exitCode === 2) return { blocked: true, reason: stderr.trim(), additionalContext: '' };
  if (exitCode !== 0) return { blocked: false, reason: '', additionalContext: '' };
  let out: unknown;
  try {
    out = JSON.parse(stdout);
  } catch {
    return { blocked: false, reason: '', additionalContext: '' };
  }
  if (!isRecord(out)) return { blocked: false, reason: '', additionalContext: '' };
  const specific = isRecord(out['hookSpecificOutput']) ? out['hookSpecificOutput'] : {};
  const decision = specific['permissionDecision'];
  const context = typeof specific['additionalContext'] === 'string' ? specific['additionalContext'] : '';
  const why = [specific['permissionDecisionReason'], out['reason'], out['stopReason']].find((r) => typeof r === 'string');
  const reason = typeof why === 'string' ? why : '';
  const blocked = decision === 'deny' || decision === 'ask' || out['decision'] === 'block' || out['continue'] === false;
  return { blocked, reason, additionalContext: context };
}
