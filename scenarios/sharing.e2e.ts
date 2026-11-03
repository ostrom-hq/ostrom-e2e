// SPDX-License-Identifier: Apache-2.0
// E2E-SHARE-006: a shared account whose refresh names another provider account is taken out of service
// (`wrong_account`, ostrom-server#134): against the real server, with the fake provider of src/fake-tokens.ts standing
// for both the token endpoint (OSTROM_SHARING_CLAUDE_TOKEN_URL) and the provider's API behind the gateway
// (OSTROM_GATEWAY_ANTHROPIC_URL), so that a call the account served would be seen there.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeTokens } from '../src/fake-tokens.ts';
import { isServed } from '../src/probe.ts';
import { FAKE_TOKENS_PORT, SERVER_URL } from './env.ts';
import { call, email, orgOf, orgsUnavailable, signIn } from './org.ts';

async function unavailable(): Promise<string> {
  if (FAKE_TOKENS_PORT <= 0) return 'no fake provider (OSTROM_E2E_FAKE_TOKENS_PORT)';
  const orgs = await orgsUnavailable();
  if (orgs !== '') return orgs;
  const needed: [string, string][] = [['POST', '/api/v1/accounts'], ['GET', '/api/v1/accounts'], ['POST', '/api/v1/inference/v1/messages']];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

const WHY = await unavailable();
const named = (title: string) => (WHY === '' ? title : `${title} (skipped: ${WHY})`);

describe('E2E-SHARE: shared accounts and the provider', () => {
  const provider = new FakeTokens();
  afterAll(() => provider.stop());

  it.skipIf(WHY !== '')(named('E2E-SHARE-006 a refresh that names another provider account marks the account wrong_account, and it serves no call'), async () => {
    await provider.start(FAKE_TOKENS_PORT);
    const owner = await signIn(email('share-006'));
    await orgOf(owner);
    // Shared under the id its owner declared, with an access token about to expire: the next lease refreshes it.
    const refreshToken = `rt-share-006-${randomUUID()}`;
    const shared = await call(owner.caller, 'POST', '/api/v1/accounts', {
      provider: 'claude',
      label: 'Max of share-006',
      providerAccountId: 'acct-declared-006',
      accessToken: `at-share-006-${randomUUID()}`,
      refreshToken,
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    });
    expect(shared.status, JSON.stringify(shared.body)).toBeLessThan(300);
    // The provider says these tokens are someone else's.
    provider.accounts.set(refreshToken, 'acct-someone-else');

    // The gateway takes an Ostrom token (`Authorization: Bearer`), not the browser's session (run 41524253992): a
    // personal token with `inference:use`, as a member's agent would carry.
    const pat = await call(owner.caller, 'POST', '/api/v1/tokens', { name: 'e2e share-006', scopes: ['inference:use'], expiresInDays: 1 });
    expect(pat.status, JSON.stringify(pat.body)).toBe(201);
    const member = { token: String(pat.body['secret']) };
    const ask = () =>
      call(member, 'POST', '/api/v1/inference/v1/messages', { model: 'claude-sonnet-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] });
    const first = await ask();
    // The refresh happened once, with the declared account's refresh token...
    expect(provider.refreshes.map((r) => r.refreshToken), JSON.stringify(first.body)).toEqual([refreshToken]);
    // ...and the account is out of service: no call went to the provider's API with it, and the call was not served.
    expect(first.status, JSON.stringify(first.body)).not.toBe(200);
    const listed = await call(owner.caller, 'GET', '/api/v1/accounts');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const mine = ((listed.body['items'] as { label: string; status: string }[] | undefined) ?? []).find((a) => a.label === 'Max of share-006');
    expect(mine?.status, JSON.stringify(listed.body)).toBe('wrong_account');

    // Later calls do not lease it: no new refresh, nothing sent to the provider's API.
    const second = await ask();
    expect(second.status, JSON.stringify(second.body)).not.toBe(200);
    expect(provider.refreshes, 'only the one refresh, never a model call').toHaveLength(1);
    expect(provider.refreshes.every((r) => r.grantType === 'refresh_token')).toBe(true);
    expect(provider.calls, 'no model call reached the provider').toEqual([]);
  });
});
