// SPDX-License-Identifier: Apache-2.0
// E2E-ISO : isolation between organizations (routes of ostrom-server#51 and of every module). Organization B's owner
// calls every route with A's ids: nothing succeeds, nothing crashes, nothing of A comes back, A's state is the same
// afterwards (ISO-001). And what the console reads for B never carries anything of A (ISO-002). A route that is not
// served yet is listed and left out; a resource A cannot create yet is listed too, so the report says what was proved.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type RouteCase, intrusions } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from './env.ts';
import { BILLING, type Org, type Person, call, email, invite, orgOf, orgsUnavailable, profileOf, signIn } from './org.ts';

const ORGS = await orgsUnavailable();

/** The organization routes, with A's ids: the organization, its members, invitations and billing. */
function orgRoutes(org: Org, ownerLogin: string): RouteCase[] {
  const o = `/api/v1/orgs/${org.id}`;
  const plan = { plan: 'team', interval: 'month' };
  return [
    { name: 'GET org', method: 'GET', path: o },
    { name: 'GET org by slug', method: 'GET', path: `/api/v1/orgs/${org.slug}` },
    { name: 'PATCH org', method: 'PATCH', path: o, body: { name: 'taken by B' } },
    { name: 'DELETE org', method: 'DELETE', path: o, body: { confirm: org.slug } },
    { name: 'POST org/transfer', method: 'POST', path: `${o}/transfer`, body: { login: ownerLogin } },
    { name: 'POST org/leave', method: 'POST', path: `${o}/leave` },
    { name: 'GET members', method: 'GET', path: `${o}/members` },
    { name: 'GET members/{owner}', method: 'GET', path: `${o}/members/${encodeURIComponent(ownerLogin)}` },
    { name: 'PATCH members/{owner}', method: 'PATCH', path: `${o}/members/${encodeURIComponent(ownerLogin)}`, body: { role: 'member' } },
    { name: 'DELETE members/{owner}', method: 'DELETE', path: `${o}/members/${encodeURIComponent(ownerLogin)}` },
    { name: 'POST members/invites', method: 'POST', path: `${o}/members/invites`, body: { invites: [{ email: email('iso-intruder'), role: 'admin' }] } },
    { name: 'GET invitations', method: 'GET', path: `${o}/invitations` },
    { name: 'POST invitations/links', method: 'POST', path: `${o}/invitations/links`, body: { role: 'admin', maxUses: 1 } },
    { name: 'DELETE invitations/{id}', method: 'DELETE', path: `${o}/invitations/${randomUUID()}` },
    { name: 'GET billing', method: 'GET', path: BILLING(org.id) },
    { name: 'POST billing/checkout', method: 'POST', path: `${BILLING(org.id)}/checkout`, body: plan },
    { name: 'POST billing/portal', method: 'POST', path: `${BILLING(org.id)}/portal` },
    { name: 'POST billing/plan', method: 'POST', path: `${BILLING(org.id)}/plan`, body: plan },
    { name: 'POST billing/cancel', method: 'POST', path: `${BILLING(org.id)}/cancel` },
    { name: 'POST billing/resume', method: 'POST', path: `${BILLING(org.id)}/resume` },
    { name: 'GET billing/invoices', method: 'GET', path: `${BILLING(org.id)}/invoices` },
  ];
}

/**
 * The resources of the other modules: sessions, artifacts, MCP secrets, automations, waits, budgets, receipts,
 * approvals, accounts, usage. Each is created by A when A can (the id then enters the table: read, write, delete by
 * B); the list routes are always in it (B's list must hold nothing of A's).
 */
const RESOURCES: { name: string; root: string; create?: unknown }[] = [
  { name: 'cloud sessions', root: '/api/v1/cloud/sessions', create: { repo: 'acme/iso', agent: 'claude' } },
  { name: 'artifacts', root: '/api/v1/artifacts', create: { title: 'iso-a artifact', access: 'team', files: [{ path: 'index.md', content: '# iso' }] } },
  { name: 'secrets (MCP)', root: '/api/v1/secrets', create: { name: 'ISO_A_SECRET', value: 'iso-a-value' } },
  { name: 'mcp servers', root: '/api/v1/mcp' },
  { name: 'automations', root: '/api/v1/automations', create: { name: 'iso-a automation', trigger: { kind: 'schedule', cron: '0 3 * * *' }, steps: [] } },
  { name: 'waits', root: '/api/v1/waits' },
  { name: 'budgets', root: '/api/v1/budgets' },
  { name: 'receipts', root: '/api/v1/receipts' },
  { name: 'approvals', root: '/api/v1/approvals' },
  { name: 'accounts', root: '/api/v1/accounts' },
  { name: 'usage', root: '/api/v1/usage' },
];

interface Side {
  readonly person: Person;
  readonly org: Org;
  readonly login: string;
}

async function side(who: string): Promise<Side> {
  const person = await signIn(email(who));
  const org = await orgOf(person);
  return { person, org, login: (await profileOf(person.caller)).login };
}

/** A's own resources, made through the API: the routes B then calls with their ids, and what A could not make. */
async function resourcesOf(a: Side): Promise<{ routes: RouteCase[]; notCreated: string[]; ids: string[] }> {
  const routes: RouteCase[] = [];
  const notCreated: string[] = [];
  const ids: string[] = [];
  for (const r of RESOURCES) {
    if (!(await isServed(SERVER_URL, r.root))) {
      notCreated.push(`${r.name} (not served)`);
      continue;
    }
    routes.push({ name: `GET ${r.root} (list)`, method: 'GET', path: r.root, ownScope: true });
    if (!r.create) continue;
    const made = await call(a.person.caller, 'POST', r.root, r.create);
    const id = made.body?.['id'] ?? (made.body?.['artifact'] as Record<string, unknown> | undefined)?.['id'];
    if (made.status >= 300 || typeof id !== 'string') {
      notCreated.push(`${r.name} (A's POST → ${made.status} ${String((made.body?.['error'] as { type?: string } | undefined)?.type ?? '')})`);
      continue;
    }
    ids.push(id);
    routes.push(
      { name: `GET ${r.root}/{A}`, method: 'GET', path: `${r.root}/${id}` },
      { name: `PATCH ${r.root}/{A}`, method: 'PATCH', path: `${r.root}/${id}`, body: { name: 'taken by B', title: 'taken by B' } },
      { name: `DELETE ${r.root}/{A}`, method: 'DELETE', path: `${r.root}/${id}` },
    );
  }
  return { routes, notCreated, ids };
}

/** What the console reads for a person: their organizations and everything listed in their organization. */
function consoleReads(b: Side): string[] {
  const o = `/api/v1/orgs/${b.org.id}`;
  return [
    '/api/v1/auth/me',
    '/api/v1/auth/me/account',
    '/api/v1/auth/me/audit',
    '/api/v1/tokens',
    '/api/v1/orgs',
    o,
    `${o}/members`,
    `${o}/invitations`,
    BILLING(b.org.id),
    `${BILLING(b.org.id)}/invoices`,
    ...RESOURCES.map((r) => r.root),
  ];
}

describe.skipIf(ORGS !== '')(`E2E-ISO: organizations do not see each other${ORGS ? ` (${ORGS})` : ''}`, () => {
  it('E2E-ISO-001 B reads, writes and lists nothing of A, on every served route of every module', async () => {
    const a = await side('iso-a');
    const b = await side('iso-b');
    expect(b.org.id).not.toBe(a.org.id);
    // A's organization has someone invited, so that its members and invitations are not empty.
    expect((await invite(a.person, a.org.id, [email('iso-a-guest')])).status).toBe(200);
    const made = await resourcesOf(a);
    const all = [...orgRoutes(a.org, a.login), ...made.routes];
    const served: RouteCase[] = [];
    const missing: RouteCase[] = [];
    for (const r of all) ((await isServed(SERVER_URL, r.path, r.method)) ? served : missing).push(r);
    console.info(
      `E2E-ISO-001: ${served.length} routes checked; not served: ${missing.map((r) => r.name).join(', ') || 'none'}; ` +
        `A could not create: ${made.notCreated.join(', ') || 'nothing'}`,
    );
    const reads = served.filter((r) => r.method === 'GET' && !r.ownScope);
    const before = await Promise.all(reads.map((r) => call(a.person.caller, 'GET', r.path)));
    // Markers of A: ids, slug, owner's e-mail and login, and the name when it differs from B's.
    const markers = [a.org.id, a.org.slug, a.person.email, a.login, ...made.ids, ...(a.org.name !== b.org.name ? [a.org.name] : [])];
    expect(await intrusions(SERVER_URL, served, b.person.caller, markers)).toEqual([]);
    const after = await Promise.all(reads.map((r) => call(a.person.caller, 'GET', r.path)));
    expect(after.map((r) => [r.status, r.body])).toEqual(before.map((r) => [r.status, r.body]));
  });

  it('E2E-ISO-002 what the console reads for B carries nothing of A (ids, names, people, tokens)', async () => {
    const a = await side('iso-console-a');
    const b = await side('iso-console-b');
    const marker = `isomark${randomUUID().slice(0, 8)}`;
    // A leaves traces everywhere a console page could leak them: a renamed organization, an invited person, a token.
    expect((await call(a.person.caller, 'PATCH', `/api/v1/orgs/${a.org.id}`, { name: `A ${marker}` })).status).toBe(200);
    const guest = email(`${marker}-guest`);
    expect((await invite(a.person, a.org.id, [guest])).status).toBe(200);
    expect((await call(a.person.caller, 'POST', '/api/v1/tokens', { name: `token ${marker}`, scopes: ['profile:read'], expiresInDays: 1 })).status).toBe(201);
    const made = await resourcesOf(a);
    const markers = [marker, a.org.id, a.org.slug, a.person.email, a.login, guest, ...made.ids];
    const leaks: string[] = [];
    const read: string[] = [];
    for (const path of consoleReads(b)) {
      if (!(await isServed(SERVER_URL, path))) continue;
      const r = await call(b.person.caller, 'GET', path);
      read.push(`${path} ${r.status}`);
      expect(r.status, path).toBeLessThan(500);
      const text = JSON.stringify(r.body ?? '');
      for (const m of markers) if (text.includes(m)) leaks.push(`${path} carries ${m === marker ? 'the marker' : m}`);
    }
    console.info(`E2E-ISO-002: ${read.join(' · ')}`);
    expect(read.length).toBeGreaterThan(5);
    expect(leaks).toEqual([]);
  });
});
