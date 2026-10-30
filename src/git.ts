// SPDX-License-Identifier: Apache-2.0
// Disposable git sandboxes for the scenarios: a bare `origin` on disk and a working clone, so that a real `git push`
// goes somewhere the scenario can inspect, and never to the network. The clone's `origin` reads as a GitHub
// repository (`https://github.com/<slug>.git`, what `git remote get-url origin` shows and Ostrom maps to a repository
// and its gates); pushes to it land in the bare origin, and any other https:// or ssh push is sent to a path that does
// not exist (pushInsteadOf, as the prototype's bench did). Scenarios never fetch. The host's git configuration (global and system) is ignored, and prompts are off.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Sandbox {
  readonly root: string;
  readonly origin: string;
  readonly work: string;
  /** `owner/name` the clone's origin points at. */
  readonly slug: string;
}

const IDENTITY = ['-c', 'user.name=dev-a', '-c', 'user.email=dev-a@ostrom.test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

/** Environment that makes git ignore the host's configuration and never prompt. */
export const GIT_ENV: Readonly<Record<string, string>> = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };

/** Runs git in `dir` with a fixed identity; returns trimmed stdout, throws with stderr on failure. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...GIT_ENV } }).trim();
}

/** Writes a file in the working clone and commits it; returns the new commit's SHA. */
export function commit(work: string, file: string, content: string, message: string): string {
  writeFileSync(join(work, file), content);
  git(work, 'add', '--', file);
  git(work, 'commit', '-q', '-m', message);
  return git(work, 'rev-parse', 'HEAD');
}

/** A bare origin with one commit on main, and a clone whose origin reads `https://github.com/<slug>.git`. */
export function sandbox(name = 'repo', slug = `acme/${name}`): Sandbox {
  const root = mkdtempSync(join(tmpdir(), `ostrom-e2e-${name}-`));
  const origin = join(root, `${name}.git`);
  const work = join(root, name);
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'clone', '-q', origin, work);
  const url = `https://github.com/${slug}.git`;
  git(work, 'remote', 'set-url', 'origin', url);
  const guard = join(root, 'no-network');
  for (const prefix of ['https://', 'http://', 'git@', 'ssh://']) git(work, 'config', '--add', `url.${guard}/.pushInsteadOf`, prefix);
  git(work, 'config', `url.${origin}.pushInsteadOf`, url);
  commit(work, 'README.md', `# ${name}\n`, 'chore: initial commit');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, origin, work, slug };
}

/** The SHA of a branch in the bare origin, or undefined when it does not exist (what a push really did). */
export function originSha(sb: Sandbox, branch: string): string | undefined {
  try {
    return git(sb.origin, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`);
  } catch {
    return undefined;
  }
}
