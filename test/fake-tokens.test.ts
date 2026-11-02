// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { FakeTokens } from '../src/fake-tokens.ts';

let tokens: FakeTokens | undefined;
afterEach(async () => {
  await tokens?.stop();
  tokens = undefined;
});

const post = (url: string, body: string, type = 'application/json') =>
  fetch(url, { method: 'POST', headers: { 'content-type': type }, body });

describe('FakeTokens', () => {
  it('renews a refresh token with a new pair and records what it was sent', async () => {
    tokens = await new FakeTokens().start();
    expect(tokens.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/oauth\/token$/);
    const r = await post(tokens.url, JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'cid' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ access_token: 'fake-access-1', refresh_token: 'fake-refresh-1', expires_in: 28_800, token_type: 'Bearer' });
    expect(tokens.refreshes).toEqual([{ grantType: 'refresh_token', refreshToken: 'rt-1', clientId: 'cid' }]);
  });

  it('refuses a forgotten refresh token with invalid_grant, and a malformed request with invalid_request', async () => {
    tokens = await new FakeTokens().start();
    tokens.refused.add('rt-dead');
    const dead = await post(tokens.url, JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-dead' }));
    expect(dead.status).toBe(400);
    expect(await dead.json()).toEqual({ error: 'invalid_grant' });
    // a form body is read too; without a refresh token, or with another grant, the request is malformed
    const form = await post(tokens.url, 'grant_type=authorization_code&code=x', 'application/x-www-form-urlencoded');
    expect(await form.json()).toEqual({ error: 'invalid_request' });
    const none = await post(tokens.url, JSON.stringify({ grant_type: 'refresh_token', refresh_token: 7 }));
    expect(none.status).toBe(400);
    expect((await post(tokens.url, 'null')).status).toBe(400);
    expect((await post(tokens.url, '42')).status).toBe(400);
    const get = await fetch(tokens.url);
    expect(get.status).toBe(405);
    expect(tokens.refreshes.map((r) => r.refreshToken)).toEqual(['rt-dead', undefined, undefined, undefined, undefined]);
    expect(tokens.refreshes[1]).toEqual({ grantType: 'authorization_code', refreshToken: undefined, clientId: undefined });
  });

  it('listens on the port it is given, refuses one already taken, and stops once', async () => {
    tokens = await new FakeTokens().start();
    const port = Number(new URL(tokens.url).port);
    await expect(new FakeTokens().start(port)).rejects.toThrow();
    await tokens.stop();
    await tokens.stop();
    const again = await new FakeTokens().start(port);
    expect(again.url).toBe(`http://127.0.0.1:${port}/v1/oauth/token`);
    await again.stop();
  });
});
