// SPDX-License-Identifier: Apache-2.0
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeTokens, OPENAI_AUTH_CLAIM, idToken } from '../src/fake-tokens.ts';

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

  it("names the account a refresh token is of, as Claude's account.uuid and Codex's id_token, once it is told which", async () => {
    tokens = await new FakeTokens().start();
    tokens.accounts.set('rt-1', 'acct-1');
    const r = await post(tokens.url, JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-1' }));
    const named = (await r.json()) as { account: unknown; id_token: string };
    expect(named).toMatchObject({ access_token: 'fake-access-1', account: { uuid: 'acct-1' }, id_token: idToken('acct-1') });
    // the id_token is a JWT whose claims name the ChatGPT account, as the server reads it
    const parts = named.id_token.split('.');
    expect(parts).toHaveLength(3);
    expect(JSON.parse(Buffer.from(String(parts[1]), 'base64url').toString('utf8'))).toEqual({ [OPENAI_AUTH_CLAIM]: { chatgpt_account_id: 'acct-1' } });
    // told nothing, it names no account at all
    const other = await post(tokens.url, JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-2' }));
    const unnamed = await other.json();
    expect(unnamed).not.toHaveProperty('account');
    expect(unnamed).not.toHaveProperty('id_token');
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

  it('reads a body split anywhere, refuses one past 64 KiB, and survives a request cut off mid-body', async () => {
    tokens = await new FakeTokens().start();
    // é is two bytes: sent byte by byte, it is still é
    const bytes = Buffer.from(JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-é' }), 'utf8');
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const r = await fetch(tokens.url, { method: 'POST', body: split, duplex: 'half' } as RequestInit);
    expect(r.status).toBe(200);
    expect(tokens.refreshes.at(-1)?.refreshToken).toBe('rt-é');
    const big = await post(tokens.url, 'x'.repeat(64 * 1024 + 1));
    expect(big.status).toBe(413);
    // the client goes away after half the body it announced: nothing is recorded, and the endpoint still answers
    const { port } = new URL(tokens.url);
    await new Promise<void>((resolve) => {
      const cut = request({ host: '127.0.0.1', port, path: '/v1/oauth/token', method: 'POST', headers: { 'content-length': '100' } });
      cut.on('error', () => resolve());
      cut.write('{"grant_type":');
      setTimeout(() => cut.destroy(), 50);
    });
    expect(tokens.refreshes).toHaveLength(1);
    expect((await post(tokens.url, JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-2' }))).status).toBe(200);
  });

  it("answers the Messages API with a message that bills the chosen usage, apart from the refreshes", async () => {
    tokens = await new FakeTokens().start();
    const messages = tokens.url.replace('/v1/oauth/token', '/v1/messages');
    const call = (body: unknown) => fetch(messages, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer fake-access-9' }, body: JSON.stringify(body) });
    const first = await call({ model: 'claude-opus-5', max_tokens: 1, messages: [] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      id: 'msg_fake_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
    });
    tokens.usage = { input_tokens: 300_000, output_tokens: 1 };
    const second = (await (await call({ messages: [] })).json()) as { usage: unknown; model?: unknown };
    expect(second.usage).toEqual({ input_tokens: 300_000, output_tokens: 1 });
    expect(second.model).toBeUndefined();
    expect(tokens.calls).toEqual([
      { model: 'claude-opus-5', maxTokens: 1, authorization: 'Bearer fake-access-9' },
      { model: undefined, maxTokens: undefined, authorization: 'Bearer fake-access-9' },
    ]);
    expect(tokens.refreshes).toEqual([]);
  });

  it('listens on the port it is given, refuses one already taken, and stops once', async () => {
    tokens = await new FakeTokens().start();
    await expect(tokens.start(), 'started twice').rejects.toThrow('already listening');
    const port = Number(new URL(tokens.url).port);
    await expect(new FakeTokens().start(port)).rejects.toThrow();
    await tokens.stop();
    await tokens.stop();
    const again = await new FakeTokens().start(port);
    expect(again.url).toBe(`http://127.0.0.1:${port}/v1/oauth/token`);
    await again.stop();
  });
});
