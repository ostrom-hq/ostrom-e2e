import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AgentLog, DEFAULT_SCRIPT, main, play } from '../src/fake-agent.ts';

function workspace(hooks: Record<string, unknown[]>) {
  const dir = mkdtempSync(join(tmpdir(), 'ostrom-e2e-agent-'));
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks }));
  return { dir, argv: ['--settings', settings] };
}

const hook = (matcher: string, command: string, timeout?: number) => ({ matcher, hooks: [{ type: 'command', command, timeout }] });
const env = { PATH: process.env['PATH'] };

describe('play', () => {
  it('passes the payload on stdin and blocks a gated push before running it', () => {
    const w = workspace({
      SessionStart: [hook('', 'cat > start.json')],
      PreToolUse: [hook('Bash', `grep -q 'git push' && { echo 'gated: needs a yes' >&2; exit 2; } || exit 0`), hook('Edit', 'exit 0')],
    });
    const log = play('claude', w.argv, env, w.dir, {
      sessionId: 's1',
      steps: [{ event: 'SessionStart', source: 'startup' }, { event: 'tool', tool: 'Bash', input: { command: 'git push origin main' }, run: true }],
    });
    expect(JSON.parse(readFileSync(join(w.dir, 'start.json'), 'utf8'))).toMatchObject({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: w.dir });
    const push = log.steps[1];
    expect(push).toMatchObject({ blocked: true, reason: 'gated: needs a yes' });
    expect(push?.ran).toBeUndefined();
    expect(push?.hooks).toHaveLength(1);
  });

  it('runs an allowed Bash command and gives its output to PostToolUse', () => {
    const w = workspace({
      PreToolUse: [hook('*', `echo '{"hookSpecificOutput":{"additionalContext":"rules: r1"}}'`)],
      PostToolUse: [hook('Bash', 'cat > post.json')],
    });
    const log = play('claude', w.argv, env, w.dir, { steps: [{ event: 'tool', input: { command: 'echo hello' }, run: true }] });
    expect(log.sessionId).toMatch(/^fake-/);
    expect(log.steps[0]).toMatchObject({ blocked: false, additionalContext: 'rules: r1', ran: { exitCode: 0, stdout: 'hello\n' } });
    expect(JSON.parse(readFileSync(join(w.dir, 'post.json'), 'utf8'))).toMatchObject({ tool_name: 'Bash', tool_response: { stdout: 'hello\n', exit_code: 0 } });
  });

  it('does not run tools it was not asked to run, nor non-Bash tools', () => {
    const w = workspace({ PostToolUse: [hook('', 'cat > post.json')] });
    const log = play('claude', w.argv, env, w.dir, {
      steps: [
        { event: 'tool', tool: 'Edit', input: { file_path: 'a' }, run: true },
        { event: 'tool', tool: 'Bash', run: true },
        { event: 'tool', tool: 'Bash', input: { command: 'touch nope' } },
      ],
    });
    expect(log.steps.map((s) => s.ran?.exitCode)).toEqual([undefined, 0, undefined]);
    expect(JSON.parse(readFileSync(join(w.dir, 'post.json'), 'utf8'))).toMatchObject({ tool_response: {} });
  });

  it('lets the action through when a hook times out or overflows, like the real agent', () => {
    const w = workspace({ PreToolUse: [hook('', 'sleep 5', 0.2), hook('', 'head -c 2000000 /dev/zero; exit 2')] });
    const log = play('claude', w.argv, env, w.dir, { steps: [{ event: 'tool', tool: 'Bash', input: { command: 'true' } }] });
    const step = log.steps[0];
    expect(step?.blocked).toBe(false);
    expect(step?.hooks.map((h) => h.timedOut)).toEqual([true, false]);
  });

  it('keeps only the Ostrom and agent-home variables in the log', () => {
    const w = workspace({});
    const log = play('codex', [], { OSTROM_URL: 'u', CLAUDE_CONFIG_DIR: 'c', CODEX_HOME: w.dir, HOME: 'h', UNSET: undefined }, w.dir, DEFAULT_SCRIPT);
    expect(log.env).toEqual({ OSTROM_URL: 'u', CLAUDE_CONFIG_DIR: 'c', CODEX_HOME: w.dir });
    expect(log.steps.map((s) => s.step.event)).toEqual(['SessionStart', 'SessionEnd']);
  });
});

describe('main', () => {
  it('refuses an unknown dialect', () => {
    expect(() => main(['gemini'], {}, '.')).toThrow(/unknown dialect gemini/);
    expect(() => main([], {}, '.')).toThrow(/unknown dialect undefined/);
  });

  it('plays the script file, writes the log and the session file, and exits with the script code', () => {
    const w = workspace({});
    writeFileSync(join(w.dir, 'script.json'), JSON.stringify({ sessionId: 'sess-1', steps: [{ event: 'Stop' }], exitCode: 3 }));
    const files = { FAKE_AGENT_SCRIPT: join(w.dir, 'script.json'), FAKE_AGENT_LOG: join(w.dir, 'log.json'), OSTROM_SESSION_FILE: join(w.dir, 'session') };
    expect(main(['claude', ...w.argv], { ...env, ...files }, w.dir)).toBe(3);
    const log = JSON.parse(readFileSync(files.FAKE_AGENT_LOG, 'utf8')) as AgentLog;
    expect(log).toMatchObject({ dialect: 'claude', argv: w.argv, sessionId: 'sess-1' });
    expect(readFileSync(files.OSTROM_SESSION_FILE, 'utf8')).toBe('sess-1');
  });

  it('plays the default script and exits 0 without any file', () => {
    expect(main(['codex'], env, tmpdir())).toBe(0);
  });
});
