// The bench's own moving parts, run as real processes: the fake agent launched through its executable wrapper, the
// way `ostrom claude` will launch it (OSTROM_CLAUDE_BIN).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentLog } from '../src/fake-agent.ts';
import { FAKE_CLAUDE, FAKE_CODEX } from './env.ts';

describe('bench: fake agent as a process', () => {
  it('fake-claude plays its script through --settings hooks, blocks a gated push and exits with the script code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ostrom-e2e-bench-'));
    const settings = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: "grep -q 'git push' && { echo gated >&2; exit 2; } || true" }] }] } };
    writeFileSync(join(dir, 's.json'), JSON.stringify(settings));
    writeFileSync(join(dir, 'script.json'), JSON.stringify({ steps: [{ event: 'tool', input: { command: 'git push origin main' }, run: true }, { event: 'tool', input: { command: 'echo ok' }, run: true }], exitCode: 4 }));
    const r = spawnSync(FAKE_CLAUDE, ['--settings', join(dir, 's.json')], {
      cwd: dir,
      env: { ...process.env, FAKE_AGENT_SCRIPT: join(dir, 'script.json'), FAKE_AGENT_LOG: join(dir, 'log.json') },
      encoding: 'utf8',
    });
    expect(r.status).toBe(4);
    const log = JSON.parse(readFileSync(join(dir, 'log.json'), 'utf8')) as AgentLog;
    expect(log.steps.map((s) => [s.blocked, s.ran?.stdout])).toEqual([[true, undefined], [false, 'ok\n']]);
  });

  it('fake-codex reads $CODEX_HOME/hooks.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ostrom-e2e-bench-'));
    writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'echo started > started' }] }] } }));
    const r = spawnSync(FAKE_CODEX, ['exec', 'x'], { cwd: dir, env: { ...process.env, CODEX_HOME: dir }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'started'), 'utf8')).toBe('started\n');
  });
});
