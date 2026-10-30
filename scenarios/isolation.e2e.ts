// SPDX-License-Identifier: Apache-2.0
// E2E-ISO : isolation between organizations. Organization B's owner calls every organization route with A's ids:
// nothing succeeds, nothing crashes, nothing of A comes back, and A's state is the same afterwards. The route table
// grows with the server: a route that is not served yet is left out (and listed), it never fails the scenario.
import { describe, expect, it } from 'vitest';
import { type RouteCase, intrusions } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from './env.ts';
import { BILLING, call, email, orgOf, orgsUnavailable, signIn } from './org.ts';

const ORGS = await orgsUnavailable();

/** Every organization route of the contract the server may serve, with A's ids. */
function routesOf(orgId: string, ownerEmail: string): RouteCase[] {
  const plan = { plan: 'team', interval: 'month' };
  return [
    { name: 'GET billing', method: 'GET', path: BILLING(orgId) },
    { name: 'POST billing/checkout', method: 'POST', path: `${BILLING(orgId)}/checkout`, body: plan },
    { name: 'POST billing/portal', method: 'POST', path: `${BILLING(orgId)}/portal` },
    { name: 'POST billing/plan', method: 'POST', path: `${BILLING(orgId)}/plan`, body: plan },
    { name: 'POST billing/cancel', method: 'POST', path: `${BILLING(orgId)}/cancel` },
    { name: 'POST billing/resume', method: 'POST', path: `${BILLING(orgId)}/resume` },
    { name: 'GET billing/invoices', method: 'GET', path: `${BILLING(orgId)}/invoices` },
    // Scoped by the credential: B gets its own organization, never A's.
    { name: 'GET org', method: 'GET', path: '/api/v1/org', ownScope: true },
    { name: 'GET members', method: 'GET', path: '/api/v1/members', ownScope: true },
    { name: 'GET members/{A owner}', method: 'GET', path: `/api/v1/members/${encodeURIComponent(ownerEmail)}` },
    { name: 'PATCH members/{A owner}', method: 'PATCH', path: `/api/v1/members/${encodeURIComponent(ownerEmail)}`, body: { role: 'member' } },
    { name: 'GET approvals', method: 'GET', path: '/api/v1/approvals', ownScope: true },
    { name: 'GET receipts', method: 'GET', path: '/api/v1/receipts', ownScope: true },
    { name: 'GET sessions', method: 'GET', path: '/api/v1/sessions', ownScope: true },
    { name: 'GET settings', method: 'GET', path: '/api/v1/settings', ownScope: true },
  ];
}

describe.skipIf(ORGS !== '')(`E2E-ISO: organizations do not see each other${ORGS ? ` (${ORGS})` : ''}`, () => {
  it('E2E-ISO-001 B reads and writes nothing of A, on every served organization route', async () => {
    const a = await signIn(email('iso-a'));
    const b = await signIn(email('iso-b'));
    const orgA = await orgOf(a);
    const orgB = await orgOf(b);
    expect(orgB.id).not.toBe(orgA.id);
    const all = routesOf(orgA.id, a.email);
    const served: RouteCase[] = [];
    const missing: RouteCase[] = [];
    for (const r of all) ((await isServed(SERVER_URL, r.path, r.method)) ? served : missing).push(r);
    console.info(`E2E-ISO-001: ${served.length} routes checked; not served yet: ${missing.map((r) => r.name).join(', ') || 'none'}`);
    const before = await Promise.all(served.filter((r) => r.method === 'GET').map((r) => call(a.caller, 'GET', r.path)));
    // A's name is a marker only when it differs from B's (two new organizations may get the same default name).
    const name = orgA['name'];
    const markers = [orgA.id, a.email, ...(typeof name === 'string' && name !== orgB['name'] ? [name] : [])];
    expect(await intrusions(SERVER_URL, served, b.caller, markers)).toEqual([]);
    const after = await Promise.all(served.filter((r) => r.method === 'GET').map((r) => call(a.caller, 'GET', r.path)));
    expect(after.map((r) => [r.status, r.body])).toEqual(before.map((r) => [r.status, r.body]));
  });
});
