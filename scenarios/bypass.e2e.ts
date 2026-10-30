// SPDX-License-Identifier: Apache-2.0
// Bypass attempts from the audit of the gate (SCENARIOS.md, family BYPASS, priority « jalon »): each one is a real
// command the fake agent runs in a git sandbox; the assertion is on what reached the bare origin, not on a message.
// They run with the milestone journeys (OSTROM_E2E_JALON=1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commit, git, originSha, sandbox } from '../src/git.ts';
import { JALON_READY, type World, bash, gateIdIn, world } from './lib.ts';

describe.skipIf(!JALON_READY)('bypass attempts on the gate « push to main »', () => {
  let w: World;

  beforeAll(async () => {
    w = await world();
  });

  afterAll(async () => {
    await w.github.stop();
  });

  /** Plays one command; returns whether the hook blocked it and the gate it named. */
  const attempt = async (cwd: string, command: string) => {
    const { log } = await w.dev.claude(cwd, bash(command));
    const step = log?.steps[0];
    return { blocked: step?.blocked === true, gate: gateIdIn(step?.reason ?? '') };
  };

  it('E2E-BYPASS-001 — options before the verb `push` still ask for the gate', async () => {
    const sb = sandbox('api', 'acme/api');
    const before = originSha(sb, 'main');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const spaced = `${sb.root}/my work`;
    git(sb.root, 'clone', '-q', sb.origin, spaced);
    git(spaced, 'remote', 'set-url', 'origin', 'https://github.com/acme/api.git');
    git(spaced, 'config', `url.${sb.origin}.pushInsteadOf`, 'https://github.com/acme/api.git');
    commit(spaced, 'b.txt', 'b\n', 'feat: b');
    const commands = [
      `git -C ${sb.work} push origin main`,
      `git -C "${spaced}" push origin HEAD:main`,
      'git -c core.sshCommand=ssh push origin main',
      'git --no-pager push origin main',
      `git --git-dir ${sb.work}/.git push origin main`,
    ];
    for (const command of commands) {
      const r = await attempt(sb.root, command);
      expect(r.blocked, command).toBe(true);
      expect(r.gate, command).toBeDefined();
    }
    expect(originSha(sb, 'main')).toBe(before);
  });

  it('E2E-BYPASS-005 — the yes of an ordinary push never covers a force-push of the same commit', async () => {
    const sb = sandbox('api', 'acme/api');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    const first = await attempt(sb.work, 'git push origin main');
    expect(first.blocked).toBe(true);
    // Read through a pipe, the same push finds the same request.
    expect((await attempt(sb.work, 'git push origin main 2>&1 | tail -n 5')).gate).toBe(first.gate);
    expect((await w.rev.ostrom(['approve', String(first.gate)])).code).toBe(0);
    for (const command of ['git push --force origin main', 'git push -f origin main', 'git push origin +main', 'git push --force-with-lease origin main', 'git push -uf origin main']) {
      const r = await attempt(sb.work, command);
      expect(r.blocked, command).toBe(true);
      expect(r.gate, command).not.toBe(first.gate);
    }
  });

  it('E2E-BYPASS-024 — a push that lands on main without naming it opens the gate of main', async () => {
    const sb = sandbox('api', 'acme/api');
    const before = originSha(sb, 'main');
    git(sb.work, 'branch', '--set-upstream-to=origin/main', 'main');
    commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    for (const command of ['git push origin HEAD', 'git push', 'git -c push.default=matching push origin', 'git -c remote.origin.push=refs/heads/main:refs/heads/main push origin']) {
      const r = await attempt(sb.work, command);
      expect(r.blocked, command).toBe(true);
    }
    expect(originSha(sb, 'main')).toBe(before);
  });
});
