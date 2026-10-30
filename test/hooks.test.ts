// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS, loadHooks, matches, mergeTables, parseHookTable, verdict } from '../src/hooks.ts';

const group = (matcher: unknown, hooks: unknown) => ({ matcher, hooks });

describe('parseHookTable', () => {
  it('ignores documents without a hooks object', () => {
    expect(parseHookTable(undefined)).toEqual({});
    expect(parseHookTable(null)).toEqual({});
    expect(parseHookTable([])).toEqual({});
    expect(parseHookTable({ hooks: [] })).toEqual({});
  });

  it('reads matchers, commands and timeouts in seconds, skipping malformed entries', () => {
    const t = parseHookTable({
      hooks: {
        PreToolUse: [
          group('Bash', [{ type: 'command', command: 'a', timeout: 5 }, { command: 'b', timeout: 0 }, { command: 'c' }, { command: 3 }, 'x']),
          group(undefined, [{ command: 'd' }]),
          group('Edit', 'not a list'),
          'not a group',
        ],
        Stop: 'not a list',
      },
    });
    expect(t).toEqual({
      PreToolUse: [
        { matcher: 'Bash', command: 'a', timeoutMs: 5000 },
        { matcher: 'Bash', command: 'b', timeoutMs: DEFAULT_TIMEOUT_MS },
        { matcher: 'Bash', command: 'c', timeoutMs: DEFAULT_TIMEOUT_MS },
        { matcher: '', command: 'd', timeoutMs: DEFAULT_TIMEOUT_MS },
      ],
    });
  });
});

describe('mergeTables', () => {
  it('keeps every hook of every source, in order', () => {
    const a = { PreToolUse: [{ matcher: '', command: 'a', timeoutMs: 1 }] };
    const b = { PreToolUse: [{ matcher: '', command: 'b', timeoutMs: 1 }], Stop: [{ matcher: '', command: 'c', timeoutMs: 1 }] };
    expect(mergeTables([a, b])).toEqual({ PreToolUse: [a.PreToolUse[0], b.PreToolUse[0]], Stop: b.Stop });
  });
});

describe('loadHooks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ostrom-e2e-hooks-'));
  const doc = (command: string) => JSON.stringify({ hooks: { PreToolUse: [group('Bash', [{ command }])] } });
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'settings.json'), doc('from-config-dir'));
  writeFileSync(join(dir, 'settings.json'), doc('from-settings-file'));
  mkdirSync(join(dir, 'plugin', 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'plugin', 'hooks', 'hooks.json'), doc('from-plugin'));
  mkdirSync(join(dir, 'codex'));
  writeFileSync(join(dir, 'codex', 'hooks.json'), doc('from-codex-home'));
  const commands = (t: ReturnType<typeof loadHooks>) => (t['PreToolUse'] ?? []).map((h) => h.command);

  it('reads Claude Code settings from the config dir, --settings (file, inline, =form) and --plugin-dir', () => {
    const argv = ['--settings', join(dir, 'settings.json'), `--settings=${doc('inline')}`, '--plugin-dir', join(dir, 'plugin'), '--plugin-dir', join(dir, 'missing'), '--settings'];
    expect(commands(loadHooks('claude', argv, { CLAUDE_CONFIG_DIR: join(dir, 'config') }))).toEqual([
      'from-config-dir',
      'from-settings-file',
      'inline',
      'from-plugin',
    ]);
    expect(loadHooks('claude', [], {})).toEqual({});
  });

  it('reads Codex hooks from CODEX_HOME only', () => {
    expect(commands(loadHooks('codex', ['--settings', join(dir, 'settings.json')], { CODEX_HOME: join(dir, 'codex') }))).toEqual(['from-codex-home']);
    expect(loadHooks('codex', [], {})).toEqual({});
  });
});

describe('matches', () => {
  it('follows Claude Code matchers', () => {
    expect(matches('', undefined)).toBe(true);
    expect(matches('*', 'Edit')).toBe(true);
    expect(matches('Bash', undefined)).toBe(false);
    expect(matches('Edit|Write', 'Write')).toBe(true);
    expect(matches('Bash', 'BashOutput')).toBe(false);
  });
});

describe('verdict', () => {
  it('blocks on exit 2 with stderr as the reason', () => {
    expect(verdict(2, '', ' gated: ask bob \n')).toEqual({ blocked: true, reason: 'gated: ask bob', additionalContext: '' });
  });

  it('lets the action through on any other failure, a timeout or unreadable output', () => {
    for (const [code, out] of [[1, ''], [null, ''], [0, 'not json'], [0, '[1]'], [0, '3']] as const) {
      expect(verdict(code, out, 'boom').blocked).toBe(false);
    }
  });

  it('reads the JSON decisions of Claude Code', () => {
    const deny = JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'needs a yes', additionalContext: 'ctx' } });
    expect(verdict(0, deny, '')).toEqual({ blocked: true, reason: 'needs a yes', additionalContext: 'ctx' });
    expect(verdict(0, JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask' } }), '').blocked).toBe(true);
    expect(verdict(0, JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', additionalContext: 7 } }), '')).toEqual({
      blocked: false,
      reason: '',
      additionalContext: '',
    });
    expect(verdict(0, JSON.stringify({ decision: 'block', reason: 'r' }), '')).toEqual({ blocked: true, reason: 'r', additionalContext: '' });
    expect(verdict(0, JSON.stringify({ continue: false, stopReason: 's', hookSpecificOutput: 'x' }), '')).toEqual({
      blocked: true,
      reason: 's',
      additionalContext: '',
    });
  });
});
