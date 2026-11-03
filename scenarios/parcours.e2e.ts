// SPDX-License-Identifier: Apache-2.0
// E2E-PARC : the client journey of demo/PARCOURS.md (steps 2.2 to 6.7), each step against the real server. Every test
// probes the exact routes it needs and stays skipped, with the missing routes in its title, until they are on main:
// the bench switches each step on by itself as the server pull requests land. Steps already covered by another family
// (AUTH, LOGIN, YES, ISO, BILL, GATE) are not repeated here: the mapping is at the top of the PARC section of
// SCENARIOS.md. Screens (web, app) are out of the bench's scope: each scenario proves the server route the screen reads.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Caller } from '../src/isolation.ts';
import { FakeExpo } from '../src/fake-expo.ts';
import { invitationToken } from '../src/mail.ts';
import { FakeTokens } from '../src/fake-tokens.ts';
import { isServed } from '../src/probe.ts';
import { FAKE_EXPO_PORT, FAKE_TOKENS_PORT, MAIL_DIR, SERVER_URL } from './env.ts';
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

/** The text of a mail the server wrote to OSTROM_MAIL_DIR for `to` that contains `marker`, waited for up to `ms`. */
async function mailWith(to: string, marker: string, ms: number): Promise<string> {
  const until = Date.now() + ms;
  for (;;) {
    for (const name of readdirSync(MAIL_DIR)) {
      const path = joinPath(MAIL_DIR, name);
      if (!statSync(path).isFile()) continue;
      const text = readFileSync(path, 'utf8');
      if (text.toLowerCase().startsWith(`to: ${to.toLowerCase()}\n`) && text.includes(marker)) return text;
    }
    if (Date.now() > until) throw new Error(`no mail to ${to} with ${marker} in ${MAIL_DIR} after ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

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

/** A new person invited into `a`'s organization with `role`, who accepted: signed in, a member. */
async function invited(a: Owner, who: string, role = 'member'): Promise<Person> {
  const address = email(who);
  expect((await invite(a.person, a.org.id, [address], role)).status, `invite ${role}`).toBeLessThan(300);
  const { person, accepted } = await join(address);
  expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
  return person;
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
const W039 = (await needs(['GET', '/api/v1/groups'], ['POST', '/api/v1/groups'], ['GET', '/api/v1/groups/{id}'], ['PATCH', '/api/v1/groups/{id}'], ['DELETE', '/api/v1/groups/{id}'], ['PUT', '/api/v1/groups/{id}/members/{id}'], ['DELETE', '/api/v1/groups/{id}/members/{id}'], ['POST', '/api/v1/groups/{id}/members/{id}/pause'])) || ORG64 || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '');
const W043 = (await needs(['POST', '/api/v1/groups'], ['POST', '/api/v1/groups/{id}/members/{id}/pause'], ['POST', '/api/v1/secrets'], ['POST', '/api/v1/accounts'], ['PATCH', '/api/v1/accounts/{id}'], ['POST', '/api/v1/tokens'], ['POST', '/api/v1/inference/v1/messages'])) || ORG64 || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '') || (FAKE_TOKENS_PORT <= 0 ? 'no fake provider (OSTROM_E2E_FAKE_TOKENS_PORT)' : '');
const W041 = (await needs(['GET', '/api/v1/orgs/{id}'], ['PATCH', '/api/v1/orgs/{id}'], ['POST', '/api/v1/orgs/{id}/members/invites'])) || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '');
const W042 = (await needs(['DELETE', '/api/v1/orgs/{id}'], ['PATCH', '/api/v1/orgs/{id}'], ['GET', '/api/v1/orgs/{id}/members'], ['POST', '/api/v1/orgs/{id}/members/invites'], ['POST', '/api/v1/secrets'], ['POST', '/api/v1/tokens'])) || ORG64 || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '');

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

  // The groups of 2.8: owners and admins make them and change their members, every member reads them, people are named
  // by login, and another organization sees none (ostrom-server, groups pull request).
  it.skipIf(W039 !== '')(named('E2E-PARC-039 — 2.8 an owner makes a group of members by login, pauses and removes one; members read it, another org sees nothing', W039), async () => {
    const a = await owner('parc-039');
    const invited = email('parc-039-m');
    expect((await invite(a.person, a.org.id, [invited])).status).toBeLessThan(300);
    const { person, accepted } = await join(invited);
    expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
    const login = (await profileOf(person.caller)).login;
    const m: Caller = { ...person.caller, org: a.org.id };
    const name = `Parc 039 ${randomUUID().slice(0, 6)}`;

    const made = await call(a.c, 'POST', '/api/v1/groups', { name, members: [login] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ name, members: [login], accounts: [], paused: [] });
    const id = made.body['id'] as string;
    expect(itemsOf((await call(m, 'GET', '/api/v1/groups')).body).map((g) => g['id'])).toContain(id);
    expect((await call(m, 'GET', `/api/v1/groups/${id}`)).body).toMatchObject({ id, name, members: [login] });
    // A member reads only; a name is taken whatever its case; an account the organization does not share is refused.
    expect((await call(m, 'POST', '/api/v1/groups', { name: `${name} m` })).status).toBe(403);
    expect((await call(m, 'PUT', `/api/v1/groups/${id}/members/${login}`)).status).toBe(403);
    expect((await call(a.c, 'POST', '/api/v1/groups', { name: name.toUpperCase() })).status).toBe(409);
    expect((await call(a.c, 'POST', '/api/v1/groups', { name: `${name} x`, accounts: [randomUUID()] })).status).toBe(400);
    expect((await call(a.c, 'POST', '/api/v1/groups', { name: `${name} y`, members: ['nobody-here'] })).status).toBe(400);

    const until = '2099-01-01T00:00:00Z';
    expect((await call(a.c, 'POST', `/api/v1/groups/${id}/members/${login}/pause`, { until })).status).toBe(204);
    expect((await call(m, 'GET', `/api/v1/groups/${id}`)).body).toMatchObject({ paused: [{ login, until }] });
    const renamed = await call(a.c, 'PATCH', `/api/v1/groups/${id}`, { name: `${name} b` });
    expect(renamed.body, JSON.stringify(renamed.body)).toMatchObject({ id, name: `${name} b`, members: [login] });
    expect((await call(a.c, 'DELETE', `/api/v1/groups/${id}/members/${login}`)).status).toBe(204);
    expect((await call(a.c, 'GET', `/api/v1/groups/${id}`)).body).toMatchObject({ members: [], paused: [] });
    expect((await call(a.c, 'DELETE', `/api/v1/groups/${id}/members/${login}`)).status).toBe(404);
    expect((await call(a.c, 'PUT', `/api/v1/groups/${id}/members/${login}`)).status).toBe(204);

    const b = await owner('parc-039-b');
    expect((await call(b.c, 'GET', `/api/v1/groups/${id}`)).status).toBe(404);
    expect((await call(b.c, 'PATCH', `/api/v1/groups/${id}`, { name: 'taken over' })).status).toBe(404);
    expect((await call(b.c, 'DELETE', `/api/v1/groups/${id}`)).status).toBe(404);
    await hidden(b.c, '/api/v1/groups', id);

    expect((await call(a.c, 'DELETE', `/api/v1/groups/${id}`)).status).toBe(204);
    expect((await call(a.c, 'GET', `/api/v1/groups/${id}`)).status).toBe(404);
    await needsCredential('GET', '/api/v1/groups');
    await needsCredential('POST', '/api/v1/groups', { name });
  }, T);

  // An account lent to a group (`sharedWith: group:<id>`, ostrom-server#245): the gateway serves it to the group's members
  // who are not paused and to no one else, its owner included; a group of another organization is refused. The fake
  // provider of src/fake-tokens.ts stands for Anthropic's API behind the gateway, so a served call is seen there.
  it.skipIf(W043 !== '')(named('E2E-PARC-043 — 2.8 an account lent to a group serves its members who are not paused, and no one else, not even its owner', W043), async () => {
    const provider = await new FakeTokens().start(FAKE_TOKENS_PORT);
    try {
      const a = await owner('parc-043');
      const member = async (who: string) => {
        const address = email(who);
        expect((await invite(a.person, a.org.id, [address])).status).toBeLessThan(300);
        const { person, accepted } = await join(address);
        expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
        return { c: { ...person.caller, org: a.org.id } as Caller, login: (await profileOf(person.caller)).login };
      };
      const inside = await member('parc-043-in');
      const outside = await member('parc-043-out');
      // Each person's agent reaches the gateway with a personal token of `inference:use`.
      const tokenOf = async (c: Caller) => {
        const pat = await call(c, 'POST', '/api/v1/tokens', { name: 'e2e parc-043', scopes: ['inference:use'], expiresInDays: 1 });
        expect(pat.status, JSON.stringify(pat.body)).toBe(201);
        return String(pat.body['secret']);
      };
      const [insideToken, outsideToken, ownerToken] = [await tokenOf(inside.c), await tokenOf(outside.c), await tokenOf(a.c)];
      // Served: the call answers 200 and reaches the provider; refused: neither.
      const served = async (token: string) => {
        const before = provider.calls.length;
        const r = await call({ token }, 'POST', '/api/v1/inference/v1/messages', { model: 'claude-sonnet-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'hello' }] });
        const reached = provider.calls.length > before;
        expect(reached, `${r.status} ${JSON.stringify(r.body)}`).toBe(r.status === 200);
        return reached ? (provider.calls.at(-1)?.authorization ?? '') : '';
      };

      const made = await call(a.c, 'POST', '/api/v1/groups', { name: `Parc 043 ${randomUUID().slice(0, 6)}`, members: [inside.login] });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const group = `group:${made.body['id'] as string}`;
      const value = `sk-ant-oat01-parc043-${randomUUID()}`;
      const secret = `PARC043_${randomUUID().slice(0, 8).toUpperCase()}`;
      expect((await call(a.c, 'POST', '/api/v1/secrets', { name: secret, value })).status).toBeLessThan(300);
      const lent = await call(a.c, 'POST', '/api/v1/accounts', { provider: 'anthropic', label: 'Max of parc-043', credentialSecret: secret, sharedWith: [group] });
      expect(lent.status, JSON.stringify(lent.body)).toBe(201);
      expect(lent.body['sharedWith']).toEqual([group]);
      const account = lent.body['id'] as string;
      expect((await call(a.c, 'GET', `/api/v1/groups/${made.body['id'] as string}`)).body['accounts']).toEqual([account]);

      expect(await served(insideToken), 'a member of the group').toContain(value);
      expect(await served(outsideToken), 'a member outside the group').toBe('');
      expect(await served(ownerToken), 'its owner: lent to the group only').toBe('');

      const pause = `/api/v1/groups/${made.body['id'] as string}/members/${inside.login}/pause`;
      expect((await call(a.c, 'POST', pause, { until: '2099-01-01T00:00:00Z' })).status).toBe(204);
      expect(await served(insideToken), 'paused in the group').toBe('');
      // The pause is over: the member is served again.
      expect((await call(a.c, 'POST', pause, { until: new Date(Date.now() - 1_000).toISOString() })).status).toBe(204);
      expect(await served(insideToken), 'back from the pause').toContain(value);

      // A group of another organization lends nothing: 400, and the account keeps its group.
      const b = await owner('parc-043-b');
      const theirs = await call(b.c, 'POST', '/api/v1/groups', { name: 'Parc 043 theirs' });
      expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
      const foreign = `group:${theirs.body['id'] as string}`;
      expect((await call(a.c, 'PATCH', `/api/v1/accounts/${account}`, { sharedWith: [foreign] })).status).toBe(400);
      expect((await call(a.c, 'POST', '/api/v1/accounts', { provider: 'anthropic', label: 'Max of parc-043 b', credentialSecret: secret, sharedWith: [foreign] })).status).toBe(400);
      expect((await call(a.c, 'PATCH', `/api/v1/accounts/${account}`, { sharedWith: ['group:not-an-id'] })).status).toBe(400);
      const kept = itemsOf((await call(a.c, 'GET', '/api/v1/accounts')).body).find((x) => x['id'] === account);
      expect(kept?.['sharedWith']).toEqual([group]);
      expect((await call(b.c, 'GET', `/api/v1/groups/${theirs.body['id'] as string}`)).body['accounts']).toEqual([]);
      expect((await call(b.c, 'PATCH', `/api/v1/accounts/${account}`, { sharedWith: [foreign] })).status).toBe(404);
      expect(await served(insideToken), 'still lent to its group').toContain(value);
    } finally {
      await provider.stop();
    }
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

  it.skipIf(W041 !== '')(named('E2E-PARC-041 — 2.11 an admin renames the organization and sets its time zone; a member or an approver cannot, another org gets 404', W041), async () => {
    const a = await owner('parc-041');
    const admin = await invited(a, 'parc-041-admin', 'admin');
    const member = await invited(a, 'parc-041-member');
    const approver = await invited(a, 'parc-041-approver', 'approver');
    const path = `/api/v1/orgs/${a.org.id}`;
    // A new organization is in UTC until an owner or an admin sets its zone.
    expect((await call(a.person.caller, 'GET', path)).body).toMatchObject({ id: a.org.id, timeZone: 'UTC' });

    const name = `Parc 041 ${randomUUID().slice(0, 6)}`;
    const changed = await call(admin.caller, 'PATCH', path, { name, timeZone: 'Europe/Paris' });
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

    // Neither a plain member nor an approver may change it: 403, and nothing changes.
    for (const who of [member, approver]) {
      const refused = await call(who.caller, 'PATCH', path, { name: 'by a non-manager' });
      expect(refused.status, JSON.stringify(refused.body)).toBe(403);
      expect(refused.body?.['error']).toBeTruthy();
    }
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
    const m = await invited(a, 'parc-042-member');
    const admin = await invited(a, 'parc-042-admin', 'admin');
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
    const token = { token: made.body['secret'] as string };
    // The same token does change the organization (PATCH takes tokens): its refusal below is the browser-only rule.
    const renamed = await call(token, 'PATCH', path, { name: `Parc 042 ${randomUUID().slice(0, 6)}` });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    const byToken = await call(token, 'DELETE', path, { confirm: a.org.slug });
    expect(byToken.status, JSON.stringify(byToken.body)).toBe(403);
    expect(JSON.stringify(byToken.body)).toContain('browser session');
    // The owner only: not a member, not even an admin (who may change the settings); another org's owner gets 404;
    // the short name must be typed again.
    for (const who of [m, admin]) expect((await call(who.caller, 'DELETE', path, { confirm: a.org.slug })).status).toBe(403);
    expect((await call(b.person.caller, 'DELETE', path, { confirm: a.org.slug })).status).toBe(404);
    expect((await call(a.person.caller, 'DELETE', `/api/v1/orgs/${b.org.id}`, { confirm: b.org.slug })).status).toBe(404);
    const wrong = await call(a.person.caller, 'DELETE', path, { confirm: `${a.org.slug}-typo` });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(400);
    expect((await call(a.person.caller, 'GET', path)).status, 'still there after the refusals').toBe(200);
    expect(itemsOf((await call(a.person.caller, 'GET', `${path}/members`)).body).length, 'its members read before').toBe(3);
    await needsCredential('DELETE', path, { confirm: a.org.slug });

    // Signed in a moment ago (under the 5 minutes the deletion asks): deleted.
    const deleted = await call(a.person.caller, 'DELETE', path, { confirm: a.org.slug });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);

    // Nothing of it reads any more, for its owner as for its member: the organization, its members, its data.
    for (const who of [a.person.caller, m.caller]) {
      for (const ref of [a.org.id, a.org.slug]) expect((await call(who, 'GET', `/api/v1/orgs/${ref}`)).status).toBe(404);
      expect((await call(who, 'GET', `${path}/members`)).status).toBe(404);
      for (const list of ['/api/v1/me/organizations', '/api/v1/orgs']) {
        const r = await call(who, 'GET', list);
        expect(r.status, `${list} after the deletion`).toBe(200);
        expect(itemsOf(r.body).map((o) => o['id'])).not.toContain(a.org.id);
      }
      const data = await call({ ...who, org: a.org.id }, 'GET', '/api/v1/secrets');
      expect(data.status, `secrets of a deleted org → ${data.status}`).toBeGreaterThanOrEqual(400);
      expect(data.status).toBeLessThan(500);
      expect(JSON.stringify(data.body)).not.toContain(secret);
    }
    expect((await call(a.person.caller, 'PATCH', path, { name: 'after the deletion' })).status).toBe(404);
    expect((await call(token, 'PATCH', path, { name: 'by its token, after the deletion' })).status).toBe(404);

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
const W040 = (await needs(['GET', '/api/v1/audit'], ['PATCH', '/api/v1/orgs/{id}/members/{id}'])) || ORG64;

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
    // A person's budget (ostrom-server#230): by the day, that warns, named by the member's id from the members list.
    const self = itemsOf((await call(a.c, 'GET', `/api/v1/orgs/${a.org.id}/members`)).body, 'items')[0]?.['id'];
    expect(typeof self, 'the members list carries each member id').toBe('string');
    const person = await call(a.c, 'PUT', '/api/v1/budgets', { scope: 'member', subject: self, usdPerDay: 20, hardStop: false });
    expect(person.status, JSON.stringify(person.body)).toBe(200);
    expect(person.body).toMatchObject({ scope: 'member', subject: self, usdPerDay: 20, hardStop: false });
    const listed = itemsOf((await call(a.c, 'GET', '/api/v1/budgets')).body).filter((i) => i['subject'] === self);
    expect(listed).toEqual([expect.objectContaining({ usdPerDay: 20, hardStop: false })]);
    expect(listed[0]).not.toHaveProperty('usdPerMonth');
    expect(JSON.stringify((await call(b.c, 'GET', '/api/v1/budgets')).body)).not.toContain(String(self));
    // Refused shapes: a workflow budget (not served) and an unknown scope.
    for (const bad of [{ scope: 'workflow', subject: 'wf', usdPerMonth: 5 }, { scope: 'team', usdPerMonth: 5 }]) expect((await call(a.c, 'PUT', '/api/v1/budgets', bad)).status).toBe(400);
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

  it.skipIf(W040 !== '')(named('E2E-PARC-040 — 3.6 the audit log is read by an owner and an admin, refused to a member, and shows nothing of another org', W040), async () => {
    const a = await owner('parc-040');
    const invited = email('parc-040-m');
    expect((await invite(a.person, a.org.id, [invited])).status).toBeLessThan(300);
    const { person, accepted } = await join(invited);
    expect(accepted.status).toBeLessThan(300);
    const member: Caller = { ...person.caller, org: a.org.id };

    // The owner reads the signed lines of the org (`AuditEvent`), newest first: its creation and the member who joined.
    const read = await call(a.c, 'GET', '/api/v1/audit');
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const items = itemsOf(read.body);
    for (const i of items) {
      for (const k of ['id', 'at', 'event', 'actor', 'subject']) expect(typeof i[k], k).toBe('string');
      expect(typeof i['meta']).toBe('object');
    }
    const ats = items.map((i) => Date.parse(i['at'] as string));
    expect([...ats].sort((x, y) => y - x)).toEqual(ats);
    const subjects = items.map((i) => i['subject'] as string);
    expect(subjects).toContain(`org:${a.org.id}`);
    const joined = items.find((i) => (i['subject'] as string).startsWith('member:'));
    expect(joined, JSON.stringify(items)).toBeDefined();
    // Filtered by event name, only that event comes back.
    const event = joined?.['event'] as string;
    const filtered = itemsOf((await call(a.c, 'GET', `/api/v1/audit?event=${encodeURIComponent(event)}`)).body);
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    for (const i of filtered) expect(i['event']).toBe(event);

    // A plain member is refused (owners and admins only); made admin, the same person reads the same log.
    expect((await call(member, 'GET', '/api/v1/audit')).status).toBe(403);
    const login = (await profileOf(person.caller)).login;
    const up = await call(a.person.caller, 'PATCH', `/api/v1/orgs/${a.org.id}/members/${encodeURIComponent(login)}`, { role: 'admin' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const asAdmin = await call(member, 'GET', '/api/v1/audit');
    expect(asAdmin.status, JSON.stringify(asAdmin.body)).toBe(200);
    expect(itemsOf(asAdmin.body).map((i) => i['subject'])).toContain(`org:${a.org.id}`);

    // Another org's owner: 404 when naming the first org, and their own log names none of its lines.
    const b = await owner('parc-040-b');
    expect((await call({ ...b.person.caller, org: a.org.id }, 'GET', '/api/v1/audit')).status).toBe(404);
    const theirs = await call(b.c, 'GET', '/api/v1/audit');
    expect(theirs.status).toBe(200);
    for (const marker of [a.org.id, ...subjects.filter((x) => x.startsWith('member:'))]) expect(JSON.stringify(theirs.body)).not.toContain(marker);
    await needsCredential('GET', '/api/v1/audit');
  }, T);
});

// --------------------------------------------------------------------------------------- 4. Workflows and automations

const W021 = (await needs(['GET', '/api/v1/workflows'], ['POST', '/api/v1/workflows'], ['PUT', '/api/v1/workflows/{id}'], ['DELETE', '/api/v1/workflows/{id}'], ['GET', '/api/v1/packages/current'])) || ACTORS;
// The runs of a workflow need the workflow engine: until the server serves their routes (`planned` in the contract),
// PARC-022 is skipped by name with PARCOURS 4.1, never silently.
const W022 = await needs(['GET', '/api/v1/workflows/{id}/runs'], ['POST', '/api/v1/workflows/{id}/runs'], ['GET', '/api/v1/runs']).then((why) =>
  why ? `no workflow engine on the server yet, PARCOURS 4.1: ${why}` : '',
);
// The engine that plays a run comes with the run's own routes (ostrom-server, feat/workflow-run-engine): before them a
// run stays queued; with them a lone trigger ends succeeded, and an agent then a gate are played to the end.
const PLAYED = (await needs(['GET', '/api/v1/runs/{id}'], ['POST', '/api/v1/runs/{id}/cancel'])) === '';
const W022P = W022 || (PLAYED ? '' : 'no workflow engine on the server yet, PARCOURS 4.1: not served yet: GET /api/v1/runs/{id}, POST /api/v1/runs/{id}/cancel') || ACTORS;
const W023 = (await needs(['POST', '/api/v1/automations'], ['POST', '/api/v1/automations/{id}/enable'], ['PUT', '/api/v1/automations/{id}'], ['POST', '/api/v1/automations/{id}/run'], ['POST', '/api/v1/automations/{id}/webhook/rotate-secret'], ['DELETE', '/api/v1/automations/{id}'])) || ORG64;
const W024 = (await needs(['POST', '/api/v1/waits'], ['GET', '/api/v1/waits/{id}'], ['POST', '/api/v1/waits/{id}/answer'], ['POST', '/api/v1/waits/{id}/cancel'])) || ORG64;
const W044 = (await needs(['POST', '/api/v1/waits/mcp'], ['POST', '/api/v1/waits'], ['POST', '/api/v1/waits/{id}/answer'], ['POST', '/api/v1/launches'], ['POST', '/api/v1/sessions'])) || ACTORS || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '');

/** One JSON-RPC message to the waits MCP server of `session` (`POST /api/v1/waits/mcp?session=`). */
async function waitsMcp(caller: Caller, session: string, method: string, params: Record<string, unknown> = {}) {
  const r = await call(caller, 'POST', `/api/v1/waits/mcp?session=${encodeURIComponent(session)}`, { jsonrpc: '2.0', id: randomUUID(), method, params });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/** A tool of the waits MCP server: its text, and whether the server answered it as a tool error. */
async function waitsTool(caller: Caller, session: string, name: string, args: Record<string, unknown> = {}) {
  const body = await waitsMcp(caller, session, 'tools/call', { name, arguments: args });
  const result = (body['result'] ?? {}) as { content?: { text?: string }[]; isError?: boolean };
  expect(body['result'], JSON.stringify(body)).toBeDefined();
  return { text: (result.content ?? []).map((c) => c.text ?? '').join('\n'), isError: result.isError === true };
}

/** The wait id of an `ask_human` text (« Asked: wait <id> is open, for member <member>. »). */
const askedWait = (text: string) => /wait ([0-9a-f-]{36}) is open/.exec(text)?.[1] ?? '';

/** The run `id` as `caller` reads it once `done` holds, read again every half second for up to `ms`. */
async function runUntil(caller: Caller, id: string, done: (run: Record<string, unknown>) => boolean, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await call(caller, 'GET', `/api/v1/runs/${id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    if (done(r.body)) return r.body;
    if (Date.now() > until) throw new Error(`run ${id} after ${ms} ms: ${JSON.stringify(r.body)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A workflow of the contract (`Workflow`): one trigger node, no edge. */
const workflow = (id: string, name: string, status = 'proposed', extra: Record<string, unknown> = {}) => ({ id, name, domain: 'git', nodes: [{ id: 'start', kind: 'trigger', label: 'Session start' }], edges: [], start: 'start', status, foundAt: new Date().toISOString(), ...extra });

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
    // A PUT on an id the organization does not have is not found and creates nothing (contract: 200 or 404, no 201).
    const unknown = `parc-${randomUUID().slice(0, 8)}`;
    const notFound = await call(a.c, 'PUT', `/api/v1/workflows/${unknown}`, { workflow: workflow(unknown, 'Parc 021 ghost') });
    expect(notFound.status, JSON.stringify(notFound.body)).toBe(404);
    expect((await call(a.c, 'GET', `/api/v1/workflows/${unknown}`)).status).toBe(404);
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/workflows')).body)).toContain('Parc 021 bis');
    expect(JSON.stringify((await call(a.c, 'GET', '/api/v1/workflows')).body)).not.toContain(unknown);
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
    // POST takes the workflow itself (as in PARC-021); an owner's console creates it accepted, which a run needs.
    const inputs = [{ id: 'branch', label: 'Branch', required: true }, { id: 'note', label: 'Note', default: 'none', maxLength: 8 }];
    const made = await call(a.c, 'POST', '/api/v1/workflows', workflow(wid, 'Parc 022', 'accepted', { inputs }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const version = made.body['version'] as number;
    const runs = `/api/v1/workflows/${wid}/runs`;
    // What the workflow does not declare, a required input left out, a value too long: 400, nothing started.
    expect((await call(a.c, 'POST', runs, { inputs: { branch: 'main', target: 'prod' } })).status).toBe(400);
    expect((await call(a.c, 'POST', runs, { inputs: {} })).status).toBe(400);
    expect((await call(a.c, 'POST', runs, { inputs: { branch: 'main', note: 'far too long' } })).status).toBe(400);
    const run = await call(a.c, 'POST', runs, { inputs: { branch: 'main' } });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    // It is recorded queued, with the version it started from and its inputs (default taken).
    expect(run.body).toMatchObject({ workflowId: wid, workflowName: 'Parc 022', workflowVersion: version, status: 'queued', source: 'manual', inputs: { branch: 'main', note: 'none' } });
    for (const k of ['id', 'startedBy', 'startedAt']) expect(run.body).toHaveProperty(k);
    const id = run.body['id'] as string;
    expect(itemsOf((await call(a.c, 'GET', runs)).body).map((r) => r['id'])).toContain(id);
    expect(itemsOf((await call(a.c, 'GET', '/api/v1/runs')).body).map((r) => r['id'])).toContain(id);
    // Without the engine it stays queued; with it, its lone trigger has nothing after it and the run ends succeeded.
    const status = PLAYED ? 'succeeded' : 'queued';
    // A field without a value is left out of the answer (no null): an ended run has no current node.
    if (PLAYED) expect((await runUntil(a.c, id, (r) => r['status'] === 'succeeded'))['currentNodeId']).toBeUndefined();
    const ids = async (s: string) => itemsOf((await call(a.c, 'GET', `/api/v1/runs?status=${s}`)).body).map((r) => r['id']);
    expect(await ids(status)).toContain(id);
    expect(await ids(PLAYED ? 'queued' : 'succeeded')).not.toContain(id);
    expect((await call(a.c, 'GET', '/api/v1/runs?status=lost')).status).toBe(400);
    // A proposed workflow is accepted before it runs; an unknown one is not found.
    const proposed = `parc-${randomUUID().slice(0, 8)}`;
    expect((await call(a.c, 'POST', '/api/v1/workflows', workflow(proposed, 'Parc 022 proposed'))).status).toBe(201);
    expect((await call(a.c, 'POST', `/api/v1/workflows/${proposed}/runs`, { inputs: {} })).status).toBe(409);
    expect((await call(a.c, 'POST', `/api/v1/workflows/parc-absent-${ID.slice(0, 8)}/runs`, { inputs: {} })).status).toBe(404);
    expect((await call(a.c, 'GET', `/api/v1/workflows/parc-absent-${ID.slice(0, 8)}/runs`)).status).toBe(404);
    // A member reads the runs and starts none.
    const member = await invited(a, 'parc-022-m');
    const m: Caller = { ...member.caller, org: a.org.id };
    expect(itemsOf((await call(m, 'GET', runs)).body).map((r) => r['id'])).toContain(id);
    expect((await call(m, 'POST', runs, { inputs: { branch: 'main' } })).status).toBe(403);
    // Another organization neither sees, reads nor starts them.
    const b = await owner('parc-022-b');
    await hidden(b.c, '/api/v1/runs', id);
    expect((await call(b.c, 'GET', runs)).status).toBe(404);
    expect((await call(b.c, 'POST', runs, { inputs: { branch: 'main' } })).status).toBe(404);
    expect(itemsOf((await call(a.c, 'GET', runs)).body)).toHaveLength(1);
    await needsCredential('GET', '/api/v1/runs');
    await needsCredential('POST', runs, { inputs: {} });
  }, T);

  it.skipIf(W022P !== '')(named('E2E-PARC-022 — 4.1 a run is played: its agent node runs a cloud session, its gate waits for the yes, the run succeeds; another is cancelled', W022P), async () => {
    const a = await owner('parc-022-p');
    const login = (await profileOf(a.person.caller)).login;
    const wid = `parc-${randomUUID().slice(0, 8)}`;
    const nodes = [
      { id: 'build', kind: 'agent', label: 'Build', run: { instructions: 'Fix the build of {{inputs.branch}}', agent: 'claude' } },
      { id: 'review', kind: 'gate', label: 'Review', approvers: [login] },
    ];
    const edges = [{ from: 'build', to: 'review' }, { from: 'review', to: null, on: 'approved' }];
    const inputs = [{ id: 'branch', label: 'Branch', required: true }];
    const made = await call(a.c, 'POST', '/api/v1/workflows', workflow(wid, 'Parc 022 played', 'accepted', { nodes, edges, start: 'build', inputs }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const start = async () => {
      const r = await call(a.c, 'POST', `/api/v1/workflows/${wid}/runs`, { inputs: { branch: 'main' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body['id'] as string;
    };
    const id = await start();

    // 1. The agent node: a cloud session of the starter, with the node's prompt; the run is running on it.
    const running = await runUntil(a.c, id, (r) => typeof r['sessionId'] === 'string');
    expect(running).toMatchObject({ status: 'running', currentNodeId: 'build' });
    const session = running['sessionId'] as string;
    expect((running['visits'] as Record<string, unknown>[])[0]).toMatchObject({ seq: 1, nodeId: 'build', kind: 'agent', status: 'running', sessionId: session });
    const cloud = await call(a.c, 'GET', `/api/v1/cloud/sessions/${session}`);
    expect(cloud.status, JSON.stringify(cloud.body)).toBe(200);
    expect(cloud.body).toMatchObject({ id: session, agent: 'claude', name: 'Parc 022 played · Build' });
    // The session ends (no runner takes it on the bench): the node is done, and the gate opens for its approver.
    expect((await call(a.c, 'DELETE', `/api/v1/cloud/sessions/${session}`)).status).toBeLessThan(300);
    const waiting = await runUntil(a.c, id, (r) => r['status'] === 'waiting');
    const [agent, review] = waiting['visits'] as Record<string, unknown>[];
    expect(agent).toMatchObject({ nodeId: 'build', status: 'done', outcome: 'next' });
    expect(review).toMatchObject({ seq: 2, nodeId: 'review', kind: 'gate', status: 'waiting' });
    expect(waiting['currentNodeId']).toBe('review');

    // 2. The gate node: its approver's pending approval; the yes ends the run succeeded.
    const pending = await call(a.person.caller, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50');
    const mine = itemsOf(pending.body).find((x) => x['group'] === review?.['gateId']);
    expect(mine, JSON.stringify({ run: waiting, pending: pending.body })).toBeDefined();
    const yes = await call(a.person.caller, 'POST', `/api/v1/approvals/${String(mine?.['id'])}/answer`, { answer: 'approve', shownDigest: mine?.['shownDigest'] });
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    const ended = await runUntil(a.c, id, (r) => r['status'] !== 'waiting');
    expect(ended['status'], JSON.stringify(ended)).toBe('succeeded');
    expect(ended['currentNodeId']).toBeUndefined();
    expect((ended['visits'] as Record<string, unknown>[]).map((v) => [v['nodeId'], v['status'], v['outcome']])).toEqual([
      ['build', 'done', 'next'],
      ['review', 'done', 'approved'],
    ]);
    expect(typeof ended['endedAt']).toBe('string');
    // An ended run is not cancelled.
    expect((await call(a.c, 'POST', `/api/v1/runs/${id}/cancel`)).status).toBe(409);

    // 3. Another run is cancelled while its agent works: a member may not, the owner does, its session is ended.
    const other = await start();
    const second = (await runUntil(a.c, other, (r) => typeof r['sessionId'] === 'string'))['sessionId'] as string;
    const member = await invited(a, 'parc-022-pm');
    const m: Caller = { ...member.caller, org: a.org.id };
    expect((await call(m, 'GET', `/api/v1/runs/${other}`)).status).toBe(200);
    expect((await call(m, 'POST', `/api/v1/runs/${other}/cancel`)).status).toBe(403);
    const b = await owner('parc-022-pb');
    expect((await call(b.c, 'GET', `/api/v1/runs/${other}`)).status).toBe(404);
    expect((await call(b.c, 'POST', `/api/v1/runs/${other}/cancel`)).status).toBe(404);
    const cancelled = await call(a.c, 'POST', `/api/v1/runs/${other}/cancel`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toMatchObject({ id: other, status: 'cancelled' });
    expect((cancelled.body['visits'] as Record<string, unknown>[])[0]).toMatchObject({ nodeId: 'build', status: 'failed', outcome: 'cancelled' });
    expect((await call(a.c, 'POST', `/api/v1/runs/${other}/cancel`)).status).toBe(409);
    const until = Date.now() + 60_000;
    for (;;) {
      const s = await call(a.c, 'GET', `/api/v1/cloud/sessions/${second}`);
      if (s.body['desiredStatus'] === 'terminated' || s.body['status'] === 'terminated' || s.status === 404) break;
      if (Date.now() > until) throw new Error(`session ${second} of a cancelled run: ${JSON.stringify(s.body)}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect((await call(a.c, 'GET', `/api/v1/runs/${randomUUID()}`)).status).toBe(404);
    await needsCredential('GET', `/api/v1/runs/${id}`);
    await needsCredential('POST', `/api/v1/runs/${id}/cancel`);
  }, 180_000);

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

  it.skipIf(W044 !== '')(named('E2E-PARC-044 — 4.3 an agent token asks only its person, sees and cancels only the waits its person asked, never answers; a resumed segment asks too', W044), async () => {
    const a = await owner('parc-044');
    const repo = `acme/parc-${randomUUID().slice(0, 8)}`;
    // A second person of the org, who asks the owner a question about the owner's session.
    const otherEmail = email('parc-044-m');
    expect((await invite(a.person, a.org.id, [otherEmail], 'member')).status).toBe(200);
    const { person: other, accepted } = await join(otherEmail);
    expect(accepted.status).toBe(200);
    const m: Caller = { ...other.caller, org: a.org.id };

    // The owner's launch hands an agent token; its first hook opens the session the waits server is bound to.
    const launch = await call(a.c, 'POST', '/api/v1/launches', { agent: 'claude', repo });
    expect(launch.status, JSON.stringify(launch.body)).toBe(201);
    const agent: Caller = { token: launch.body['agentToken'] as string, org: a.org.id, ...(a.c.from ? { from: a.c.from } : {}) };
    const sid = randomUUID();
    const opened = await call(agent, 'POST', '/api/v1/sessions', { id: sid, launchId: launch.body['launchId'], repo, agent: 'claude' });
    expect(opened.status, JSON.stringify(opened.body)).toBeLessThan(300);
    const init = await waitsMcp(agent, sid, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    expect(JSON.stringify(init)).toContain('ostrom-waits');
    const tools = JSON.stringify(await waitsMcp(agent, sid, 'tools/list'));
    for (const t of ['ask_human', 'list_waits', 'get_wait', 'cancel_wait']) expect(tools).toContain(t);
    expect(tools, 'the agent has no tool to answer').not.toMatch(/"name":"answer/);

    // The agent asks its person: the wait is the owner's, in this session.
    const asked = await waitsTool(agent, sid, 'ask_human', { title: 'Parc 044 own', actions: [{ id: 'yes', label: 'Yes' }] });
    expect(asked.isError, asked.text).toBe(false);
    const own = askedWait(asked.text);
    expect(own, asked.text).not.toBe('');
    const ownWait = await call(a.c, 'GET', `/api/v1/waits/${own}`);
    expect(ownWait.body, JSON.stringify(ownWait.body)).toMatchObject({ status: 'open', sessionId: sid, question: { title: 'Parc 044 own' } });
    const ownerMember = ownWait.body['assignee'] as string;

    // Another person asks the owner about the same session: the agent neither lists, reads nor cancels that wait.
    const theirs = await call(m, 'POST', '/api/v1/waits', { question: { title: 'Parc 044 theirs', actions: [{ id: 'ok', label: 'OK' }] }, sessionId: sid, assignee: ownerMember });
    expect(theirs.status, JSON.stringify(theirs.body)).toBeLessThan(300);
    const theirsId = theirs.body['id'] as string;
    const listed = await waitsTool(agent, sid, 'list_waits', { status: 'all' });
    expect(listed.text).toContain(own);
    expect(listed.text).not.toContain(theirsId);
    expect(listed.text).not.toContain('Parc 044 theirs');
    for (const tool of ['get_wait', 'cancel_wait']) {
      const r = await waitsTool(agent, sid, tool, { wait: theirsId });
      expect(r.isError, `${tool}: ${r.text}`).toBe(true);
      expect(r.text).not.toContain('Parc 044 theirs');
    }
    expect((await call(a.c, 'GET', `/api/v1/waits/${theirsId}`)).body?.['status'], 'still open').toBe('open');

    // The agent asks only its person: naming the other member is a tool error, and no wait is opened.
    // The other person's member id: the assignee of a wait they ask themselves.
    const self = await call(m, 'POST', '/api/v1/waits', { question: { title: 'Parc 044 self', actions: [{ id: 'ok', label: 'OK' }] } });
    expect(self.status, JSON.stringify(self.body)).toBeLessThan(300);
    const otherMember = self.body['assignee'] as string;
    expect(otherMember).not.toBe(ownerMember);
    const elsewhere = await waitsTool(agent, sid, 'ask_human', { title: 'Parc 044 elsewhere', assignee: otherMember });
    expect(elsewhere.isError, elsewhere.text).toBe(true);
    expect((await waitsTool(agent, sid, 'list_waits', { status: 'all' })).text).not.toContain('Parc 044 elsewhere');

    // It never answers, not even its own question: the waits API refuses an agent token whatever it asks.
    const answer = await call(agent, 'POST', `/api/v1/waits/${own}/answer`, { action: 'yes' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(403);
    expect((await call(agent, 'GET', `/api/v1/waits/${own}`)).status).toBe(403);
    expect((await call(a.c, 'GET', `/api/v1/waits/${own}`)).body?.['status']).toBe('open');

    // It reads and cancels its own.
    const got = await waitsTool(agent, sid, 'get_wait', { wait: own });
    expect(got.isError, got.text).toBe(false);
    expect(got.text).toContain('Parc 044 own');
    expect((await waitsTool(agent, sid, 'cancel_wait', { wait: own })).isError).toBe(false);
    expect((await call(a.c, 'GET', `/api/v1/waits/${own}`)).body?.['status']).toBe('cancelled');

    // Resumed by another launch (`claude --resume` keeps the id), the session is segment `<id>~r<n>`: its agent asks
    // in that segment, and sees only what it asked there.
    expect((await call(agent, 'POST', `/api/v1/sessions/${sid}/end`, {})).status).toBeLessThan(300);
    const relaunch = await call(a.c, 'POST', '/api/v1/launches', { agent: 'claude', repo });
    expect(relaunch.status, JSON.stringify(relaunch.body)).toBe(201);
    const agent2: Caller = { ...agent, token: relaunch.body['agentToken'] as string };
    const resumed = await call(agent2, 'POST', '/api/v1/sessions', { id: sid, launchId: relaunch.body['launchId'], repo, agent: 'claude' });
    expect(resumed.status, JSON.stringify(resumed.body)).toBeLessThan(300);
    const segment = String(resumed.body['id'] ?? (resumed.body['session'] as Record<string, unknown> | undefined)?.['id'] ?? '');
    expect(segment, JSON.stringify(resumed.body)).toMatch(new RegExp(`^${sid}~r\\d+$`));
    const again = await waitsTool(agent2, segment, 'ask_human', { title: 'Parc 044 resumed' });
    expect(again.isError, again.text).toBe(false);
    const resumedWait = askedWait(again.text);
    expect((await call(a.c, 'GET', `/api/v1/waits/${resumedWait}`)).body).toMatchObject({ status: 'open', sessionId: segment });
    const listed2 = await waitsTool(agent2, segment, 'list_waits', { status: 'all' });
    expect(listed2.text).toContain(resumedWait);
    expect(listed2.text).not.toContain(own);
    expect(listed2.text).not.toContain(theirsId);

    // Another org sees none of it.
    const b = await owner('parc-044-b');
    await hidden(b.c, `/api/v1/waits/${resumedWait}`, 'Parc 044');
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
const W045 = (await needs(['GET', '/api/v1/activity'], ['POST', '/api/v1/rules'], ['POST', '/api/v1/gates'], ['POST', '/api/v1/tokens'])) || ORG64;
const W034 = (await needs(['GET', '/api/v1/usage'], ['GET', '/api/v1/usage/summary'], ['GET', '/api/v1/usage/events'])) || ORG64;
const W035 = (await needs(['POST', '/api/v1/import/teamcode'])) || ORG64;
const W036 = (await needs(['POST', '/api/v1/auth/mobile/token'], ['GET', '/api/v1/approvals/queue'], ['GET', '/api/v1/approvals/{id}/view'], ['GET', '/api/v1/me/notifications'], ['PUT', '/api/v1/me/notifications'])) || ACTORS;
const W037 = await needs(['POST', '/api/v1/push-devices'], ['DELETE', '/api/v1/push-devices/{id}']);
// The sending itself has no route to probe: the bench says where the fake Expo listens once the server points at it.
const W046 = (FAKE_EXPO_PORT === 0 ? 'no OSTROM_E2E_FAKE_EXPO_PORT (fake Expo, ostrom-server#228)' : '') || W013 || W037 || (await needs(['POST', '/api/v1/auth/logout']));

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

  it.skipIf(W045 !== '')(named('E2E-PARC-045 — 6.3 a gate line of the activity feed carries its repository, the real one first, none outside a repository, never another org', W045), async () => {
    const a = await owner('parc-045');
    const login = (await profileOf(a.person.caller)).login;
    const repo = `acme/parc-${randomUUID().slice(0, 8)}`;
    const real = `acme/real-${randomUUID().slice(0, 8)}`;
    // A rule whose gate covers a push to main in every repository (an action without `repos`), asked by a token.
    const rule = await call(a.c, 'POST', '/api/v1/rules', {
      statement: 'A push to main waits for a yes', group: 'git', scope: [],
      gate: { actions: [{ class: 'push-main', label: 'Push to main', patterns: [], repos: [] }], approvers: [login] },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const token = await call(a.c, 'POST', '/api/v1/tokens', { name: 'parc-045 asker', scopes: ['gates:ask', 'gates:read'], expiresInDays: 1 });
    expect(token.status, JSON.stringify(token.body)).toBeLessThan(300);
    const asker: Caller = { token: String(token.body['secret']), org: a.org.id };
    const sha = () => randomUUID().replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const push = async (where: Record<string, string>) => {
      const asked = await call(asker, 'POST', '/api/v1/gates', { ...where, class: 'push-main', tool: 'Bash', command: 'git push origin main', push: { remote: 'origin', refs: [{ ref: 'refs/heads/main', sha: sha() }] } });
      expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
      const gate = asked.body['gate'] as Record<string, unknown>;
      expect(gate['status'], JSON.stringify(asked.body)).toBe('pending');
      return gate['id'] as string;
    };
    const declared = await push({ repo });
    const moved = await push({ repo, realRepo: real });
    const outside = await push({});

    const feed = itemsOf((await call(a.c, 'GET', '/api/v1/activity?limit=50')).body);
    const line = (gate: string) => {
      const found = feed.find((i) => i['id'] === `gate.requested:${gate}`);
      expect(found, JSON.stringify(feed)).toBeDefined();
      return found as Record<string, unknown>;
    };
    expect(line(declared)['repo']).toBe(repo);
    expect(line(moved)['repo'], 'the repository the command really ran in').toBe(real);
    expect('repo' in line(outside), 'no repository: the field is not sent').toBe(false);

    // Another org's feed names none of them, and carries only its own repositories.
    const b = await owner('parc-045-b');
    const theirs = await call(b.c, 'GET', '/api/v1/activity?limit=50');
    expect(theirs.status).toBe(200);
    for (const marker of [repo, real, declared, moved, outside]) expect(JSON.stringify(theirs.body)).not.toContain(marker);
    expect((await call({ ...b.person.caller, org: a.org.id }, 'GET', '/api/v1/activity')).status).toBe(404);
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

  it.skipIf(W046 !== '')(named("E2E-PARC-046 — 6.7 a request for a yes reaches the approver's live phones of the org and their mailbox, no other phone, even when Expo fails", W046), async () => {
    const expo = await new FakeExpo().start(FAKE_EXPO_PORT);
    try {
      const a = await owner('parc-038');
      const reviewerEmail = email('parc-038-rev');
      expect((await invite(a.person, a.org.id, [reviewerEmail], 'admin')).status).toBe(200);
      const { person: reviewer, accepted } = await join(reviewerEmail);
      expect(accepted.status).toBe(200);
      const login = (await profileOf(reviewer.caller)).login;
      const phone = (name: string) => `ExponentPushToken[parc-038-${name}-${randomUUID()}]`;
      const register = async (c: Caller, pushToken: string) => {
        const made = await call(c, 'POST', '/api/v1/push-devices', { pushToken, provider: 'expo', platform: 'ios' });
        expect(made.status, JSON.stringify(made.body)).toBe(201);
      };
      // The reviewer's live phone in the gate's organization: the only one told.
      const live = phone('live');
      await register({ ...reviewer.caller, org: a.org.id }, live);
      // A phone registered from another session of the reviewer, then signed out of: forgotten with the session.
      const signedOut = phone('signed-out');
      const other = await signIn(reviewerEmail);
      await register({ ...other.caller, org: a.org.id }, signedOut);
      expect((await call(other.caller, 'POST', '/api/v1/auth/logout')).status).toBeLessThan(300);
      // The reviewer's phone in another organization they belong to: never read for this one's gates.
      const b = await owner('parc-038-b');
      expect((await invite(b.person, b.org.id, [reviewerEmail])).status).toBe(200);
      const { person: inB, accepted: joinedB } = await join(reviewerEmail);
      expect(joinedB.status).toBe(200);
      const otherOrg = phone('other-org');
      await register({ ...inB.caller, org: b.org.id }, otherOrg);
      // The asker's own phone: the owner is no approver of the rule.
      const owners = phone('owner');
      await register(a.c, owners);
      const ours = new Set([live, signedOut, otherOrg, owners]);

      const repo = `acme/parc-${randomUUID().slice(0, 8)}`;
      const made = await call(a.c, 'POST', '/api/v1/rules', {
        statement: 'A push to main waits for a review', group: 'git', scope: [repo],
        gate: { actions: [{ class: 'push-main', label: 'Push to main', patterns: [], repos: [repo] }], approvers: [login] },
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const token = await call(a.c, 'POST', '/api/v1/tokens', { name: 'parc-038 asker', scopes: ['gates:ask', 'gates:read'], expiresInDays: 1 });
      expect(token.status, JSON.stringify(token.body)).toBeLessThan(300);
      const asker: Caller = { token: String(token.body['secret']), org: a.org.id };
      /** Asks a push to main, answered at once (pending), and the reviewer's request for it. */
      const ask = async (fill: string) => {
        const sha = randomUUID().replaceAll('-', '').padEnd(40, fill).slice(0, 40);
        const asked = await call(asker, 'POST', '/api/v1/gates', { repo, class: 'git.push', tool: 'Bash', command: 'git push origin main', push: { remote: 'origin', refs: [{ ref: 'refs/heads/main', sha }] } });
        expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
        const gate = asked.body['gate'] as Record<string, unknown>;
        expect(gate['status'], JSON.stringify(asked.body)).toBe('pending');
        const pending = await call({ ...reviewer.caller, org: a.org.id }, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50');
        const request = itemsOf(pending.body).find((x) => x['group'] === gate['id']);
        expect(request, JSON.stringify({ gate: asked.body, pending: pending.body })).toBeDefined();
        return String(request?.['id']);
      };

      const first = await ask('0');
      const pushed = await expo.waitFor((m) => m.to === live, 30_000);
      expect(pushed.data).toEqual({ kind: 'approval', approvalId: first });
      // The lock screen shows the push to whoever holds the phone: the app's `requests` channel, and no word of the request.
      expect(pushed.channelId).toBe('requests');
      expect(`${pushed.title} ${pushed.body}`).not.toMatch(/acme|Push to main|ana/i);
      const mailed = await mailWith(reviewerEmail, `/yes/${first}`, 30_000);
      expect(mailed, 'the e-mail names no push token').not.toMatch(/ExponentPushToken/);
      // The outbox sends a request's notices together: a moment more, and still no other phone of ours was told.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(expo.messages.filter((m) => m.to !== undefined && ours.has(m.to)).map((m) => m.to)).toEqual([live]);

      // Expo down: the request is still pending at once, the e-mail still goes, and the push arrives on a later try.
      expo.refuseNext = 1;
      const second = await ask('1');
      await mailWith(reviewerEmail, `/yes/${second}`, 30_000);
      const retried = await expo.waitFor((m) => m.to === live && m.data['approvalId'] === second, 60_000);
      expect(retried.data).toEqual({ kind: 'approval', approvalId: second });
      expect(expo.refused).toBe(1);
      expect(expo.messages.filter((m) => m.to !== undefined && ours.has(m.to) && m.to !== live)).toEqual([]);
    } finally {
      await expo.stop();
    }
    // Longer than T: two notices and one retry of the server's outbox (5 s) are awaited.
  }, 3 * T);
});
