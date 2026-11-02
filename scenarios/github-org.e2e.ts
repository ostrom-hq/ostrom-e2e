// SPDX-License-Identifier: Apache-2.0
// E2E-GHORG: `GET /api/v1/github/app/install/start?org=<id|slug>`, as decided on 30/10 (JOURNAL 12:55, coded in
// ostrom-server#44). Only an owner or an admin of the organization starts its install; a member, a stranger and an
// unknown slug get the same 403, so the answer never tells whether an organization exists. The start is tied to the
// browser session: without one it is 401. The callback side (stolen installation, another session's state, replay) is
// E2E-GH-INSTALL of e2e#23, against the bench's fake GitHub; the start needs no GitHub call.
import { describe, expect, it } from 'vitest';
import { type Caller, headersOf } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from './env.ts';
import { call, email, invite, join, orgOf, orgsUnavailable, profileOf, signIn, url } from './org.ts';

const START = '/api/v1/github/app/install/start';
const T = 90_000;

async function unavailable(): Promise<string> {
  const orgs = await orgsUnavailable();
  if (orgs !== '') return orgs;
  if (!(await isServed(SERVER_URL, START))) return `not served yet: GET ${START}, ostrom-server#44`;
  // The start resolves the caller's organization first (`actorOf`, GitHubRoutes.kt): a person needs the current org of
  // ostrom-server#64, else every start, the owner's too, is 403 "This credential belongs to no organization".
  if (!(await isServed(SERVER_URL, '/api/v1/me/organizations'))) return 'needs the current org of a person, ostrom-server#64';
  // `actorOf` goes through `GateActorResolver`, only `NoGateActors` on main until `LaunchGateActors` of #84.
  return (await isServed(SERVER_URL, '/api/v1/launches', 'POST')) ? '' : 'needs a real GateActorResolver, ostrom-server#84';
}
const WHY = await unavailable();

/** GET without following the redirect to GitHub. */
async function start(caller: Caller, org?: string) {
  const query = org === undefined ? '' : `?org=${encodeURIComponent(org)}`;
  const r = await fetch(url(START + query), { headers: headersOf(caller, 'GET', false), redirect: 'manual' });
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A redirect has no JSON body.
  }
  return { status: r.status, location: r.headers.get('location') ?? '', body };
}

/** The refusal, without what changes from one request to the next (trace and request ids). */
function refusal(body: Record<string, unknown>) {
  const error = (body['error'] ?? {}) as Record<string, unknown>;
  return { type: error['type'], message: error['message'] };
}

describe.skipIf(WHY !== '')(`E2E-GHORG: who starts the GitHub install of an organization${WHY ? ` (skipped: ${WHY})` : ''}`, () => {
  it('E2E-GHORG-001 the owner starts the install of their org by id and by slug: a redirect to GitHub with a state', async (ctx) => {
    const owner = await signIn(email('gh-org-001'));
    const org = await orgOf(owner);
    const byId = await start(owner.caller, org.id);
    if (byId.status === 503) ctx.skip(); // no GitHub App configured on this bench (its settings come with e2e#23)
    expect(byId.status, JSON.stringify(byId.body)).toBe(302);
    expect(new URL(byId.location).searchParams.get('state')).toBeTruthy();
    const bySlug = await start(owner.caller, org.slug);
    expect(bySlug.status).toBe(302);
    // Each start has its own state: one use, bound to this session.
    expect(new URL(bySlug.location).searchParams.get('state')).not.toBe(new URL(byId.location).searchParams.get('state'));
  }, T);

  it('E2E-GHORG-002 a member, a stranger and an unknown slug get the same 403; no session gets 401', async (ctx) => {
    const owner = await signIn(email('gh-org-002'));
    const org = await orgOf(owner);
    if ((await start(owner.caller, org.id)).status === 503) ctx.skip();
    const memberEmail = email('gh-org-002-member');
    expect((await invite(owner, org.id, [memberEmail], 'member')).status).toBeLessThan(300);
    const { person: member, accepted } = await join(memberEmail);
    expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
    // A stranger is someone of another organization: a person in none is refused before the org is even read.
    const stranger = await signIn(email('gh-org-002-stranger'));
    await orgOf(stranger);

    const asMember = await start(member.caller, org.id);
    const asStranger = await start(stranger.caller, org.id);
    const unknown = await start(stranger.caller, `no-such-org-${Date.now().toString(36)}`);
    for (const r of [asMember, asStranger, unknown]) {
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.location).toBe('');
    }
    // Same answer for all three: nothing tells a member from a stranger, nor an existing org from none.
    expect(refusal(asMember.body)).toEqual(refusal(asStranger.body));
    expect(refusal(unknown.body)).toEqual(refusal(asStranger.body));

    const anonymous = await start({}, org.id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.location).toBe('');
  }, T);

  it('E2E-GHORG-003 an admin starts it; the same person demoted to member is refused', async (ctx) => {
    const owner = await signIn(email('gh-org-003'));
    const org = await orgOf(owner);
    if ((await start(owner.caller, org.id)).status === 503) ctx.skip();
    const adminEmail = email('gh-org-003-admin');
    expect((await invite(owner, org.id, [adminEmail], 'admin')).status).toBeLessThan(300);
    const { person: admin } = await join(adminEmail);
    expect((await start(admin.caller, org.id)).status).toBe(302);

    // Members are addressed by login (`updateOrgMember`, PATCH /api/v1/orgs/{org}/members/{login}).
    const { login } = await profileOf(admin.caller);
    const demoted = await call(owner.caller, 'PATCH', `/api/v1/orgs/${org.id}/members/${encodeURIComponent(login)}`, { role: 'member' });
    expect(demoted.status, JSON.stringify(demoted.body)).toBeLessThan(300);
    expect((await start(admin.caller, org.id)).status).toBe(403);
  }, T);
});
