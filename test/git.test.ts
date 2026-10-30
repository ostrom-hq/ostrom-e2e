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

  it('never reaches the network: https and ssh remotes are rewritten to a missing path', () => {
    const sb = sandbox();
    git(sb.work, 'remote', 'add', 'gh', 'https://github.com/ostrom-hq/ostrom-e2e.git');
    expect(git(sb.work, 'remote', 'get-url', '--push', 'gh')).toBe(`${sb.root}/no-network/github.com/ostrom-hq/ostrom-e2e.git`);
    expect(() => git(sb.work, 'push', '-q', 'gh', 'main')).toThrow();
  });
});
