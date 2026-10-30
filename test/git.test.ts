// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { commit, git, originSha, sandbox } from '../src/git.ts';

describe('git sandbox', () => {
  it('creates a bare origin with main pushed and a clone tracking it', () => {
    const sb = sandbox('demo');
    expect(git(sb.work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(originSha(sb, 'main')).toBe(git(sb.work, 'rev-parse', 'HEAD'));
    expect(originSha(sb, 'feature')).toBeUndefined();
  });

  it('records commits and real pushes', () => {
    const sb = sandbox();
    const sha = commit(sb.work, 'a.txt', 'a\n', 'feat: a');
    expect(originSha(sb, 'main')).not.toBe(sha);
    git(sb.work, 'push', '-q', 'origin', 'HEAD:feature');
    expect(originSha(sb, 'feature')).toBe(sha);
  });

  it('shows a GitHub origin while pushes land in the bare origin', () => {
    const sb = sandbox('api', 'acme/api');
    expect(sb.slug).toBe('acme/api');
    expect(git(sb.work, 'remote', 'get-url', 'origin')).toBe('https://github.com/acme/api.git');
    expect(git(sb.work, 'remote', 'get-url', '--push', 'origin')).toBe(sb.origin);
    expect(sandbox('web').slug).toBe('acme/web');
  });

  it('never pushes to the network: other https and ssh remotes are rewritten to a missing path', () => {
    const sb = sandbox();
    git(sb.work, 'remote', 'add', 'gh', 'https://github.com/ostrom-hq/ostrom-e2e.git');
    expect(git(sb.work, 'remote', 'get-url', '--push', 'gh')).toBe(`${sb.root}/no-network/github.com/ostrom-hq/ostrom-e2e.git`);
    expect(() => git(sb.work, 'push', '-q', 'gh', 'main')).toThrow();
  });
});
