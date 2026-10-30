// SPDX-License-Identifier: Apache-2.0
// People and organizations of the scenarios, made through the server's own routes: e-mailed sign-in (the link is read
// from OSTROM_MAIL_DIR), the current organization, invitations. Each helper says why it cannot run yet, so a scenario
// that needs them stays skipped with the reason until the routes are on main.
import { type Caller, headersOf } from '../src/isolation.ts';
import { invitationToken, signInToken } from '../src/mail.ts';
import { firstServed, isServed } from '../src/probe.ts';
import { CONSOLE_ORIGIN, MAIL_DIR, SERVER_URL } from './env.ts';

export const url = (path: string) => SERVER_URL.replace(/\/$/, '') + path;

// Billing routes: under `/api/v1/orgs/{orgId}/billing` (decision of 30/10 05:55), the Stripe webhook outside the prefix
// at `/webhooks/stripe`. ostrom-server#15 shipped the webhook at `/api/v1/billing/stripe/webhook` (JOURNAL 06:50 QA),
// and the first contract had `/v1/…`: every candidate is probed, so the bench follows whichever the server serves.
const SAMPLE_ORG = '00000000-0000-4000-8000-000000000000';
let billingBase = '/api/v1/orgs';
if (SERVER_URL !== '' && !(await isServed(SERVER_URL, `${billingBase}/${SAMPLE_ORG}/billing`)) && (await isServed(SERVER_URL, `/v1/orgs/${SAMPLE_ORG}/billing`))) {
  billingBase = '/v1/orgs';
}
export const BILLING = (orgId: string) => `${billingBase}/${orgId}/billing`;
export const STRIPE_WEBHOOK = (SERVER_URL !== '' && (await firstServed(SERVER_URL, ['/webhooks/stripe', '/api/v1/billing/stripe/webhook', '/v1/billing/stripe/webhook'], 'POST'))) || '/webhooks/stripe';

export interface Person {
  readonly email: string;
  readonly caller: Caller;
}

/** Calls the server as `caller`; the body is parsed as JSON when there is one. */
export async function call(caller: Caller, method: string, path: string, body?: unknown) {
  const json = body !== undefined;
  const r = await fetch(url(path), { method, headers: headersOf(caller, method, json), ...(json ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: r.status, headers: r.headers, body: parsed as Record<string, unknown> };
}

/** Why people and organizations cannot be made yet, or '' when they can (routes of ostrom-server#51). */
export async function orgsUnavailable(): Promise<string> {
  if (SERVER_URL === '') return 'no server';
  if (MAIL_DIR === '') return 'no OSTROM_E2E_MAIL_DIR';
  const needed: [string, string][] = [
    ['POST', '/api/v1/auth/email'],
    ['POST', '/api/v1/auth/email/verify'],
    ['GET', '/api/v1/orgs'],
    ['POST', `/api/v1/orgs/${SAMPLE_ORG}/members/invites`],
    ['POST', '/api/v1/invitations/accept'],
  ];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path.replace(SAMPLE_ORG, '{org}')}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

/**
 * A client address of its own (TEST-NET-free private range), sent as `X-Forwarded-For` to a server that trusts
 * 127.0.0.1 as its proxy: the per-address sign-in limits (10 links per 15 min) then count people, not the bench.
 */
export const address = () => `10.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 250)}`;

/** The sign-in link mailed to `email`: asks for it, then reads the token from OSTROM_MAIL_DIR. */
export async function mailedToken(email: string, from = address()): Promise<string> {
  const asked = await call({ from }, 'POST', '/api/v1/auth/email', { email });
  if (asked.status >= 300) throw new Error(`POST /api/v1/auth/email → ${asked.status} ${JSON.stringify(asked.body)}`);
  const token = signInToken(MAIL_DIR, email, '/auth/email');
  if (!token) throw new Error(`no sign-in mail for ${email} in ${MAIL_DIR}`);
  return token;
}

/** The cookies a response sets, as a `Cookie` header (name=value pairs). */
export const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

/** Signs `email` in by its e-mailed link: a session cookie, its CSRF token, and the console's `Origin` to write. */
export async function signIn(email: string): Promise<Person> {
  const from = address();
  const token = await mailedToken(email, from);
  const r = await fetch(url('/api/v1/auth/email/verify'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ token }) });
  const body = (await r.json()) as { csrfToken?: string };
  const cookie = cookiesOf(r);
  if (r.status !== 200 || !cookie || !body.csrfToken) throw new Error(`verify → ${r.status} ${JSON.stringify(body)}`);
  return { email, caller: { cookie, csrf: body.csrfToken, from, origin: CONSOLE_ORIGIN } };
}

export type Org = { id: string; slug: string; name: string; role: string } & Record<string, unknown>;

/** The person's first organization (`GET /api/v1/orgs`); a person with none creates one (`POST /api/v1/orgs`). */
export async function orgOf(p: Person): Promise<Org> {
  const mine = await call(p.caller, 'GET', '/api/v1/orgs');
  if (mine.status !== 200) throw new Error(`GET /api/v1/orgs → ${mine.status} ${JSON.stringify(mine.body)}`);
  const first = (mine.body['items'] as Org[] | undefined)?.[0];
  if (first) return first;
  const made = await call(p.caller, 'POST', '/api/v1/orgs', { name: `E2E ${p.email.split('@')[0]}` });
  if (made.status >= 300 || typeof made.body['id'] !== 'string') throw new Error(`POST /api/v1/orgs → ${made.status} ${JSON.stringify(made.body)}`);
  return made.body as Org;
}

/** `POST /api/v1/orgs/{org}/members/invites`: the raw answer (200 `{invited}`, or the refusal). */
export const invite = (owner: Person, orgId: string, emails: readonly string[], role = 'member') =>
  call(owner.caller, 'POST', `/api/v1/orgs/${orgId}/members/invites`, { invites: emails.map((e) => ({ email: e, role })) });

/** The invited person signs in and accepts the mailed invitation (`POST /api/v1/invitations/accept`). */
export async function join(invitedEmail: string): Promise<{ person: Person; accepted: Awaited<ReturnType<typeof call>> }> {
  const token = invitationToken(MAIL_DIR, invitedEmail);
  if (!token) throw new Error(`no invitation mail for ${invitedEmail} in ${MAIL_DIR}`);
  const person = await signIn(invitedEmail);
  return { person, accepted: await call(person.caller, 'POST', '/api/v1/invitations/accept', { token }) };
}

/** The members of an organization (`GET /api/v1/orgs/{org}/members`). */
export async function membersOf(p: Person, orgId: string): Promise<unknown[]> {
  const r = await call(p.caller, 'GET', `/api/v1/orgs/${orgId}/members`);
  if (r.status !== 200) throw new Error(`GET members → ${r.status} ${JSON.stringify(r.body)}`);
  return (Array.isArray(r.body) ? r.body : (r.body['items'] ?? r.body['members'])) as unknown[];
}

/** A fresh e-mail address per run, so that scenarios never share a person. */
export const email = (who: string) => `${who}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@e2e.ostrom.test`;
