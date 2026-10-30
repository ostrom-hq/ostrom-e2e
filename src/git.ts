// Disposable git sandboxes for the scenarios: a bare `origin` on disk and a working clone, so that a real `git push`
// goes somewhere the scenario can inspect, and never to the network (any https:// or ssh remote is rewritten to a
// path that does not exist, as the prototype's bench did with pushInsteadOf).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Sandbox {
  readonly root: string;
  readonly origin: string;
  readonly work: string;
}

const IDENTITY = ['-c', 'user.name=dev-a', '-c', 'user.email=dev-a@ostrom.test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

/** Runs git in `dir` with a fixed identity; returns trimmed stdout, throws with stderr on failure. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Writes a file in the working clone and commits it; returns the new commit's SHA. */
export function commit(work: string, file: string, content: string, message: string): string {
  writeFileSync(join(work, file), content);
  git(work, 'add', '--', file);
  git(work, 'commit', '-q', '-m', message);
  return git(work, 'rev-parse', 'HEAD');
}

/** A bare origin with one commit on main, and a clone of it whose network remotes cannot be reached. */
export function sandbox(name = 'repo'): Sandbox {
  const root = mkdtempSync(join(tmpdir(), `ostrom-e2e-${name}-`));
  const origin = join(root, `${name}.git`);
  const work = join(root, name);
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'clone', '-q', origin, work);
  const guard = join(root, 'no-network');
  for (const prefix of ['https://', 'http://', 'git@', 'ssh://']) git(work, 'config', '--add', `url.${guard}/.insteadOf`, prefix);
  commit(work, 'README.md', `# ${name}\n`, 'chore: initial commit');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, origin, work };
}

/** The SHA of a branch in the bare origin, or undefined when it does not exist (what a push really did). */
export function originSha(sb: Sandbox, branch: string): string | undefined {
  try {
    return git(sb.origin, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`);
  } catch {
    return undefined;
  }
}
