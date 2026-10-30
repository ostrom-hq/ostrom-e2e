// People and organizations of the scenarios, made through the server's own routes: e-mailed sign-in (the link is read
// from OSTROM_MAIL_DIR), the current organization, invitations. Each helper says why it cannot run yet, so a scenario
// that needs them stays skipped with the reason until the routes are on main.
import { type Caller, headersOf } from '../src/isolation.ts';
import { signInToken } from '../src/mail.ts';
import { isServed } from '../src/probe.ts';
import { MAIL_DIR, SERVER_URL } from './env.ts';

export const url = (path: string) => SERVER_URL.replace(/\/$/, '') + path;

/** Billing routes of the contract (`/v1/orgs/{orgId}/billing…`, outside `/api/v1`, JOURNAL 30/10 05:50). */
export const BILLING = (orgId: string) => `/v1/orgs/${orgId}/billing`;
export const STRIPE_WEBHOOK = '/v1/billing/stripe/webhook';

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

/** Why people and organizations cannot be made yet, or '' when they can. */
export async function orgsUnavailable(): Promise<string> {
  if (SERVER_URL === '') return 'no server';
  if (MAIL_DIR === '') return 'no OSTROM_E2E_MAIL_DIR';
  const needed: [string, string][] = [['POST', '/api/v1/auth/email'], ['POST', '/api/v1/auth/email/verify'], ['GET', '/api/v1/org'], ['POST', '/api/v1/members/invites']];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

/** Signs `email` in by its e-mailed link: a session cookie and its CSRF token. */
export async function signIn(email: string): Promise<Person> {
  const asked = await call({}, 'POST', '/api/v1/auth/email', { email });
  if (asked.status >= 300) throw new Error(`POST /api/v1/auth/email → ${asked.status} ${JSON.stringify(asked.body)}`);
  const token = signInToken(MAIL_DIR, email);
  if (!token) throw new Error(`no sign-in mail for ${email} in ${MAIL_DIR}`);
  const r = await fetch(url('/api/v1/auth/email/verify'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  const body = (await r.json()) as { csrfToken?: string };
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (r.status !== 200 || !cookie || !body.csrfToken) throw new Error(`verify → ${r.status} ${JSON.stringify(body)}`);
  return { email, caller: { cookie, csrf: body.csrfToken } };
}

/** The organization of a person (`GET /api/v1/org`). */
export async function orgOf(p: Person): Promise<{ id: string } & Record<string, unknown>> {
  const r = await call(p.caller, 'GET', '/api/v1/org');
  if (r.status !== 200 || typeof r.body['id'] !== 'string') throw new Error(`GET /api/v1/org → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string } & Record<string, unknown>;
}

/** A fresh e-mail address per run, so that scenarios never share a person. */
export const email = (who: string) => `${who}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@e2e.ostrom.test`;
