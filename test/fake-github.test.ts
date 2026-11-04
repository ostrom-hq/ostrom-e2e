// SPDX-License-Identifier: Apache-2.0
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/fake-github.ts';

const gh = new FakeGitHub(2);
let url = '';
const call = async (method: string, path: string, init: { token?: string; json?: unknown; form?: Record<string, string>; text?: string } = {}) => {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (init.token) headers['authorization'] = init.token;
  if (init.json !== undefined) [headers['content-type'], body] = ['application/json', JSON.stringify(init.json)];
  if (init.form) [headers['content-type'], body] = ['application/x-www-form-urlencoded', new URLSearchParams(init.form).toString()];
  if (init.text !== undefined) [headers['content-type'], body] = ['text/plain', init.text];
  const r = await fetch(url + path, { method, headers, ...(body === undefined ? {} : { body }) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  url = await gh.start();
});
afterAll(async () => {
  await gh.stop();
  await gh.stop();
});

describe('FakeGitHub', () => {
  it('names the user behind a token, in both header forms, and refuses unknown tokens', async () => {
    const t = gh.user('rev-b');
    expect((await call('GET', '/user', { token: `token ${t}` })).json).toMatchObject({ login: 'rev-b', type: 'User' });
    expect((await call('GET', '/user', { token: `Bearer ${t}` })).status).toBe(200);
    expect((await call('GET', '/user')).status).toBe(401);
    expect((await call('GET', '/user?x=1', { token: 'token nope' })).status).toBe(401);
    expect((await call('GET', '/orgs/x', { token: `token ${t}` })).status).toBe(404);
  });

  it('keeps one GitHub id per login, decodes paths and answers 400 to malformed JSON', async () => {
    const first = gh.user('same');
    const id = (await call('GET', '/user', { token: `token ${first}` })).json['id'];
    const second = gh.user('same', 'gho_other');
    expect((await call('GET', '/user', { token: `token ${second}` })).json['id']).toBe(id);
    gh.compare('acme/api', 'main', 'feat/x', ['c9']);
    expect((await call('GET', '/repos/acme/api/compare/main...feat%2Fx', { token: `token ${first}` })).json['total_commits']).toBe(1);
    const bad = await fetch(`${url}/user`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(bad.status).toBe(400);
  });

  it('runs the device flow: pending, then a token for the prepared login', async () => {
    expect((await call('POST', '/login/device/code', { form: { client_id: 'c' } })).status).toBe(404);
    gh.deviceLogin('stale');
    const code = gh.deviceLogin('dev-a');
    const start = await call('POST', '/login/device/code', { form: { client_id: 'c' } });
    expect(start.json).toMatchObject({ device_code: code, interval: 0 });
    expect((await call('POST', '/login/oauth/access_token', { json: { device_code: code } })).json).toEqual({ error: 'authorization_pending' });
    const done = await call('POST', '/login/oauth/access_token', { form: { device_code: code } });
    expect((await call('GET', '/user', { token: `token ${String(done.json['access_token'])}` })).json['login']).toBe('dev-a');
    expect((await call('POST', '/login/oauth/access_token', { text: 'device_code=x' })).json).toEqual({ error: 'expired_token' });
    gh.deviceLogin('later');
    expect((await call('POST', '/login/oauth/access_token', { json: { device_code: code } })).json['access_token']).toBe('gho_dev-a');
  });

  it('runs the web OAuth flow: a one-time code for the prepared login, with its verified address', async () => {
    const code = gh.oauthCode('rev-c', 'rev-c@e2e.ostrom.test');
    const done = await call('POST', '/login/oauth/access_token', { form: { code, client_id: 'c', code_verifier: 'v' } });
    expect(done.json).toMatchObject({ access_token: 'gho_rev-c' });
    expect((await call('POST', '/login/oauth/access_token', { form: { code } })).json).toEqual({ error: 'bad_verification_code' });
    const t = `Bearer ${String(done.json['access_token'])}`;
    expect((await call('GET', '/user', { token: t })).json['login']).toBe('rev-c');
    expect((await fetch(`${url}/user/emails`, { headers: { authorization: t } }).then((r) => r.json()))).toEqual([{ email: 'rev-c@e2e.ostrom.test', primary: true, verified: true }]);
    expect((await fetch(`${url}/user/emails`, { headers: { authorization: `token ${gh.user('noaddr')}` } }).then((r) => r.json()))).toEqual([]);
    expect(gh.oauthCode('rev-c', 'rev-c@e2e.ostrom.test')).not.toBe(code);
  });

  it('listens on the port it is given', async () => {
    const fixed = new FakeGitHub();
    const free = new FakeGitHub();
    const port = Number(new URL(await free.start()).port);
    await free.stop();
    expect(await fixed.start(port)).toBe(`http://127.0.0.1:${port}`);
    await fixed.stop();
  });

  it('serves pull requests, compare and check runs, and records every request', async () => {
    const t = `token ${gh.user('app')}`;
    gh.pull('acme/api', { number: 3, headSha: 'abc', baseRef: 'main', headRef: 'feat' });
    gh.compare('acme/api', 'main', 'abc', ['c1', 'c2']);
    expect((await call('GET', '/repos/acme/api/pulls/3', { token: t })).json).toEqual({ number: 3, state: 'open', merged: false, head: { sha: 'abc', ref: 'feat' }, base: { ref: 'main' }, user: { login: 'octocat' } });
    expect((await call('GET', '/repos/acme/api/pulls/4', { token: t })).status).toBe(404);
    expect((await call('GET', '/repos/acme/api/compare/main...abc', { token: t })).json).toEqual({ commits: [{ sha: 'c1' }, { sha: 'c2' }], total_commits: 2 });
    expect((await call('GET', '/repos/acme/api/compare/main...zzz', { token: t })).status).toBe(404);
    const created = await call('POST', '/repos/acme/api/check-runs', { token: t, json: { name: 'ostrom-gate', head_sha: 'abc' } });
    expect(created.json).toMatchObject({ name: 'ostrom-gate', status: 'queued', conclusion: null });
    const id = Number(created.json['id']);
    await call('POST', '/repos/acme/api/check-runs', { token: t, json: { name: 'x', head_sha: 'abc', status: 'completed', conclusion: 'success' } });
    expect((await call('PATCH', `/repos/acme/api/check-runs/${id}`, { token: t, json: { status: 'completed', conclusion: 'failure' } })).json).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect((await call('PATCH', `/repos/acme/api/check-runs/${id}`, { token: t, json: { status: 1 } })).json).toMatchObject({ status: 'completed' });
    expect((await call('PATCH', `/repos/acme/other/check-runs/${id}`, { token: t, json: {} })).status).toBe(404);
    expect((await call('DELETE', '/repos/acme/api/pulls/3', { token: t, text: '' })).status).toBe(404);
    expect(gh.checkRuns.map((r) => r.conclusion)).toEqual(['failure', 'success']);
    expect(gh.requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/repos/acme/api/pulls/3', authorization: t });
  });

  it('sends webhooks signed like GitHub', async () => {
    const seen: { headers: Record<string, unknown>; body: string }[] = [];
    const sink = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(202).end();
      });
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
    const status = await gh.webhook(`http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`, 's3cret', 'push', { ref: 'refs/heads/main' });
    sink.close();
    expect(status).toBe(202);
    const sent = seen[0];
    expect(sent?.headers['x-github-event']).toBe('push');
    expect(sent?.headers['x-hub-signature-256']).toBe(`sha256=${createHmac('sha256', 's3cret').update(sent?.body ?? '').digest('hex')}`);
  });

  it('installs the App: its JWT reads an installation and gets a token that acts on its repositories', async () => {
    gh.installation(42, 'acme', 'acme-admin');
    const jwt = 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig';
    expect((await call('GET', '/app/installations/42', { token: jwt })).json).toEqual({ id: 42, account: { login: 'acme' } });
    expect((await call('GET', '/app/installations/7', { token: jwt })).status).toBe(404);
    expect((await call('GET', '/app/installations/42', { token: 'Bearer gho_x' })).status).toBe(401);
    expect((await call('GET', '/app/installations/42')).status).toBe(401);
    expect((await call('DELETE', '/app/installations/42', { token: jwt, text: '' })).status).toBe(404);
    expect((await call('GET', '/app/installations/42/access_tokens', { token: jwt })).status).toBe(404);
    const issued = await call('POST', '/app/installations/42/access_tokens', { token: jwt, json: {} });
    expect(issued.status).toBe(201);
    expect(String(issued.json['expires_at'])).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    gh.pull('acme/api', { number: 9, headSha: 'h9', baseRef: 'main', headRef: 'f' });
    const token = `Bearer ${String(issued.json['token'])}`;
    expect((await call('GET', '/repos/acme/api/pulls/9', { token })).json).toMatchObject({ number: 9 });
    expect((await call('GET', '/user', { token })).json['login']).toBe('acme[bot]');
  });

  it('exchanges the install’s code once, with the App’s OAuth client, for the token of the person who authorized', async () => {
    const client = { client_id: gh.oauth.id, client_secret: gh.oauth.secret };
    const code = gh.webCode('acme-admin');
    expect((await call('POST', '/login/oauth/access_token', { form: { client_id: 'other', client_secret: gh.oauth.secret, code } })).json).toEqual({ error: 'incorrect_client_credentials' });
    expect((await call('POST', '/login/oauth/access_token', { form: { client_id: gh.oauth.id, client_secret: 'no', code } })).json).toEqual({ error: 'incorrect_client_credentials' });
    expect((await call('POST', '/login/oauth/access_token', { form: { ...client, code: 'forged' } })).json).toEqual({ error: 'bad_verification_code' });
    const done = await call('POST', '/login/oauth/access_token', { form: { ...client, code } });
    expect(String(done.json['access_token'])).toMatch(/^ghu_acme-admin_/);
    expect((await call('GET', '/user', { token: `Bearer ${String(done.json['access_token'])}` })).json['login']).toBe('acme-admin');
    expect((await call('POST', '/login/oauth/access_token', { json: { ...client, code } })).json).toEqual({ error: 'bad_verification_code' });
  });

  it('lists only the installations a person administers: org B’s owner never sees acme’s', async () => {
    gh.installation(42, 'acme', 'acme-admin');
    gh.installation(43, 'globex', 'globex-admin', 'acme-admin');
    for (let i = 0; i < 3; i++) gh.installation(100 + i, `many-${i}`, 'collector');
    const globex = `Bearer ${gh.user('globex-admin')}`;
    expect((await call('GET', '/user/installations', { token: globex })).json).toEqual({ total_count: 1, installations: [{ id: 43, account: { login: 'globex' } }] });
    const acme = (await call('GET', '/user/installations?per_page=100&page=1', { token: `Bearer ${gh.user('acme-admin')}` })).json;
    expect((acme['installations'] as { id: number }[]).map((i) => i.id)).toEqual([42, 43]);
    const collector = `Bearer ${gh.user('collector')}`;
    const page2 = (await call('GET', '/user/installations?per_page=2&page=2', { token: collector })).json;
    expect(page2).toEqual({ total_count: 3, installations: [{ id: 102, account: { login: 'many-2' } }] });
    const capped = (await call('GET', '/user/installations?per_page=500', { token: collector })).json;
    expect((capped['installations'] as unknown[]).length).toBe(3);
    expect((await call('GET', '/user/installations')).status).toBe(401);
  });

  it('listens on a fixed port when asked', async () => {
    const fixed = new FakeGitHub();
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    expect(await fixed.start(port)).toBe(`http://127.0.0.1:${port}`);
    await fixed.stop();
  });
});
