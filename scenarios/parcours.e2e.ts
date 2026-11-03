// SPDX-License-Identifier: Apache-2.0
// E2E-PARC : the client journey of demo/PARCOURS.md (steps 2.2 to 6.7), each step against the real server. Every test
// probes the exact routes it needs and stays skipped, with the missing routes in its title, until they are on main:
// the bench switches each step on by itself as the server pull requests land. Steps already covered by another family
// (AUTH, LOGIN, YES, ISO, BILL, GATE) are not repeated here: the mapping is at the top of the PARC section of
// SCENARIOS.md. Screens (web, app) are out of the bench's scope: each scenario proves the server route the screen reads.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Caller } from '../src/isolation.ts';
import { invitationToken } from '../src/mail.ts';
import { isServed } from '../src/probe.ts';
import { MAIL_DIR, SERVER_URL } from './env.ts';
import { type Org, type Person, call, email, invite, join, orgOf, orgsUnavailable, profileOf, signIn } from './org.ts';

const ORGS = await orgsUnavailable();
const ID = randomUUID();
const T = 90_000;

/** '' when every route is served (and people can be made), else why the scenario waits. */
async function needs(...routes: [string, string][]): Promise<string> {
  if (ORGS !== '') return ORGS;
  const missing: string[] = [];
  for (const [method, path] of routes) if (!(await isServed(SERVER_URL, path.replaceAll('{id}', ID), method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}
const named = (title: string, why: string) => (why ? `${title} (skipped: ${why})` : title);

interface Owner {
  readonly person: Person;
  readonly org: Org;
  /** The owner's caller with `Ostrom-Org` set to its organization, for the "current org" routes. */
  readonly c: Caller;
}

/** A fresh person with an organization of its own. */
async function owner(who: string): Promise<Owner> {
  const person = await signIn(email(who));
  const org = await orgOf(person);
  return { person, org, c: { ...person.caller, org: org.id } };
}

/** The items of a page (`{items}`), of a named list (`{tokens}`), or of a bare array. */
function itemsOf(body: unknown, key = 'items'): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const list = (body as Record<string, unknown> | undefined)?.[key];
  expect(Array.isArray(list), `no ${key} list in ${JSON.stringify(body)}`).toBe(true);
  return list as Record<string, unknown>[];
}

/** Nothing of the owner comes back to `other`: a refusal, or a list without the marker. */
async function hidden(other: Caller, path: string, marker: string) {
  const r = await call(other, 'GET', path);
  expect(r.status, `${path} → ${r.status}`).toBeLessThan(500);
  expect(JSON.stringify(r.body ?? '')).not.toContain(marker);
}

/** Without a credential the route answers 401 with the error envelope. */
async function needsCredential(method: string, path: string, body?: unknown) {
  const r = await call({}, method, path, body);
  expect(r.status, `${method} ${path} without credential`).toBe(401);
  expect(r.body?.['error'], `${method} ${path}: no error envelope`).toBeTruthy();
}

// ---------------------------------------------------------------------------------------------- 2. Organization setup

// The routes of the current org (rules, secrets, budgets, workflows, receipts…) resolve a person's org from its only
// membership or the `Ostrom-Org` header: ostrom-server#64. Before it, a person gets 403 « belongs to no organization »
// or 404 « Organization not found » there (run 41052130887; JOURNAL 10:00). Marker: `GET /api/v1/me/organizations`.
const ORG64 = (await needs(['GET', '/api/v1/me/organizations'])) === '' ? '' : 'needs the current org of a person, ostrom-server#64';
// The gates, compiler, sessions and GitHub routes resolve their caller by `GateActorResolver`: on server main only
// `NoGateActors` is bound (always null, 403 "belongs to no organization") until `LaunchGateActors` of ostrom-server#84
// (JOURNAL 02/11 16:20, run 41467580197). `POST /api/v1/launches` comes with it.
const ACTORS = ORG64 || ((await needs(['POST', '/api/v1/launches'])) === '' ? '' : 'needs a real GateActorResolver, ostrom-server#84');
const W001 = await needs(['POST', '/api/v1/orgs'], ['GET', '/api/v1/orgs/{id}']);
const W002 = await needs(['GET', '/api/v1/me/organizations']);
const W003 = await needs(['GET', '/api/v1/orgs/{id}']);
const W004 = await needs(['GET', '/api/v1/github/app/install/start'], ['GET', '/api/v1/github/app/install/callback'], ['GET', '/api/v1/repos'], ['GET', '/api/v1/github/app/manifest/start']);
const W005 = await needs(['GET', '/api/v1/orgs/{id}/members'], ['PATCH', '/api/v1/orgs/{id}/members/{id}']);
const W006 = await needs(['POST', '/api/v1/invitations/preview']);
const W007 = (await needs(['GET', '/api/v1/accounts'], ['POST', '/api/v1/accounts'], ['PATCH', '/api/v1/accounts/{id}'], ['DELETE', '/api/v1/accounts/{id}'], ['GET', '/api/v1/inference/v1/models'])) || ORG64;
const W008 = (await needs(['POST', '/api/v1/mcp/servers'], ['PUT', '/api/v1/mcp/servers/{id}'], ['DELETE', '/api/v1/mcp/servers/{id}'], ['GET', '/api/v1/mcp/calls'], ['GET', '/api/v1/mcp/usage'])) || ORG64;
const W009 = (await needs(['POST', '/api/v1/secrets'], ['GET', '/api/v1/secrets'], ['PUT', '/api/v1/secrets/{id}'], ['DELETE', '/api/v1/secrets/{id}'])) || ORG64;
const W010 = await needs(['POST', '/api/v1/tokens'], ['GET', '/api/v1/tokens'], ['POST', '/api/v1/tokens/{id}/rotate'], ['DELETE', '/api/v1/tokens/{id}']);
const W011 = await needs(['GET', '/api/v1/service-keys'], ['POST', '/api/v1/service-keys'], ['GET', '/api/v1/devices'], ['GET', '/api/v1/auth/sessions']);
const W041 = await needs(['GET', '/api/v1/orgs/{id}'], ['PATCH', '/api/v1/orgs/{id}'], ['POST', '/api/v1/orgs/{id}/members/invites']);
const W042 = (await needs(['DELETE', '/api/v1/orgs/{id}'], ['GET', '/api/v1/orgs/{id}'], ['POST', '/api/v1/orgs/{id}/members/invites'], ['POST', '/api/v1/secrets'], ['POST', '/api/v1/tokens'])) || ORG64;

describe('E2E-PARC: 2. organization setup', () => {
  it.skipIf(W001 !== '')(named('E2E-PARC-001 — 2.2 a new person creates an organization and reads it back, owner', W001), async () => {
    const p = await signIn(email('parc-001'));
    const name = `Parc 001 ${randomUUID().slice(0, 6)}`;
    const made = await call(p.caller, 'POST', '/api/v1/orgs', { name });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ name, role: 'owner' });
    expect(typeof made.body['id']).toBe('string');
    expect(typeof made.body['slug']).toBe('string');
    const back = await call(p.caller, 'GET', `/api/v1/orgs/${made.body['id'] as string}`);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ id: made.body['id'], slug: made.body['slug'], name });
    await needsCredential('POST', '/api/v1/orgs', { name: 'no credential' });
  }, T);

  it.skipIf(W002 !== '')(named('E2E-PARC-002 — 2.3 a member of two organizations lists both and acts in the one Ostrom-Org names', W002), async () => {
    const a = await owner('parc-002-a');
    const b = await owner('parc-002-b');
    expect((await invite(b.person, b.org.id, [a.person.email])).status).toBeLessThan(300);
    const { accepted } = await join(a.person.email);
    expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
    const mine = await call(a.person.caller, 'GET', '/api/v1/me/organizations');
    expect(mine.status).toBe(200);
    const items = itemsOf(mine.body);
    for (const o of items) for (const k of ['id', 'slug', 'name', 'role']) expect(typeof o[k], `${k} of ${JSON.stringify(o)}`).toBe('string');
    expect(items.map((o) => o['id'])).toEqual(expect.arrayContaining([a.org.id, b.org.id]));
    expect(items.find((o) => o['id'] === a.org.id)?.['role']).toBe('owner');
    expect(items.find((o) => o['id'] === b.org.id)?.['role']).toBe('member');
    // An organization the person is not in: a refusal, never the other organization's data.
    const c = await owner('parc-002-c');
    const foreign = await call({ ...a.person.caller, org: c.org.id }, 'GET', '/api/v1/budgets');
    expect([400, 403, 404]).toContain(foreign.status);
    expect(JSON.stringify(foreign.body)).not.toContain(c.org.id);
    // Only the caller's own memberships.
    expect(JSON.stringify(itemsOf((await call(c.person.caller, 'GET', '/api/v1/me/organizations')).body))).not.toContain(a.org.id);
    await needsCredential('GET', '/api/v1/me/organizations');
  }, T);

  it.skipIf(W003 !== '')(named('E2E-PARC-003 — 2.4 the organization reads back by id and by slug with its name and role; another org sees nothing', W003), async () => {
    const a = await owner('parc-003-a');
    const r = await call(a.person.caller, 'GET', `/api/v1/orgs/${a.org.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: a.org.id, slug: a.org.slug, name: a.org.name, role: 'owner' });
    const bySlug = await call(a.person.caller, 'GET', `/api/v1/orgs/${a.org.slug}`);
    expect(bySlug.body?.['id']).toBe(a.org.id);
    const b = await owner('parc-003-b');
    await hidden(b.person.caller, `/api/v1/orgs/${a.org.id}`, a.org.name);
    await needsCredential('GET', `/api/v1/orgs/${a.org.id}`);
  }, T);

  it.skipIf(W004 !== '')(named('E2E-PARC-004 — 2.5 GitHub App: install starts at GitHub, a forged callback is refused, repositories listed per org', W004), async () => {
    const a = await owner('parc-004');
    const start = await fetch(SERVER_URL.replace(/\/$/, '') + '/api/v1/github/app/install/start', { headers: { cookie: a.person.caller.cookie ?? '', 'ostrom-org': a.org.id }, redirect: 'manual' });
    expect([302, 303, 307]).toContain(start.status);
    const to = new URL(start.headers.get('location') ?? 'about:blank');
    expect(to.pathname).toMatch(/installations\/new|apps\//);
    expect(to.searchParams.get('state')).toBeTruthy();
    // A callback whose state was never issued installs nothing.
    const forged = await call(a.c, 'GET', '/api/v1/github/app/install/callback?installation_id=1&setup_action=install&state=forged');
    expect(forged.status).toBeGreaterThanOrEqual(400);
    expect(forged.status).toBeLessThan(500);
    const repos = await call(a.c, 'GET', '/api/v1/repos');
    expect(repos.status).toBe(200);
    expect(itemsOf(repos.body)).toEqual([]);
    const manifest = await fetch(SERVER_URL.replace(/\/$/, '') + '/api/v1/github/app/manifest/start', { redirect: 'manual' });
    expect(manifest.status).toBe(401);
    await needsCredential('GET', '/api/v1/repos');
  }, T);

  it.skipIf(W005 !== '')(named('E2E-PARC-005 — 2.6 the owner invites, the invited member appears, the owner changes the role, a member cannot', W005), async () => {
    const a = await owner('parc-005');
    const invited = email('parc-005-m');
    const sent = await invite(a.person, a.org.id, [invited]);
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    const pending = await call(a.person.caller, 'GET', `/api/v1/orgs/${a.org.id}/invitations`);
    expect(JSON.stringify(pending.body)).toContain(invited);
    const { person, accepted } = await join(invited);
    expect(accepted.status).toBeLessThan(300);
    const login = (await profileOf(person.caller)).login;
    const members = itemsOf((await call(a.person.caller, 'GET', `/api/v1/orgs/${a.org.id}/members`)).body, 'items');
    expect(JSON.stringify(members)).toContain(login);
    const path = `/api/v1/orgs/${a.org.id}/members/${encodeURIComponent(login)}`;
    const up = await call(a.person.caller, 'PATCH', path, { role: 'admin' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body?.['role']).toBe('admin');
    expect((await call(a.person.caller, 'GET', path)).body?.['role']).toBe('admin');
    // The member, now admin, cannot make itself owner; a stranger reads nothing.
    const self = await call(person.caller, 'PATCH', path, { role: 'owner' });
    expect([400, 403, 409, 422]).toContain(self.status);
    const b = await owner('parc-005-b');
    await hidden(b.person.caller, `/api/v1/orgs/${a.org.id}/members`, login);
  }, T);

  it.skipIf(W006 !== '' || MAIL_DIR === '')(named('E2E-PARC-006 — 2.7 the invitation previews (org, role, e-mail) before it is accepted, once', W006 || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '')), async () => {
    const a = await owner('parc-006');
    const invited = email('parc-006-m');
    expect((await invite(a.person, a.org.id, [invited], 'admin')).status).toBeLessThan(300);
    const token = invitationToken(MAIL_DIR, invited);
    expect(token).toBeTruthy();
    const preview = await call({}, 'POST', '/api/v1/invitations/preview', { token });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ orgName: a.org.name, orgSlug: a.org.slug, role: 'admin', email: invited });
    expect(typeof preview.body['expiresAt']).toBe('string');
    const { accepted } = await join(invited);
    expect(accepted.status).toBeLessThan(300);
    const again = await call((await signIn(invited)).caller, 'POST', '/api/v1/invitations/accept', { token });
    expect(again.status).toBeGreaterThanOrEqual(400);
    const forged = await call({}, 'POST', '/api/v1/invitations/preview', { token: 'forged' });
    expect([400, 404, 410]).toContain(forged.status);
  }, T);

  it.skipIf(W007 !== '')(named('E2E-PARC-007 — 2.8 a shared model account is added, edited, paused, removed; its token never comes back; the relay lists models', W007), async () => {
    const a = await owner('parc-007');
    const accessToken = `sk-ant-oat01-parc-${randomUUID()}`;
    const made = await call(a.c, 'POST', '/api/v1/accounts', {
      provider: 'claude', label: 'Parc 007', providerAccountId: `acct-${ID}`, accessToken, refreshToken: `rt-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect(made.body).toMatchObject({ provider: 'claude', label: 'Parc 007', mine: true });
    expect(JSON.stringify(made.body)).not.toContain(accessToken);
    const id = made.body['id'] as string;
    const listed = await call(a.c, 'GET', '/api/v1/accounts');
    expect(JSON.stringify(listed.body)).toContain(id);
    expect(JSON.stringify(listed.body)).not.toContain(accessToken);
    const edited = await call(a.c, 'PATCH', `/api/v1/accounts/${id}`, { label: 'Parc 007 bis', paused: true });
    expect(edited.body).toMatchObject({ id, label: 'Parc 007 bis', paused: true });
    const b = await owner('parc-007-b');
    await hidden(b.c, '/api/v1/accounts', id);
    expect((await call(a.c, 'DELETE', `/api/v1/accounts/${id}`)).status).toBeLessThan(300);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/accounts')).body)).not.toContain(id);
    // The relay speaks the providers' APIs: a member lists the models of its policy, nobody without a credential.
    const models = await call(a.c, 'GET', '/api/v1/inference/v1/models');
    if (models.status === 200) expect(models.body?.['object']).toBe('list');
    else expect([401, 403]).toContain(models.status);
    await needsCredential('GET', '/api/v1/inference/v1/models');
    await needsCredential('POST', '/api/v1/inference/v1/messages', { model: 'claude', messages: [] });
  }, T);

  it.skipIf(W008 !== '')(named('E2E-PARC-008 — 2.9 an MCP server is declared, edited and removed; calls and usage read back per org', W008), async () => {
    const a = await owner('parc-008');
    const name = `parc-${randomUUID().slice(0, 8)}`;
    const made = await call(a.c, 'POST', '/api/v1/mcp/servers', { name, url: 'https://mcp.example.test/mcp', transport: 'http', tools: ['search'] });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect(made.body).toMatchObject({ name, transport: 'http', enabled: true });
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/mcp/servers')).body).map((s) => s['name'])).toContain(name);
    // A server stays enabled (`McpServerDto.enabled`: "Always true"); an edit changes its URL and bumps its version.
    const edited = await call(a.c, 'PUT', `/api/v1/mcp/servers/${name}`, { name, url: 'https://mcp.example.test/v2', transport: 'http', version: made.body['version'] });
    expect(edited.body, JSON.stringify(edited.body)).toMatchObject({ name, url: 'https://mcp.example.test/v2', enabled: true });
    expect(Number(edited.body['version'])).toBeGreaterThan(Number(made.body['version']));
    const calls = await call(a.c, 'GET', '/api/v1/mcp/calls');
    expect(calls.status).toBe(200);
    expect(itemsOf(calls.body)).toEqual([]);
    const usage = await call(a.c, 'GET', '/api/v1/mcp/usage');
    expect(usage.status).toBe(200);
    expect(typeof usage.body).toBe('object');
    const b = await owner('parc-008-b');
    await hidden(b.c, '/api/v1/mcp/servers', name);
    expect((await call(a.c, 'DELETE', `/api/v1/mcp/servers/${name}`)).status).toBeLessThan(300);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/mcp/servers')).body)).not.toContain(name);
    await needsCredential('GET', '/api/v1/mcp/servers');
  }, T);

  it.skipIf(W009 !== '')(named('E2E-PARC-009 — 2.10 a secret is written, rotated and deleted; its value is never read back', W009), async () => {
    const a = await owner('parc-009');
    const name = `PARC_${randomUUID().slice(0, 8).toUpperCase()}`;
    const value = `v1-${randomUUID()}`;
    const made = await call(a.c, 'POST', '/api/v1/secrets', { name, value });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect(made.body).toMatchObject({ name, version: 1 });
    expect(JSON.stringify(made.body)).not.toContain(value);
    const rotated = `v2-${randomUUID()}`;
    const put = await call(a.c, 'PUT', `/api/v1/secrets/${name}`, { name, value: rotated });
    expect(put.body).toMatchObject({ name, version: 2 });
    const list = await call(a.c, 'GET', '/api/v1/secrets');
    const text = JSON.stringify(list.body);
    expect(itemsOf(list.body).map((s) => s['name'])).toContain(name);
    for (const v of [value, rotated]) expect(text).not.toContain(v);
    for (const s of itemsOf(list.body)) expect(s).not.toHaveProperty('value');
    const b = await owner('parc-009-b');
    await hidden(b.c, '/api/v1/secrets', name);
    expect((await call(a.c, 'DELETE', `/api/v1/secrets/${name}`)).status).toBeLessThan(300);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/secrets')).body)).not.toContain(name);
    await needsCredential('GET', '/api/v1/secrets');
  }, T);

  it.skipIf(W010 !== '')(named('E2E-PARC-010 — 2.11 a console token is created once with its secret, listed by hint, rotated, revoked', W010), async () => {
    const a = await owner('parc-010');
    const made = await call(a.c, 'POST', '/api/v1/tokens', { name: 'parc-010', scopes: ['profile:read'], expiresInDays: 7 });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const token = made.body['token'] as Record<string, unknown>;
    const secret = made.body['secret'] as string;
    expect(token).toMatchObject({ name: 'parc-010', scopes: ['profile:read'] });
    expect(secret.length).toBeGreaterThan(20);
    const listed = await call(a.c, 'GET', '/api/v1/tokens');
    expect(itemsOf(listed.body, 'tokens').map((t) => t['id'])).toContain(token['id']);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    // The token works for its scope, then its rotation retires the old secret.
    expect((await call({ token: secret }, 'GET', '/api/v1/auth/me')).status).toBe(200);
    const rotated = await call(a.c, 'POST', `/api/v1/tokens/${token['id'] as string}/rotate`);
    expect(rotated.status).toBe(201);
    expect(typeof rotated.body?.['secret']).toBe('string');
    expect((await call({ token: rotated.body['secret'] as string }, 'GET', '/api/v1/auth/me')).status).toBe(200);
    const next = (rotated.body['token'] as Record<string, unknown>)['id'] as string;
    expect((await call({ token: secret }, 'GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await call(a.c, 'DELETE', `/api/v1/tokens/${next}`)).status).toBe(204);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/tokens')).body)).not.toContain(next);
    expect((await call({ token: rotated.body['secret'] as string }, 'GET', '/api/v1/auth/me')).status).toBe(401);
  }, T);

  it.skipIf(W011 !== '')(named('E2E-PARC-011 — 2.11 service keys, devices and browser sessions are listed and revocable by their owner', W011), async () => {
    const a = await owner('parc-011');
    const key = await call(a.c, 'POST', '/api/v1/service-keys', { name: 'parc-011 ci', scopes: ['sessions:write', 'rules:read'] });
    expect(key.status, JSON.stringify(key.body)).toBe(201);
    // Since ostrom-server#158 a service key holds only what a CI needs: sessions:write and rules:read.
    expect((await call(a.c, 'POST', '/api/v1/service-keys', { name: 'parc-011 reader', scopes: ['receipts:read'] })).status).toBe(400);
    expect(key.body['name']).toBe('parc-011 ci');
    expect([...(key.body['scopes'] as string[])].sort(), JSON.stringify(key.body)).toEqual(['rules:read', 'sessions:write']);
    expect(typeof key.body['secret']).toBe('string');
    const keys = await call(a.c, 'GET', '/api/v1/service-keys');
    expect(itemsOf(keys.body).map((k) => k['id'])).toContain(key.body['id']);
    expect(JSON.stringify(keys.body)).not.toContain(key.body['secret'] as string);
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/devices')).body)).toEqual([]);
    const sessions = itemsOf((await call(a.c, 'GET', '/api/v1/auth/sessions')).body);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const b = await owner('parc-011-b');
    await hidden(b.c, '/api/v1/service-keys', key.body['id'] as string);
    for (const p of ['/api/v1/service-keys', '/api/v1/devices', '/api/v1/auth/sessions']) await needsCredential('GET', p);
  }, T);

  it.skipIf(W041 !== '')(named('E2E-PARC-041 — 2.11 an admin renames the organization and sets its time zone; a member cannot, another org gets 404', W041), async () => {
    const a = await owner('parc-041');
    const admin = email('parc-041-admin');
    const member = email('parc-041-member');
    expect((await invite(a.person, a.org.id, [admin], 'admin')).status).toBeLessThan(300);
    expect((await invite(a.person, a.org.id, [member])).status).toBeLessThan(300);
    const ad = await join(admin);
    const me = await join(member);
    expect(ad.accepted.status, JSON.stringify(ad.accepted.body)).toBeLessThan(300);
    expect(me.accepted.status, JSON.stringify(me.accepted.body)).toBeLessThan(300);
    const path = `/api/v1/orgs/${a.org.id}`;
    // A new organization is in UTC until an owner or an admin sets its zone.
    expect((await call(a.person.caller, 'GET', path)).body).toMatchObject({ id: a.org.id, timeZone: 'UTC' });

    const name = `Parc 041 ${randomUUID().slice(0, 6)}`;
    const changed = await call(ad.person.caller, 'PATCH', path, { name, timeZone: 'Europe/Paris' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body).toMatchObject({ id: a.org.id, slug: a.org.slug, name, timeZone: 'Europe/Paris', role: 'admin' });
    // Read back by the owner, by id and by short name, and in the owner's list.
    for (const ref of [a.org.id, a.org.slug]) {
      expect((await call(a.person.caller, 'GET', `/api/v1/orgs/${ref}`)).body).toMatchObject({ name, timeZone: 'Europe/Paris' });
    }
    expect(itemsOf((await call(a.person.caller, 'GET', '/api/v1/orgs')).body).find((o) => o['id'] === a.org.id)).toMatchObject({ name });
    // A field left out stays as it is; the short name is accepted unchanged and never changes.
    const zoneOnly = await call(a.person.caller, 'PATCH', path, { timeZone: 'America/New_York', slug: a.org.slug });
    expect(zoneOnly.status, JSON.stringify(zoneOnly.body)).toBe(200);
    expect(zoneOnly.body).toMatchObject({ name, slug: a.org.slug, timeZone: 'America/New_York' });
    expect((await call(a.person.caller, 'PATCH', path, { slug: `${a.org.slug}-x` })).status).toBe(400);
    expect((await call(a.person.caller, 'PATCH', path, { timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect((await call(a.person.caller, 'PATCH', path, { name: '' })).status).toBe(400);

    // A plain member is refused, and changes nothing.
    const refused = await call(me.person.caller, 'PATCH', path, { name: 'by a member' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body?.['error']).toBeTruthy();
    // Another organization's owner: 404, as for a missing organization, and the name stays.
    const b = await owner('parc-041-b');
    const foreign = await call(b.person.caller, 'PATCH', path, { name: 'by another org' });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain(name);
    expect((await call(b.person.caller, 'PATCH', `/api/v1/orgs/${randomUUID()}`, { name: 'nowhere' })).status).toBe(404);
    expect((await call(a.person.caller, 'GET', path)).body).toMatchObject({ name, timeZone: 'America/New_York' });
    await needsCredential('PATCH', path, { name: 'no credential' });
  }, T);

  it.skipIf(W042 !== '')(named('E2E-PARC-042 — 2.11 the owner deletes the organization from a browser: nothing of it reads any more, another org is untouched, a replay changes nothing', W042), async () => {
    const a = await owner('parc-042');
    const member = email('parc-042-member');
    expect((await invite(a.person, a.org.id, [member])).status).toBeLessThan(300);
    const m = await join(member);
    expect(m.accepted.status, JSON.stringify(m.accepted.body)).toBeLessThan(300);
    const path = `/api/v1/orgs/${a.org.id}`;
    const secret = `PARC042_${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await call(a.c, 'POST', '/api/v1/secrets', { name: secret, value: `v-${randomUUID()}` })).status).toBeLessThan(300);
    // Another organization, with data of its own: the deletion never reaches it.
    const b = await owner('parc-042-b');
    const kept = `PARC042B_${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await call(b.c, 'POST', '/api/v1/secrets', { name: kept, value: `v-${randomUUID()}` })).status).toBeLessThan(300);

    // The contract: a browser session only, never a token, even the owner's with `orgs:write`.
    const made = await call(a.c, 'POST', '/api/v1/tokens', { name: 'parc-042', scopes: ['orgs:write'], expiresInDays: 1 });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const byToken = await call({ token: made.body['secret'] as string }, 'DELETE', path, { confirm: a.org.slug });
    expect(byToken.status, JSON.stringify(byToken.body)).toBe(403);
    // The owner only; another org's owner gets 404; the short name must be typed again.
    expect((await call(m.person.caller, 'DELETE', path, { confirm: a.org.slug })).status).toBe(403);
    expect((await call(b.person.caller, 'DELETE', path, { confirm: a.org.slug })).status).toBe(404);
    expect((await call(a.person.caller, 'DELETE', `/api/v1/orgs/${b.org.id}`, { confirm: b.org.slug })).status).toBe(404);
    const wrong = await call(a.person.caller, 'DELETE', path, { confirm: `${a.org.slug}-typo` });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(400);
    expect((await call(a.person.caller, 'GET', path)).status, 'still there after the refusals').toBe(200);
    await needsCredential('DELETE', path, { confirm: a.org.slug });

    // Signed in a moment ago (under the 5 minutes the deletion asks): deleted.
    const deleted = await call(a.person.caller, 'DELETE', path, { confirm: a.org.slug });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);

    // Nothing of it reads any more, for its owner as for its member: the organization, its members, its data.
    for (const who of [a.person.caller, m.person.caller]) {
      for (const ref of [a.org.id, a.org.slug]) expect((await call(who, 'GET', `/api/v1/orgs/${ref}`)).status).toBe(404);
      expect((await call(who, 'GET', `${path}/members`)).status).toBe(404);
      expect(JSON.stringify((await call(who, 'GET', '/api/v1/me/organizations')).body)).not.toContain(a.org.id);
      expect(JSON.stringify((await call(who, 'GET', '/api/v1/orgs')).body)).not.toContain(a.org.id);
      const data = await call({ ...who, org: a.org.id }, 'GET', '/api/v1/secrets');
      expect(data.status, `secrets of a deleted org → ${data.status}`).toBeGreaterThanOrEqual(400);
      expect(data.status).toBeLessThan(500);
      expect(JSON.stringify(data.body)).not.toContain(secret);
    }
    expect((await call(a.person.caller, 'PATCH', path, { name: 'after the deletion' })).status).toBe(404);

    // Replayed: no effect, and the other organization stays whole.
    expect((await call(a.person.caller, 'DELETE', path, { confirm: a.org.slug })).status).toBe(404);
    expect((await call(b.person.caller, 'GET', `/api/v1/orgs/${b.org.id}`)).body).toMatchObject({ id: b.org.id, role: 'owner' });
    expect(itemsOf((await call(b.c, 'GET', '/api/v1/secrets')).body).map((x) => x['name'])).toContain(kept);
  }, T);
});

// --------------------------------------------------------------------------------------------------------- 3. Rules

const W012 = await needs(['GET', '/api/v1/rules'], ['PATCH', '/api/v1/rules/{id}'], ['POST', '/api/v1/rules/bulk'], ['GET', '/api/v1/analysis/state'], ['POST', '/api/v1/analysis/start']);
// 3.2 end to end: a rule's gate (ostrom-server#79) is in the catalogue the hook reads and asks a yes for the push it
// names; the yes needs a fresh sign-in (step-up) and the token of `gates:ask` (tokens and scopes of #88).
const W013 = (await needs(['GET', '/api/v1/gates/catalog'], ['GET', '/api/v1/gates/catalog/signed'], ['POST', '/api/v1/rules'], ['PATCH', '/api/v1/rules/{id}'], ['POST', '/api/v1/gates'], ['GET', '/api/v1/approvals'], ['POST', '/api/v1/tokens'])) || ACTORS;
const W014 = (await needs(['GET', '/api/v1/gates/approvers'])) || ACTORS;
const W015 = await needs(['GET', '/api/v1/gates/policy'], ['PUT', '/api/v1/gates/policy']);
const W016 = (await needs(['GET', '/api/v1/policy/models'], ['PUT', '/api/v1/policy/models'], ['GET', '/api/v1/inference/settings'], ['PUT', '/api/v1/inference/settings'])) || ORG64;
const W017 = await needs(['GET', '/api/v1/policy/agents']);
const W018 = (await needs(['GET', '/api/v1/budgets'], ['PUT', '/api/v1/budgets'], ['GET', '/api/v1/budgets/me'])) || ORG64;
const W019 = await needs(['GET', '/api/v1/spending']);
const W020 = await needs(['GET', '/api/v1/decisions']);

describe('E2E-PARC: 3. rules, gates, approvers, budgets', () => {
  it.skipIf(W012 !== '')(named('E2E-PARC-012 — 3.1 rules: a new org has no rule, the analysis state reads, a rule is edited and bulk-accepted', W012), async () => {
    const a = await owner('parc-012');
    const rules = await call(a.c, 'GET', '/api/v1/rules');
    expect(rules.status).toBe(200);
    expect(itemsOf(rules.body)).toEqual([]);
    const state = await call(a.c, 'GET', '/api/v1/analysis/state');
    expect(state.status).toBe(200);
    for (const k of ['repos', 'rules', 'workflows']) expect(Array.isArray(state.body?.[k]), k).toBe(true);
    // No repository connected: starting the analysis is refused, never a run of nothing.
    const start = await call(a.c, 'POST', '/api/v1/analysis/start');
    expect([202, 400, 409, 422]).toContain(start.status);
    const made = await call(a.c, 'POST', '/api/v1/rules', { statement: 'Never push to main without a review', group: 'git' });
    if (made.status === 201) {
      const id = made.body['id'] as string;
      expect(made.body).toMatchObject({ statement: 'Never push to main without a review', group: 'git' });
      const edited = await call(a.c, 'PATCH', `/api/v1/rules/${id}`, { statement: 'Never push to main without two reviews' });
      expect(edited.body).toMatchObject({ id, statement: 'Never push to main without two reviews' });
      const bulk = await call(a.c, 'POST', '/api/v1/rules/bulk', { ids: [id], status: 'accepted' });
      expect(bulk.body).toEqual({ updated: 1 });
      expect((await call(a.c, 'GET', `/api/v1/rules/${id}`)).body?.['status']).toBe('accepted');
      const b = await owner('parc-012-b');
      await hidden(b.c, '/api/v1/rules', id);
      expect((await call(b.c, 'POST', '/api/v1/rules/bulk', { ids: [id], status: 'rejected' })).body?.['updated'] ?? 0).toBe(0);
    }
    expect((await call(a.c, 'PATCH', `/api/v1/rules/${ID}`, { status: 'accepted' })).status).toBe(404);
    await needsCredential('GET', '/api/v1/rules');
  }, T);

  it.skipIf(W013 !== '')(named('E2E-PARC-013 — 3.2 a rule poses a gate: in the signed catalogue, a push to main waits for a yes', W013), async () => {
    const a = await owner('parc-013');
    const reviewerEmail = email('parc-013-rev');
    expect((await invite(a.person, a.org.id, [reviewerEmail], 'admin')).status).toBe(200);
    const { person: reviewer, accepted } = await join(reviewerEmail);
    expect(accepted.status).toBe(200);
    const login = (await profileOf(reviewer.caller)).login;
    const repo = `acme/parc-${randomUUID().slice(0, 8)}`;
    const q = `?repo=${encodeURIComponent(repo)}`;
    // The catalogue is a repository's (`GateCatalogApi(repo)`): without `?repo=` the server answers 400.
    const before = await call(a.c, 'GET', `/api/v1/gates/catalog${q}`);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(typeof before.body).toBe('object');
    expect(JSON.stringify(before.body)).not.toContain('rule:');

    // The owner writes the rule and its gate in /rules: accepted at once, its gate goes to the catalogue.
    const made = await call(a.c, 'POST', '/api/v1/rules', {
      statement: 'A push to main waits for a review', group: 'git', scope: [repo],
      gate: { actions: [{ class: 'push-main', label: 'Push to main', patterns: [], repos: [repo] }], approvers: [login] },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ status: 'accepted', output: 'gate' });
    const workflowId = `rule:${String(made.body['id'])}`;
    const catalog = await call(a.c, 'GET', `/api/v1/gates/catalog${q}`);
    expect(catalog.status, JSON.stringify(catalog.body)).toBe(200);
    expect(JSON.stringify(catalog.body)).toContain(workflowId);
    const signed = await call(a.c, 'GET', `/api/v1/gates/catalog/signed${q}`);
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(JSON.stringify(signed.body)).toMatch(/sig|signature|kid/i);
    expect(JSON.stringify(signed.body), 'the hook reads the rule\'s gate').toContain(workflowId);

    // A push to main of that repository is held by the rule's gate until the reviewer says yes.
    const token = await call(a.c, 'POST', '/api/v1/tokens', { name: 'parc-013 asker', scopes: ['gates:ask', 'gates:read'], expiresInDays: 1 });
    expect(token.status, JSON.stringify(token.body)).toBeLessThan(300);
    const asker: Caller = { token: String(token.body['secret']), org: a.org.id };
    const push = (sha: string) =>
      call(asker, 'POST', '/api/v1/gates', { repo, class: 'git.push', tool: 'Bash', command: 'git push origin main', push: { remote: 'origin', refs: [{ ref: 'refs/heads/main', sha }] } });
    const sha = randomUUID().replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const asked = await push(sha);
    expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
    const gate = asked.body['gate'] as Record<string, unknown>;
    expect(gate['status'], JSON.stringify(asked.body)).toBe('pending');
    expect(gate['gate'], JSON.stringify(asked.body)).toMatchObject({ workflowId, enforce: true });
    expect((gate['gate'] as Record<string, unknown>)['approvers']).toContain(login);
    const pending = await call(reviewer.caller, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50');
    const mine = itemsOf(pending.body).find((x) => x['group'] === gate['id']);
    expect(mine, JSON.stringify({ gate: asked.body, pending: pending.body })).toBeDefined();
    // The reviewer has just signed in: the yes passes the step-up and answers with the signed receipt of the commit.
    const yes = await call(reviewer.caller, 'POST', `/api/v1/approvals/${String(mine?.['id'])}/answer`, { answer: 'approve', shownDigest: mine?.['shownDigest'] });
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    const receipt = yes.body['receipt'] as { signature?: unknown; subject?: { id?: unknown } } | undefined;
    expect(typeof receipt?.signature, JSON.stringify(yes.body)).toBe('string');
    expect(receipt?.subject?.id).toBe(sha);

    // Rejected, the rule no longer gates: the next push of the repository asks nobody.
    const rejected = await call(a.c, 'PATCH', `/api/v1/rules/${String(made.body['id'])}`, { status: 'rejected' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(JSON.stringify((await call(a.c, 'GET', `/api/v1/gates/catalog${q}`)).body)).not.toContain(workflowId);
    const after = await push(randomUUID().replaceAll('-', '').padEnd(40, '1').slice(0, 40));
    expect(after.status, JSON.stringify(after.body)).toBeLessThan(300);
    expect((after.body['gate'] as Record<string, unknown>)['status'], JSON.stringify(after.body)).not.toBe('pending');

    // Another organization never sees the rule's gate, even on the same repository name.
    const b = await owner('parc-013-b');
    await hidden(b.c, `/api/v1/gates/catalog${q}`, workflowId);
    await needsCredential('GET', `/api/v1/gates/catalog${q}`);
  }, T);

  it.skipIf(W014 !== '')(named('E2E-PARC-014 — 3.3 the approvers graph: approvers, unanswered gates, ungated repositories', W014), async () => {
    const a = await owner('parc-014');
    const r = await call(a.c, 'GET', '/api/v1/gates/approvers');
    expect(r.status).toBe(200);
    for (const k of ['approvers', 'unanswered', 'ungated']) expect(Array.isArray(r.body?.[k]), k).toBe(true);
    await needsCredential('GET', '/api/v1/gates/approvers');
  }, T);

  it.skipIf(W015 !== '')(named('E2E-PARC-015 — 3.3 the self-approval policy is read and set by an admin, refused to a member', W015), async () => {
    const a = await owner('parc-015');
    const before = await call(a.c, 'GET', '/api/v1/gates/policy');
    expect(before.status).toBe(200);
    // Since ostrom-server#159 (contract core#66) the policy is `sole-approver` or `never`, and an organization that never
    // chose is `never`: its own actions are never approved by their author.
    expect(before.body).toEqual({ selfApproval: 'never' });
    const other = 'sole-approver';
    const set = await call(a.c, 'PUT', '/api/v1/gates/policy', { selfApproval: other });
    expect(set.body).toEqual({ selfApproval: other });
    expect((await call(a.c, 'GET', '/api/v1/gates/policy')).body).toEqual({ selfApproval: other });
    const m = email('parc-015-m');
    expect((await invite(a.person, a.org.id, [m])).status).toBeLessThan(300);
    const { person } = await join(m);
    const refused = await call({ ...person.caller, org: a.org.id }, 'PUT', '/api/v1/gates/policy', { selfApproval: before.body['selfApproval'] });
    expect(refused.status).toBe(403);
    // An unknown value, and `allowed`, the value before #159, are refused.
    for (const value of ['whenever', 'allowed']) expect((await call(a.c, 'PUT', '/api/v1/gates/policy', { selfApproval: value })).status, value).toBe(400);
  }, T);

  it.skipIf(W016 !== '')(named('E2E-PARC-016 — 3.4 the model policy and the inference settings are set and read back', W016), async () => {
    const a = await owner('parc-016');
    const policy = { allowed: ['claude-sonnet-4-5', 'claude-opus-4-1'], default: 'claude-sonnet-4-5', byMember: {} };
    const put = await call(a.c, 'PUT', '/api/v1/policy/models', policy);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await call(a.c, 'GET', '/api/v1/policy/models')).body).toMatchObject({ allowed: policy.allowed, default: policy.default });
    const settings = await call(a.c, 'PUT', '/api/v1/inference/settings', { useSharedAccounts: false });
    expect(settings.body).toMatchObject({ useSharedAccounts: false });
    expect((await call(a.c, 'GET', '/api/v1/inference/settings')).body).toMatchObject({ useSharedAccounts: false });
    // Another organization keeps its own defaults.
    const b = await owner('parc-016-b');
    expect((await call(b.c, 'GET', '/api/v1/inference/settings')).body).toMatchObject({ useSharedAccounts: true });
    expect(JSON.stringify((await call(b.c, 'GET', '/api/v1/policy/models')).body)).not.toContain('claude-opus-4-1');
    await needsCredential('PUT', '/api/v1/policy/models', policy);
  }, T);

  it.skipIf(W017 !== '')(named('E2E-PARC-017 — 3.4 the agent policy `ostrom claude` reads: allowed or not, with its reason', W017), async () => {
    const a = await owner('parc-017');
    const r = await call(a.c, 'GET', '/api/v1/policy/agents?agent=claude');
    expect(r.status).toBe(200);
    expect(typeof r.body?.['allowed']).toBe('boolean');
    if (r.body['allowed'] === false) expect(typeof r.body['reason']).toBe('string');
    await needsCredential('GET', '/api/v1/policy/agents');
  }, T);

  it.skipIf(W018 !== '')(named('E2E-PARC-018 — 3.5 an org budget is set, listed with the period, and read as the member own budget', W018), async () => {
    const a = await owner('parc-018');
    const set = await call(a.c, 'PUT', '/api/v1/budgets', { scope: 'org', usdPerMonth: 42, hardStop: true });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ scope: 'organization', usdPerMonth: 42, hardStop: true });
    const page = await call(a.c, 'GET', '/api/v1/budgets');
    expect(itemsOf(page.body)).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'organization', usdPerMonth: 42 })]));
    for (const k of ['orgSpentUsd', 'periodStart', 'resetsAt']) expect(page.body).toHaveProperty(k);
    const me = await call(a.c, 'GET', '/api/v1/budgets/me');
    expect(me.body).toMatchObject({ spentMicros: 0, exhausted: false });
    if (me.body['limitMicros'] != null) expect(me.body['limitMicros'] as number).toBeLessThanOrEqual(42_000_000);
    const b = await owner('parc-018-b');
    expect(JSON.stringify((await call(b.c, 'GET', '/api/v1/budgets')).body)).not.toMatch(/"usdPerMonth":42\b/);
    // Refused shapes: a daily budget, a soft budget, an unknown scope.
    for (const bad of [{ scope: 'org', usdPerDay: 5 }, { scope: 'org', usdPerMonth: 5, hardStop: false }, { scope: 'team', usdPerMonth: 5 }]) expect((await call(a.c, 'PUT', '/api/v1/budgets', bad)).status).toBe(400);
  }, T);

  it.skipIf(W019 !== '')(named('E2E-PARC-019 — 3.5 / 6.4 spending of the week and the month, by agent, repo, person and day, against the budget', W019), async () => {
    const a = await owner('parc-019');
    for (const period of ['week', 'month']) {
      const r = await call(a.c, 'GET', `/api/v1/spending?period=${period}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ period, totalUsd: 0 });
      for (const k of ['byAgent', 'byRepo', 'byPerson', 'daily']) expect(Array.isArray(r.body[k]), k).toBe(true);
      expect(Date.parse(r.body['from'] as string)).toBeLessThan(Date.parse(r.body['to'] as string));
    }
    expect((await call(a.c, 'GET', '/api/v1/spending?period=decade')).status).toBe(400);
    await needsCredential('GET', '/api/v1/spending');
  }, T);

  it.skipIf(W020 !== '')(named('E2E-PARC-020 — 3.6 the decision journal of a new org is empty and pages', W020), async () => {
    const a = await owner('parc-020');
    const r = await call(a.c, 'GET', '/api/v1/decisions');
    expect(r.status).toBe(200);
    expect(itemsOf(r.body)).toEqual([]);
    await needsCredential('GET', '/api/v1/decisions');
  }, T);
});

// --------------------------------------------------------------------------------------- 4. Workflows and automations

const W021 = (await needs(['GET', '/api/v1/workflows'], ['POST', '/api/v1/workflows'], ['PUT', '/api/v1/workflows/{id}'], ['DELETE', '/api/v1/workflows/{id}'], ['GET', '/api/v1/packages/current'])) || ACTORS;
const W022 = await needs(['GET', '/api/v1/workflows/{id}/runs'], ['POST', '/api/v1/workflows/{id}/runs'], ['GET', '/api/v1/runs']);
const W023 = (await needs(['POST', '/api/v1/automations'], ['POST', '/api/v1/automations/{id}/enable'], ['PUT', '/api/v1/automations/{id}'], ['POST', '/api/v1/automations/{id}/run'], ['POST', '/api/v1/automations/{id}/webhook/rotate-secret'], ['DELETE', '/api/v1/automations/{id}'])) || ORG64;
const W024 = (await needs(['POST', '/api/v1/waits'], ['GET', '/api/v1/waits/{id}'], ['POST', '/api/v1/waits/{id}/answer'], ['POST', '/api/v1/waits/{id}/cancel'])) || ORG64;

/** A workflow of the contract (`Workflow`): one trigger node, no edge. */
const workflow = (id: string, name: string) => ({ id, name, domain: 'git', nodes: [{ id: 'start', kind: 'trigger', label: 'Session start' }], edges: [], start: 'start', status: 'proposed', foundAt: new Date().toISOString() });

describe('E2E-PARC: 4. workflows and automations', () => {
  it.skipIf(W021 !== '')(named('E2E-PARC-021 — 4.1 a workflow is created, edited with its version, listed, deleted; the current package reads', W021), async () => {
    const a = await owner('parc-021');
    const wid = `parc-${randomUUID().slice(0, 8)}`;
    // POST takes the workflow itself; PUT takes `{workflow, expectedVersion}` (`SaveWorkflowRequest`, CompilerApi.kt).
    const made = await call(a.c, 'POST', '/api/v1/workflows', workflow(wid, 'Parc 021'));
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect(JSON.stringify(made.body)).toContain(wid);
    const version = (made.body['version'] ?? (made.body['workflow'] as Record<string, unknown> | undefined)?.['version']) as number;
    const edited = await call(a.c, 'PUT', `/api/v1/workflows/${wid}`, { workflow: { ...workflow(wid, 'Parc 021 bis') }, expectedVersion: version });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(JSON.stringify(edited.body)).toContain('Parc 021 bis');
    const stale = await call(a.c, 'PUT', `/api/v1/workflows/${wid}`, { workflow: workflow(wid, 'stale'), expectedVersion: version });
    expect(stale.status).toBe(409);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/workflows')).body)).toContain('Parc 021 bis');
    const b = await owner('parc-021-b');
    await hidden(b.c, '/api/v1/workflows', wid);
    // Deleted before the package is read: reading `packages/current` pins a package, and a workflow a pinned package
    // compiles is kept (409 `workflow_in_use`, WorkflowsUseCases.kt; run 41477443350).
    const deleted = await call(a.c, 'DELETE', `/api/v1/workflows/${wid}`);
    expect(deleted.status, JSON.stringify(deleted.body)).toBeLessThan(300);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/workflows')).body)).not.toContain(wid);
    expect([200, 404]).toContain((await call(a.c, 'GET', '/api/v1/packages/current')).status);
    await needsCredential('GET', '/api/v1/workflows');
  }, T);

  it.skipIf(W022 !== '')(named('E2E-PARC-022 — 4.1 a workflow run is started, listed under its workflow and among the runs', W022), async () => {
    const a = await owner('parc-022');
    const wid = `parc-${randomUUID().slice(0, 8)}`;
    expect((await call(a.c, 'POST', '/api/v1/workflows', { workflow: workflow(wid, 'Parc 022') })).status).toBeLessThan(300);
    const run = await call(a.c, 'POST', `/api/v1/workflows/${wid}/runs`, { inputs: {} });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body).toMatchObject({ workflowId: wid, workflowName: 'Parc 022' });
    for (const k of ['id', 'status', 'startedBy', 'source', 'startedAt']) expect(run.body).toHaveProperty(k);
    expect(itemsOf((await call(a.c, 'GET', `/api/v1/workflows/${wid}/runs`)).body).map((r) => r['id'])).toContain(run.body['id']);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/runs')).body)).toContain(run.body['id'] as string);
    const b = await owner('parc-022-b');
    await hidden(b.c, '/api/v1/runs', run.body['id'] as string);
  }, T);

  it.skipIf(W023 !== '')(named('E2E-PARC-023 — 4.2 an automation is created, edited, disabled, dry-run, its webhook secret rotated, deleted', W023), async () => {
    const a = await owner('parc-023');
    const cron = await call(a.c, 'POST', '/api/v1/automations', { name: 'Parc 023 nightly', trigger: { kind: 'cron', cron: '0 3 * * *', timezone: 'UTC' }, action: { prompt: 'Summarise the open pull requests' } });
    expect(cron.status, JSON.stringify(cron.body)).toBeLessThan(300);
    expect(cron.body).toMatchObject({ name: 'Parc 023 nightly', enabled: false, trigger: { kind: 'cron', cron: '0 3 * * *' }, version: 1 });
    const id = cron.body['id'] as string;
    const edited = await call(a.c, 'PUT', `/api/v1/automations/${id}`, { name: 'Parc 023 weekly', trigger: { kind: 'cron', cron: '0 3 * * 1', timezone: 'UTC' }, action: { prompt: 'Summarise' }, version: 1 });
    expect(edited.body).toMatchObject({ id, name: 'Parc 023 weekly', version: 2 });
    const on = await call(a.c, 'POST', `/api/v1/automations/${id}/enable`);
    expect(on.body).toMatchObject({ id, enabled: true });
    expect(typeof on.body['nextRunAt']).toBe('string');
    expect((await call(a.c, 'POST', `/api/v1/automations/${id}/disable`)).body?.['enabled']).toBe(false);
    const dry = await call(a.c, 'POST', `/api/v1/automations/${id}/run`, { dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBeLessThan(300);
    // The server's dry run (`DryRunResponse`): the prompt as it would run, its variables and next runs.
    expect(String(dry.body['renderedPrompt'])).toContain('Summarise');
    expect(Array.isArray(dry.body['nextRuns'])).toBe(true);
    expect(itemsOf((await call(a.c, 'GET', `/api/v1/automations/${id}/runs`)).body).length).toBeGreaterThanOrEqual(0);
    const hook = await call(a.c, 'POST', '/api/v1/automations', { name: 'Parc 023 hook', trigger: { kind: 'webhook' }, action: { prompt: 'Triage' } });
    expect(typeof hook.body?.['webhookUrl']).toBe('string');
    const first = hook.body['secret'] as string | undefined;
    const rot = await call(a.c, 'POST', `/api/v1/automations/${hook.body['id'] as string}/webhook/rotate-secret`);
    expect(typeof rot.body?.['secret']).toBe('string');
    expect(rot.body['secret']).not.toBe(first);
    expect(typeof rot.body['previousSecretValidUntil']).toBe('string');
    const b = await owner('parc-023-b');
    await hidden(b.c, '/api/v1/automations', id);
    expect((await call(a.c, 'DELETE', `/api/v1/automations/${id}`)).status).toBeLessThan(300);
    expect((await call(a.c, 'GET', `/api/v1/automations/${id}`)).status).toBe(404);
  }, T);

  it.skipIf(W024 !== '')(named('E2E-PARC-024 — 4.3 a wait is asked, read, answered once; another is cancelled', W024), async () => {
    const a = await owner('parc-024');
    const question = { title: 'Ship it?', fields: [{ id: 'note', type: 'text', label: 'Note' }], actions: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] };
    const made = await call(a.c, 'POST', '/api/v1/waits', { question });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect(made.body).toMatchObject({ status: 'open', question: { title: 'Ship it?' } });
    const id = made.body['id'] as string;
    expect((await call(a.c, 'GET', `/api/v1/waits/${id}`)).body?.['id']).toBe(id);
    const answered = await call(a.c, 'POST', `/api/v1/waits/${id}/answer`, { action: 'yes', values: { note: 'go' } });
    expect(answered.status, JSON.stringify(answered.body)).toBeLessThan(300);
    const back = await call(a.c, 'GET', `/api/v1/waits/${id}`);
    expect(back.body).toMatchObject({ answer: { action: 'yes', values: { note: 'go' } } });
    expect(back.body['status']).toBe('resolved');
    const twice = await call(a.c, 'POST', `/api/v1/waits/${id}/answer`, { action: 'no' });
    expect(twice.status).toBeGreaterThanOrEqual(400);
    expect(twice.status).toBeLessThan(500);
    const maybe = await call(a.c, 'POST', '/api/v1/waits', { question });
    expect((await call(a.c, 'POST', `/api/v1/waits/${maybe.body['id'] as string}/answer`, { action: 'maybe' })).status).toBe(400); // an action the wait does not offer
    const other = await call(a.c, 'POST', '/api/v1/waits', { question });
    expect((await call(a.c, 'POST', `/api/v1/waits/${other.body['id'] as string}/cancel`)).status).toBeLessThan(300);
    expect((await call(a.c, 'GET', `/api/v1/waits/${other.body['id'] as string}`)).body?.['status']).toBe('cancelled');
    const b = await owner('parc-024-b');
    await hidden(b.c, `/api/v1/waits/${id}`, 'Ship it?');
  }, T);
});

// ------------------------------------------------------------------------------------- 5. The CLI, gates, receipts

const W025 = await needs(['POST', '/api/v1/launches'], ['GET', '/api/v1/sessions'], ['POST', '/api/v1/sessions/{id}/alive'], ['POST', '/api/v1/sessions/{id}/end'], ['POST', '/api/v1/sessions/{id}/reopen'], ['POST', '/api/v1/sessions/{id}/seen']);
const W026 = await needs(['POST', '/api/v1/sessions/{id}/workflow-receipt'], ['POST', '/api/v1/launches'], ['GET', '/api/v1/sessions']);
const W027 = await needs(['GET', '/api/v1/checks'], ['POST', '/api/v1/checks'], ['GET', '/api/v1/notifications'], ['POST', '/api/v1/notifications']);
const W028 = await needs(['POST', '/api/v1/gates/{id}/reserve'], ['POST', '/api/v1/gates/{id}/consume'], ['POST', '/api/v1/gates/{id}/release']);
const W029 = (await needs(['GET', '/api/v1/receipts'], ['GET', '/api/v1/receipts/{id}'], ['GET', '/api/v1/receipts/{id}/verify'], ['GET', '/api/v1/receipts/keys'])) || ORG64;
const W030 = await needs(['GET', '/api/v1/receipts/{id}/bundle']);

describe('E2E-PARC: 5. the CLI, gates, receipts (server side)', () => {
  it.skipIf(W025 !== '')(named('E2E-PARC-025 — 5.2 a launch hands an agent token; its session is kept alive, records what it saw, ends and reopens', W025), async () => {
    const a = await owner('parc-025');
    const launch = await call(a.c, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/parc' });
    expect(launch.status, JSON.stringify(launch.body)).toBe(201);
    for (const k of ['launchId', 'agentToken', 'expiresAt']) expect(typeof launch.body[k], k).toBe('string');
    const agent: Caller = { token: launch.body['agentToken'] as string, org: a.org.id, ...(a.c.from ? { from: a.c.from } : {}) };
    // A launch opens no session by itself: the agent's first hook does (`POST /api/v1/sessions`, StartSessionRequest).
    const sid = randomUUID();
    const opened = await call(agent, 'POST', '/api/v1/sessions', { id: sid, launchId: launch.body['launchId'], repo: 'acme/parc', agent: 'claude' });
    expect(opened.status, JSON.stringify(opened.body)).toBeLessThan(300);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/sessions')).body)).toContain(sid);
    expect((await call(agent, 'POST', `/api/v1/sessions/${sid}/alive`)).status).toBeLessThan(300);
    expect((await call(agent, 'POST', `/api/v1/sessions/${sid}/seen`, { kind: 'skill', name: 'ostrom', via: 'hook' })).status).toBeLessThan(300);
    const end = await call(agent, 'POST', `/api/v1/sessions/${sid}/end`, {});
    expect(end.body?.['session']).toMatchObject({ id: sid });
    expect(end.body['receipt']).toBeTruthy();
    const reopen = await call(agent, 'POST', `/api/v1/sessions/${sid}/reopen`, {});
    expect(reopen.body).toMatchObject({ reopened: true });
    const b = await owner('parc-025-b');
    await hidden(b.c, '/api/v1/sessions', sid);
    await needsCredential('POST', '/api/v1/launches', { agent: 'claude' });
  }, T);

  it.skipIf(W026 !== '')(named('E2E-PARC-026 — 5.2 a session asks for its workflow receipt: signed, verified, bound to the package digest', W026), async () => {
    const a = await owner('parc-026');
    const launch = await call(a.c, 'POST', '/api/v1/launches', { agent: 'claude' });
    const agent: Caller = { token: launch.body['agentToken'] as string, org: a.org.id, ...(a.c.from ? { from: a.c.from } : {}) };
    const sid = (itemsOf((await call(a.c, 'GET', '/api/v1/sessions')).body)[0] ?? {})['id'] as string;
    const digest = `sha256:${'0'.repeat(64)}`;
    const r = await call(agent, 'POST', `/api/v1/sessions/${sid}/workflow-receipt`, { digest, agent: 'claude' });
    if (r.status === 200) {
      expect(r.body['receipt']).toBeTruthy();
      expect(r.body['verification']).toBeTruthy();
      expect(JSON.stringify(r.body['receipt'])).toContain(digest);
    } else {
      // No package of that digest: refused, never a receipt for nothing.
      expect([400, 404, 409, 422]).toContain(r.status);
    }
    await needsCredential('POST', `/api/v1/sessions/${sid}/workflow-receipt`, { digest });
  }, T);

  it.skipIf(W027 !== '')(named('E2E-PARC-027 — 5.3 workflow checks and notifications reported by a session are listed for the org only', W027), async () => {
    const a = await owner('parc-027');
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/checks')).body)).toEqual([]);
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/notifications')).body)).toEqual([]);
    // Without a signed package of that digest, a report is refused rather than recorded against nothing.
    const check = await call(a.c, 'POST', '/api/v1/checks', { digest: `sha256:${'1'.repeat(64)}`, nodeId: 'n1', scriptId: 's1', exit: 0, outcome: 'passed' });
    expect(check.status).toBeLessThan(500);
    if (check.status === 201) {
      expect(check.body).toMatchObject({ nodeId: 'n1', scriptId: 's1' });
      const b = await owner('parc-027-b');
      await hidden(b.c, '/api/v1/checks', check.body['id'] as string);
    }
    const note = await call(a.c, 'POST', '/api/v1/notifications', { digest: `sha256:${'1'.repeat(64)}`, nodeId: 'n2', notifyId: 'x' });
    expect(note.status).toBeLessThan(500);
    await needsCredential('GET', '/api/v1/checks');
    await needsCredential('GET', '/api/v1/notifications');
  }, T);

  it.skipIf(W028 !== '')(named('E2E-PARC-028 — 5.5 reserve, consume and release refuse an unknown gate and a caller without credential', W028), async () => {
    const a = await owner('parc-028');
    for (const verb of ['reserve', 'consume', 'release']) {
      const r = await call(a.c, 'POST', `/api/v1/gates/${randomUUID()}/${verb}`, {});
      expect([400, 403, 404], `${verb} → ${r.status}`).toContain(r.status);
      expect(r.body?.['error']).toBeTruthy();
      await needsCredential('POST', `/api/v1/gates/${randomUUID()}/${verb}`, {});
    }
  }, T);

  it.skipIf(W029 !== '')(named('E2E-PARC-029 — 5.7 receipts of a new org: an empty list, the public keys, an unknown receipt neither read nor verified', W029), async () => {
    const a = await owner('parc-029');
    const list = await call(a.c, 'GET', '/api/v1/receipts');
    expect(list.status).toBe(200);
    expect(itemsOf(list.body)).toEqual([]);
    const keys = await call(a.c, 'GET', '/api/v1/receipts/keys');
    const k = itemsOf(keys.body, 'keys');
    expect(k.length).toBeGreaterThanOrEqual(1);
    for (const key of k) expect(typeof key['kid']).toBe('string');
    expect((await call(a.c, 'GET', `/api/v1/receipts/${randomUUID()}`)).status).toBe(404);
    expect((await call(a.c, 'GET', `/api/v1/receipts/${randomUUID()}/verify`)).status).toBe(404);
    await needsCredential('GET', '/api/v1/receipts');
  }, T);

  it.skipIf(W030 !== '')(named('E2E-PARC-030 — 5.7 the receipt bundle downloads for its org only, and 404 for an unknown receipt', W030), async () => {
    const a = await owner('parc-030');
    expect((await call(a.c, 'GET', `/api/v1/receipts/${randomUUID()}/bundle`)).status).toBe(404);
    const first = itemsOf((await call(a.c, 'GET', '/api/v1/receipts')).body)[0];
    if (first) {
      const id = first['id'] as string;
      const bundle = await call(a.c, 'GET', `/api/v1/receipts/${id}/bundle`);
      expect(bundle.status).toBe(200);
      for (const key of ['format', 'receipt', 'chain', 'package', 'keys', 'exportedAt']) expect(bundle.body).toHaveProperty(key);
      const b = await owner('parc-030-b');
      await hidden(b.c, `/api/v1/receipts/${id}/bundle`, id);
    }
    await needsCredential('GET', `/api/v1/receipts/${randomUUID()}/bundle`);
  }, T);
});

// ------------------------------------------------------------------------- 6. Sessions, cloud, activity, usage, app

const W031 = (await needs(['GET', '/api/v1/sessions'], ['GET', '/api/v1/sessions/{id}'])) || ACTORS;
const W032 = await needs(['GET', '/api/v1/cloud/sessions'], ['GET', '/api/v1/runners']);
const W033 = await needs(['GET', '/api/v1/activity']);
const W034 = (await needs(['GET', '/api/v1/usage'], ['GET', '/api/v1/usage/summary'], ['GET', '/api/v1/usage/events'])) || ORG64;
const W035 = (await needs(['POST', '/api/v1/import/teamcode'])) || ORG64;
const W036 = (await needs(['POST', '/api/v1/auth/mobile/token'], ['GET', '/api/v1/approvals/queue'], ['GET', '/api/v1/approvals/{id}/view'], ['GET', '/api/v1/me/notifications'], ['PUT', '/api/v1/me/notifications'])) || ACTORS;
const W037 = await needs(['POST', '/api/v1/push-devices'], ['DELETE', '/api/v1/push-devices/{id}']);

describe('E2E-PARC: 6. sessions, cloud, activity, usage, import, mobile', () => {
  it.skipIf(W031 !== '')(named('E2E-PARC-031 — 6.1 the sessions of a new org: an empty list, an unknown session 404, nothing for another org', W031), async () => {
    const a = await owner('parc-031');
    const list = await call(a.c, 'GET', '/api/v1/sessions');
    expect(list.status).toBe(200);
    expect(itemsOf(list.body)).toEqual([]);
    expect((await call(a.c, 'GET', `/api/v1/sessions/${randomUUID()}`)).status).toBe(404);
    await needsCredential('GET', '/api/v1/sessions');
  }, T);

  it.skipIf(W032 !== '')(named('E2E-PARC-032 — 6.2 cloud sessions and runners of the caller: listed, shaped, empty for a new org', W032), async () => {
    const a = await owner('parc-032');
    const cloud = await call(a.c, 'GET', '/api/v1/cloud/sessions');
    expect(cloud.status).toBe(200);
    expect(itemsOf(cloud.body)).toEqual([]);
    const runners = await call(a.c, 'GET', '/api/v1/runners');
    expect(runners.status).toBe(200);
    for (const r of itemsOf(runners.body)) {
      for (const k of ['id', 'name', 'status']) expect(typeof r[k], k).toBe('string');
      expect(Array.isArray(r['labels'])).toBe(true);
    }
    expect((await call(a.c, 'GET', `/api/v1/cloud/sessions/${randomUUID()}`)).status).toBe(404);
    await needsCredential('GET', '/api/v1/runners');
  }, T);

  it.skipIf(W033 !== '')(named('E2E-PARC-033 — 6.3 the activity feed lists what the org did, newest first, with a cursor and a repo filter', W033), async () => {
    const a = await owner('parc-033');
    const r = await call(a.c, 'GET', '/api/v1/activity');
    expect(r.status).toBe(200);
    const items = itemsOf(r.body);
    for (const i of items) {
      for (const k of ['id', 'at', 'kind', 'summary']) expect(typeof i[k], k).toBe('string');
      expect(i['actor']).toMatchObject({ kind: expect.any(String), name: expect.any(String) });
    }
    const ats = items.map((i) => Date.parse(i['at'] as string));
    expect([...ats].sort((x, y) => y - x)).toEqual(ats);
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/activity?repo=acme/none')).body)).toEqual([]);
    const b = await owner('parc-033-b');
    await hidden(b.c, '/api/v1/activity', a.org.id);
    await needsCredential('GET', '/api/v1/activity');
  }, T);

  it.skipIf(W034 !== '')(named('E2E-PARC-034 — 6.4 usage of a new org: the report, the summary and the events read, for the org only', W034), async () => {
    const a = await owner('parc-034');
    for (const p of ['/api/v1/usage', '/api/v1/usage/summary', '/api/v1/usage/events']) {
      const r = await call(a.c, 'GET', p);
      expect(r.status, `${p} → ${r.status} ${JSON.stringify(r.body)}`).toBe(200);
      expect(typeof r.body).toBe('object');
      await needsCredential('GET', p);
    }
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/usage/events')).body, 'events')).toEqual([]);
  }, T);

  it.skipIf(W035 !== '')(named('E2E-PARC-035 — 6.6 the TeamCode import refuses a caller without credential, a member, and a malformed payload', W035), async () => {
    await needsCredential('POST', '/api/v1/import/teamcode', { members: [] });
    const a = await owner('parc-035');
    const bad = await call(a.c, 'POST', '/api/v1/import/teamcode', { members: 'not a list' });
    expect([400, 422]).toContain(bad.status);
    const m = email('parc-035-m');
    expect((await invite(a.person, a.org.id, [m])).status).toBeLessThan(300);
    const { person } = await join(m);
    const member = await call({ ...person.caller, org: a.org.id }, 'POST', '/api/v1/import/teamcode', { members: [] });
    expect(member.status).toBe(403);
  }, T);

  it.skipIf(W036 !== '')(named('E2E-PARC-036 — 6.7 the app signs in by PKCE, reads its queue and an approval view, sets its notification preferences', W036), async () => {
    // A code never issued is refused: the app gets no token without the GitHub round trip.
    const forged = await call({}, 'POST', '/api/v1/auth/mobile/token', { code: 'forged', codeVerifier: 'x'.repeat(43), redirectUri: 'ostrom://auth' });
    expect([400, 401]).toContain(forged.status);
    expect(forged.body?.['token']).toBeUndefined();
    const a = await owner('parc-036');
    const queue = await call(a.c, 'GET', '/api/v1/approvals/queue');
    expect(queue.status).toBe(200);
    expect(Array.isArray(queue.body?.['pending'])).toBe(true);
    expect(Array.isArray(queue.body['recent'])).toBe(true);
    expect(queue.body['you']).toBeTruthy();
    expect((await call(a.c, 'GET', `/api/v1/approvals/${randomUUID()}/view`)).status).toBe(404);
    const prefs = { requests: true, decisions: false, spending: true };
    const put = await call(a.c, 'PUT', '/api/v1/me/notifications', prefs);
    expect(put.body).toMatchObject(prefs);
    expect((await call(a.c, 'GET', '/api/v1/me/notifications')).body).toMatchObject(prefs);
    await needsCredential('GET', '/api/v1/approvals/queue');
  }, T);

  it.skipIf(W037 !== '')(named('E2E-PARC-037 — 6.7 a push device is registered, its token never read back, then removed', W037), async () => {
    const a = await owner('parc-037');
    const pushToken = `ExponentPushToken[${randomUUID()}]`;
    const made = await call(a.c, 'POST', '/api/v1/push-devices', { pushToken, provider: 'expo', platform: 'ios', locale: 'fr-FR' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ provider: 'expo', platform: 'ios', locale: 'fr-FR' });
    expect(JSON.stringify(made.body)).not.toContain(pushToken);
    const b = await owner('parc-037-b');
    expect((await call(b.c, 'DELETE', `/api/v1/push-devices/${made.body['id'] as string}`)).status).toBeGreaterThanOrEqual(400);
    expect((await call(a.c, 'DELETE', `/api/v1/push-devices/${made.body['id'] as string}`)).status).toBeLessThan(300);
    await needsCredential('POST', '/api/v1/push-devices', { pushToken, provider: 'expo', platform: 'ios' });
  }, T);
});
