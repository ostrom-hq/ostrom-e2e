// SPDX-License-Identifier: Apache-2.0
// E2E-AUTH : the server's identity (ostrom-server#10) from outside, on the server image: sign-in by e-mailed link and
// by GitHub (the bench plays GitHub, src/fake-github.ts), the CLI's device login, personal tokens, sign-out and their
// revocation, refusals without a credential, and the step-up of a yes. Each part switches itself on when its routes
// are served (src/probe.ts); routes and bodies are those of ostrom-server main (IdentityApi.kt, contract 0.1.140).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/fake-github.ts';
import { isServed } from '../src/probe.ts';
import { DATABASE_ADMIN_URL, FAKE_GITHUB_PORT, MAIL_DIR, SERVER_URL } from './env.ts';
import { adminSql } from './lib.ts';
import { address, call, cookiesOf, email, invite, join, mailedLink, orgOf, profileOf, signIn, url, verifyLink } from './org.ts';

const served = async (method: string, path: string) => SERVER_URL !== '' && (await isServed(SERVER_URL, path, method));
const EMAIL_SIGN_IN = MAIL_DIR !== '' && (await served('POST', '/api/v1/auth/email')) && (await served('POST', '/api/v1/auth/email/verify'));
const DEVICE = await served('POST', '/api/v1/auth/device');
const TOKENS = await served('POST', '/api/v1/tokens');
const ME = await served('GET', '/api/v1/auth/me');
const providers = SERVER_URL === '' || !(await served('GET', '/api/v1/auth/providers')) ? [] : ((await call({}, 'GET', '/api/v1/auth/providers')).body['methods'] as string[] | undefined) ?? [];
const GITHUB = EMAIL_SIGN_IN && FAKE_GITHUB_PORT > 0 && providers.includes('github');
const UNAUTHORIZED = { type: 'unauthorized' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const me = (caller: Parameters<typeof call>[0]) => call(caller, 'GET', '/api/v1/auth/me');

describe.skipIf(!EMAIL_SIGN_IN || !ME)('E2E-AUTH: sign-in by e-mailed link', () => {
  it('E2E-AUTH-001 the mailed link signs in once: an HttpOnly session cookie, a CSRF token, the profile; a reused or forged link is refused', async () => {
    const who = email('auth-link');
    const from = address();
    const { token, browser } = await mailedLink(who, from);
    expect(browser, 'the asking browser keeps a nonce (ostrom-server#176)').toMatch(/ostrom_email_link=./);
    const verify = (t: string) => verifyLink(t, from, browser);
    // The valid link presented without the asking browser's cookie (forwarded, read on another device): refused, and not
    // used up (ostrom-server#176, web audit 2 M4).
    const elsewhere = await verifyLink(token, from);
    expect(elsewhere.status).toBe(403);
    expect(((await elsewhere.json()) as { error?: { type?: string } }).error?.type).toBe('email_link_other_browser');
    expect(elsewhere.headers.getSetCookie().filter((c) => /ostrom_session=[^;]/.test(c))).toEqual([]);
    const first = await verify(token);
    expect(first.status).toBe(200);
    const signed = (await first.json()) as { redirect: string; csrfToken: string };
    expect(signed.csrfToken).toMatch(/.{16,}/);
    expect(signed.redirect.startsWith('/')).toBe(true);
    const session = first.headers.getSetCookie().find((c) => /^(__Host-)?ostrom_session=/.test(c)) ?? '';
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=(Lax|Strict)/i);
    expect(session).toMatch(/Path=\//i);
    const profile = await profileOf({ cookie: cookiesOf(first), from });
    expect(profile.status).toBe(200);
    expect(profile.primaryEmail).toBe(who);
    // The same link a second time, then a token nobody was sent: no session either time.
    for (const t of [token, randomUUID().replaceAll('-', '')]) {
      const again = await verify(t);
      expect(again.status, `verify(${t === token ? 'reused' : 'forged'})`).toBeGreaterThanOrEqual(400);
      expect(again.status).toBeLessThan(500);
      expect(again.headers.getSetCookie().filter((c) => /ostrom_session=[^;]/.test(c))).toEqual([]);
    }
  });
});

describe.skipIf(!GITHUB)(`E2E-AUTH: sign-in with GitHub (fake GitHub on :${FAKE_GITHUB_PORT})${GITHUB ? '' : ` (providers: ${providers.join(', ') || 'none'})`}`, () => {
  const gh = new FakeGitHub();
  beforeAll(async () => {
    await gh.start(FAKE_GITHUB_PORT);
  });
  afterAll(async () => {
    await gh.stop();
  });

  const start = async (from: string) => {
    const r = await fetch(url('/api/v1/auth/github/start?redirect=%2Fsettings'), { redirect: 'manual', headers: { 'x-forwarded-for': from } });
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location') ?? '');
    return { to, stateCookie: cookiesOf(r) };
  };
  const callback = (redirectUri: string, query: Record<string, string>, cookie: string, from: string) => {
    const back = new URL(redirectUri);
    for (const [k, v] of Object.entries(query)) back.searchParams.set(k, v);
    return fetch(url(back.pathname + back.search), { redirect: 'manual', headers: { cookie, 'x-forwarded-for': from } });
  };

  it('E2E-AUTH-002 GitHub OAuth with PKCE and a state bound to the browser: signed in as the GitHub login; a wrong state, a reused code or a denial sign no one in', async () => {
    const from = address();
    const login = `gh-${Date.now().toString(36)}`;
    const { to, stateCookie } = await start(from);
    expect(`${to.origin}${to.pathname}`).toBe(`http://127.0.0.1:${FAKE_GITHUB_PORT}/login/oauth/authorize`);
    expect(to.searchParams.get('client_id')).toBe('Iv1.e2ebench');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('scope')).toContain('user:email');
    const state = to.searchParams.get('state') ?? '';
    const redirectUri = to.searchParams.get('redirect_uri') ?? '';
    expect(state).toMatch(/.{16,}/);
    expect(redirectUri).toMatch(/\/api\/v1\/auth\/github\/callback$/);
    expect(stateCookie).toMatch(/ostrom_oauth_state=./);

    // GitHub sends the browser back with a one-time code; the server exchanges it with the verifier of the start.
    const code = gh.oauthCode(login, `${login}@e2e.ostrom.test`);
    const back = await callback(redirectUri, { code, state }, stateCookie, from);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('http://127.0.0.1:4600/settings');
    const exchange = gh.requests.find((r) => r.path === '/login/oauth/access_token');
    expect(exchange?.body).toMatchObject({ code, client_id: 'Iv1.e2ebench', client_secret: 'e2e-bench-fake-github' });
    expect(String((exchange?.body as Record<string, unknown>)['code_verifier'] ?? '')).toMatch(/.{32,}/);
    const profile = await profileOf({ cookie: cookiesOf(back), from });
    expect(profile.status).toBe(200);
    expect({ login: profile.login, primaryEmail: profile.primaryEmail }).toEqual({ login, primaryEmail: `${login}@e2e.ostrom.test` });

    // Refusals land on the console's login page with an error code, and set no session.
    const refusals: [string, Record<string, string>, (s: string) => string][] = [
      ['state of another browser', { code: gh.oauthCode(login, `${login}@e2e.ostrom.test`) }, () => 'forged-state-value-0123456789'],
      ['code already used', { code }, (s) => s],
      ['denied on GitHub', { error: 'access_denied' }, (s) => s],
    ];
    for (const [why, query, stateOf] of refusals) {
      const again = await start(from);
      const s = again.to.searchParams.get('state') ?? '';
      const r = await callback(redirectUri, { ...query, state: stateOf(s) }, again.stateCookie, from);
      expect(r.status, why).toBe(302);
      expect(r.headers.get('location') ?? '', why).toMatch(/^http:\/\/127\.0\.0\.1:4600\/login\?error=[a-z_]+$/);
      expect(r.headers.getSetCookie().filter((c) => /ostrom_session=[^;]/.test(c)), why).toEqual([]);
    }
  });
});

describe.skipIf(!EMAIL_SIGN_IN || !DEVICE || !ME)('E2E-AUTH: device login of the CLI (RFC 8628)', () => {
  // The contract's poll, served since ostrom-server#62: 428 while pending, 400 `access_denied` / `expired_token` /
  // `slow_down`, 200 `AuthToken {token, login, scopes}` once. The older 200 `{status}` is still read, and then fails
  // the `http` checks below.
  type Poll = { http: number; status: string; accessToken?: string | undefined; scopes?: string[] | undefined; login?: string | undefined };
  const poll = async (deviceCode: string, from: string): Promise<Poll> => {
    const r = await call({ from }, 'POST', '/api/v1/auth/device/token', { deviceCode });
    const b = r.body ?? {};
    if (r.status === 428) return { http: 428, status: 'pending' };
    if (r.status === 400) {
      const type = (b['error'] as { type?: string } | undefined)?.type ?? '';
      return { http: 400, status: ({ access_denied: 'denied', expired_token: 'expired' } as Record<string, string>)[type] ?? type };
    }
    if (r.status === 200 && typeof b['token'] === 'string') return { http: 200, status: 'approved', accessToken: b['token'] as string, scopes: b['scopes'] as string[], login: b['login'] as string };
    return { http: r.status, status: String(b['status'] ?? r.status), accessToken: b['accessToken'] as string | undefined, scopes: b['scopes'] as string[] | undefined };
  };

  it('E2E-AUTH-003 a device code is approved in the signed-in browser, gives one CLI token (no answering scope), once; a denied code gives none', async () => {
    const person = await signIn(email('auth-device'));
    const from = address();
    const started = await call({ from }, 'POST', '/api/v1/auth/device', { clientName: 'ostrom e2e' });
    expect(started.status).toBe(200);
    const { deviceCode, userCode, verificationUri, interval } = started.body as { deviceCode: string; userCode: string; verificationUri: string; interval: number };
    expect(verificationUri).toBe('http://127.0.0.1:4600/device');
    expect(await poll(deviceCode, from)).toMatchObject({ http: 428, status: 'pending' });
    // The console shows what is asking before the person answers.
    const shown = await call(person.caller, 'GET', `/api/v1/auth/device?userCode=${encodeURIComponent(userCode)}`);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ userCode, clientName: 'ostrom e2e' });
    expect((await call(person.caller, 'POST', '/api/v1/auth/device/answer', { userCode, approve: true })).status).toBe(204);
    await sleep(interval * 1000 + 500);
    const approved = await poll(deviceCode, from);
    expect(approved).toMatchObject({ http: 200, status: 'approved' });
    expect(approved.login).toBe((await profileOf(person.caller)).login);
    const cliToken = String(approved.accessToken);
    const scopes = approved.scopes ?? [];
    expect(scopes).toContain('profile:read');
    expect(scopes).not.toContain('gates:answer');
    expect(scopes).not.toContain('user:*');
    // The CLI token reads who it is (`/auth/me`), and names the person who approved it.
    expect((await me({ token: cliToken })).status).toBe(200);
    const profile = await profileOf({ token: cliToken });
    expect(profile.status).toBe(200);
    expect(profile.primaryEmail).toBe(person.email);
    // The device code was spent: polling again never gives a second token.
    await sleep(interval * 1000 + 500);
    expect((await poll(deviceCode, from)).status).not.toBe('approved');

    const other = await call({ from }, 'POST', '/api/v1/auth/device', { clientName: 'ostrom e2e denied' });
    const denied = other.body as { deviceCode: string; userCode: string };
    expect((await call(person.caller, 'POST', '/api/v1/auth/device/answer', { userCode: denied.userCode, approve: false })).status).toBe(204);
    await sleep(interval * 1000 + 500);
    const refused = await poll(denied.deviceCode, from);
    expect(refused).toMatchObject({ http: 400, status: 'denied' });
    expect(refused.accessToken ?? null).toBeNull();
  });
});

describe.skipIf(!EMAIL_SIGN_IN || !TOKENS || !ME)('E2E-AUTH: tokens and sign-out are revoked at once', () => {
  it('E2E-AUTH-004 a revoked or rotated token, a signed-out session and every session after « everywhere » are refused on the next call', async () => {
    const person = await signIn(email('auth-revoke'));
    const made = await call(person.caller, 'POST', '/api/v1/tokens', { name: 'e2e revoke', scopes: ['profile:read'], expiresInDays: 1 });
    expect(made.status).toBe(201);
    const id = (made.body['token'] as { id: string }).id;
    const secret = String(made.body['secret']);
    expect((await me({ token: secret })).status).toBe(200);
    // The list shows a hint, never the secret.
    const list = await call(person.caller, 'GET', '/api/v1/tokens');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect((await call(person.caller, 'DELETE', `/api/v1/tokens/${id}`)).status).toBe(204);
    const revoked = await me({ token: secret });
    expect(revoked.status).toBe(401);
    expect(revoked.body['error']).toMatchObject(UNAUTHORIZED);

    const second = await call(person.caller, 'POST', '/api/v1/tokens', { name: 'e2e rotate', scopes: ['profile:read'], expiresInDays: 1 });
    const rotated = await call(person.caller, 'POST', `/api/v1/tokens/${(second.body['token'] as { id: string }).id}/rotate`);
    expect(rotated.status).toBe(201);
    expect((await me({ token: String(second.body['secret']) })).status).toBe(401);
    expect((await me({ token: String(rotated.body['secret']) })).status).toBe(200);

    expect((await call(person.caller, 'POST', '/api/v1/auth/logout')).status).toBe(204);
    expect((await me(person.caller)).status).toBe(401);

    // Two sessions of the same person; « everywhere » from one ends both.
    const who = email('auth-everywhere');
    const one = await signIn(who);
    const two = await signIn(who);
    expect((await me(two.caller)).status).toBe(200);
    expect((await call(one.caller, 'POST', '/api/v1/auth/logout/everywhere')).status).toBe(204);
    expect((await me(one.caller)).status).toBe(401);
    expect((await me(two.caller)).status).toBe(401);
  });
});

describe.skipIf(!EMAIL_SIGN_IN || !TOKENS || !ME)('E2E-AUTH: no credential, no access', () => {
  it('E2E-AUTH-005 without a credential or with a bad one: 401 Bearer; a session write without its CSRF token, a token on a browser-only route and a token asking to answer gates are refused', async () => {
    const anonymous: [string, string][] = [
      ['GET', '/api/v1/auth/me'],
      ['GET', '/api/v1/auth/me/audit'],
      ['GET', '/api/v1/tokens'],
      ['POST', '/api/v1/tokens'],
      ['POST', '/api/v1/auth/logout'],
      ['POST', '/api/v1/auth/logout/everywhere'],
      ['GET', '/api/v1/auth/device?userCode=ABCD-EFGH'],
      ['POST', '/api/v1/auth/device/answer'],
      ['GET', '/api/v1/approvals'],
      ['POST', `/api/v1/approvals/${randomUUID()}/answer`],
    ];
    for (const caller of [{}, { token: 'ost_not_a_real_token' }, { cookie: 'ostrom_session=not-a-session' }]) {
      for (const [method, path] of anonymous) {
        if (!(await isServed(SERVER_URL, path.split('?')[0] as string, method))) continue;
        const body = method === 'POST' ? {} : undefined;
        const r = await call(caller, method, path, body);
        const label = `${method} ${path} as ${JSON.stringify(caller)}`;
        expect(r.status, label).toBe(401);
        expect(r.body['error'], label).toMatchObject(UNAUTHORIZED);
        expect(r.headers.get('www-authenticate') ?? '', label).toMatch(/^Bearer/);
      }
    }

    const person = await signIn(email('auth-refuse'));
    const before = await call(person.caller, 'GET', '/api/v1/tokens');
    // The session cookie alone, without X-CSRF-Token, writes nothing.
    const noCsrf = await call({ cookie: person.caller.cookie ?? '' }, 'POST', '/api/v1/tokens', { name: 'csrf', scopes: ['profile:read'] });
    expect([401, 403]).toContain(noCsrf.status);
    // With its CSRF token but from another origin, or with none, the session writes nothing either (S2-08, #58).
    const { origin: _console, ...noOrigin } = person.caller;
    for (const caller of [{ ...noOrigin, origin: 'https://evil.example' }, noOrigin]) {
      const r = await call(caller, 'POST', '/api/v1/tokens', { name: 'origin', scopes: ['profile:read'] });
      expect([401, 403], `Origin ${'origin' in caller ? caller.origin : 'absent'}`).toContain(r.status);
    }
    expect(await call(person.caller, 'GET', '/api/v1/tokens')).toMatchObject({ status: 200, body: before.body });
    // A token never manages tokens (browser session only) and can never carry the right to answer a gate.
    const made = await call(person.caller, 'POST', '/api/v1/tokens', { name: 'e2e scoped', scopes: ['profile:read'], expiresInDays: 1 });
    const bearer = { token: String(made.body['secret']) };
    const browserOnly = await call(bearer, 'GET', '/api/v1/tokens');
    expect(browserOnly.status).toBe(403);
    expect(browserOnly.body['error']).toMatchObject({ type: 'forbidden' });
    for (const scope of ['gates:answer', 'user:*', 'agent:session']) {
      const r = await call(person.caller, 'POST', '/api/v1/tokens', { name: `e2e ${scope}`, scopes: [scope], expiresInDays: 1 });
      expect([400, 403], scope).toContain(r.status);
    }
  });
});

const ANSWER_SERVED = await served('POST', `/api/v1/approvals/${randomUUID()}/answer`);

describe.skipIf(!EMAIL_SIGN_IN || !TOKENS || !ANSWER_SERVED)('E2E-AUTH: a token never says yes', () => {
  it('E2E-AUTH-006 a CLI token never says yes: 403, whatever the approval (only a browser session answers, channel BROWSER)', async () => {
    const person = await signIn(email('auth-token-yes'));
    const made = await call(person.caller, 'POST', '/api/v1/tokens', { name: 'e2e no yes', scopes: ['profile:read'], expiresInDays: 1 });
    expect(made.status).toBe(201);
    const answer = await call({ token: String(made.body['secret']) }, 'POST', `/api/v1/approvals/${randomUUID()}/answer`, { answer: 'approve', shownDigest: 'sha256:00' });
    expect(answer.status).toBe(403);
    expect(['forbidden', 'step_up_required']).toContain((answer.body['error'] as { type?: string } | undefined)?.type);
  });
});

// AUTH-007 needs a real request to answer: an accepted workflow with a gate on pushes to main (ostrom-server#43), a
// question from the requester's token, and the approver's own request; then the approver's browser session is made
// older than 5 minutes in the database (the only way to age it without waiting), as the clock would.
// Markers: #43 serves the signed gate catalogue the hook reads, #64 the current org of a person (`/me/organizations`):
// before #64, `POST /api/v1/workflows` answers 403 « belongs to no organization » to a person (run 41052130887).
const STEP_UP_READY = EMAIL_SIGN_IN && TOKENS && ANSWER_SERVED && DATABASE_ADMIN_URL !== '' && (await served('POST', '/api/v1/workflows')) && (await served('POST', '/api/v1/gates')) && (await served('GET', '/api/v1/gates/catalog/signed')) && (await served('GET', '/api/v1/me/organizations')) && (await served('POST', '/api/v1/launches'));

/** Moves a person's browser sessions `minutes` into the past (their sign-in time, which the step-up reads). */
function ageSessions(userId: string, minutes: number): void {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error(`not a user id: ${userId}`);
  const sql = `UPDATE identity_web_sessions SET created_at = created_at - interval '${minutes} minutes' WHERE user_id = '${userId}'`;
  adminSql(sql);
}

describe.skipIf(!STEP_UP_READY)(`E2E-AUTH: step-up of a yes${STEP_UP_READY ? '' : ' (needs the workflows and signed gates of ostrom-server#43, the current org of #64, the actor resolver of #84, and the database URL)'}`, () => {
  it('E2E-AUTH-007 a browser session signed in more than 5 minutes ago cannot say yes (403 step_up_required); signed in again, it can', async () => {
    const requester = await signIn(email('stepup-dev'));
    const org = await orgOf(requester);
    const approverEmail = email('stepup-rev');
    expect((await invite(requester, org.id, [approverEmail], 'admin')).status).toBe(200);
    const { person: approver, accepted } = await join(approverEmail);
    expect(accepted.status).toBe(200);
    const who = await profileOf(approver.caller);
    const repo = `acme/stepup-${Date.now().toString(36)}`;
    const workflow = await call(requester.caller, 'POST', '/api/v1/workflows', {
      id: `stepup-${Date.now().toString(36)}`, name: 'step-up', domain: 'delivery', status: 'accepted', foundAt: new Date().toISOString(),
      nodes: [{ id: 'push-main', kind: 'gate', label: 'Push to main', approvers: [who.login], actions: [{ class: 'push-main', label: 'Push to the main branch', patterns: [], repos: [repo] }] }],
      edges: [],
    });
    expect(workflow.status, JSON.stringify(workflow.body)).toBeLessThan(300);
    const token = await call(requester.caller, 'POST', '/api/v1/tokens', { name: 'stepup asker', scopes: ['gates:ask', 'gates:read'], expiresInDays: 1 });
    const asker = { token: String(token.body['secret']) };
    const sha = randomUUID().replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const gate = await call(asker, 'POST', '/api/v1/gates', { repo, class: 'git.push', tool: 'Bash', command: 'git push origin main', push: { remote: 'origin', refs: [{ ref: 'refs/heads/main', sha }] } });
    expect(gate.status, JSON.stringify(gate.body)).toBeLessThan(300);
    const gateId = (gate.body['gate'] as { id?: string } | undefined)?.id;
    const pending = await call(approver.caller, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50');
    const mine = ((pending.body['items'] as { id: string; group?: string; shownDigest: string }[] | undefined) ?? []).find((a) => a.group === gateId);
    expect(mine, JSON.stringify({ gate: gate.body, pending: pending.body })).toBeDefined();
    const answer = (who: typeof approver) => call(who.caller, 'POST', `/api/v1/approvals/${mine?.id}/answer`, { answer: 'approve', shownDigest: mine?.shownDigest });

    ageSessions(who.id, 6);
    const stale = await answer(approver);
    expect(stale.status).toBe(403);
    expect(stale.body['error']).toMatchObject({ type: 'step_up_required' });

    const fresh = await signIn(approverEmail);
    const yes = await answer(fresh);
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    // ostrom-server#127: the answer carries the signed receipt, whose subject names the pushed commit in clear.
    const signed = yes.body['receipt'] as { signature?: unknown; subject?: { id?: unknown } } | undefined;
    expect(typeof signed?.signature, JSON.stringify(yes.body)).toBe('string');
    expect(signed?.subject?.id).toBe(sha);
  });
});
