// SPDX-License-Identifier: Apache-2.0
// E2E-GH-INSTALL: installing the GitHub App, against the bench's fake GitHub. The server links an installation to an
// organization only if the person who came back from GitHub reaches it (`GET /user/installations` with the token of
// the install's OAuth code), and only for the session that started the install. The callback always sends the
// browser back to the console's `/github` page, with `installed=1` or `error=<error.type>`. Organization B's owner who
// returns with the id of acme's installation is sent to `error=installation_not_yours`; acme's owner then installs
// it. The server must point OSTROM_GITHUB_API and OSTROM_GITHUB_WEB at the fake (OSTROM_E2E_GITHUB_PORT, set by the
// workflow with the App's test settings).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/fake-github.ts';
import { headersOf } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from './env.ts';
import { type Person, call, email, orgOf, orgsUnavailable, signIn, url } from './org.ts';

const PORT = Number(process.env['OSTROM_E2E_GITHUB_PORT'] ?? '0');
const START = '/api/v1/github/app/install/start';
const CALLBACK = '/api/v1/github/app/install/callback';

async function unavailable(): Promise<string> {
  const orgs = await orgsUnavailable();
  if (orgs !== '') return orgs;
  if (PORT === 0) return 'no OSTROM_E2E_GITHUB_PORT';
  return (await isServed(SERVER_URL, CALLBACK)) ? '' : `not served yet: GET ${CALLBACK}`;
}

const WHY = await unavailable();
const github = new FakeGitHub();
// The bench's App webhook secret (OSTROM_GITHUB_WEBHOOK_SECRET of ci.yml and ostrom-server's e2e-journey.yml).
const WEBHOOK_SECRET = process.env['OSTROM_E2E_GITHUB_WEBHOOK_SECRET'] ?? 'whsec_github_e2e';

/** GitHub's signed `installation.created`: the server learns who installed it before the browser comes back. */
async function created(installation: number, account: string, sender: string): Promise<void> {
  const payload = { action: 'created', installation: { id: installation, account: { login: account, type: 'Organization' } }, sender: { login: sender } };
  expect(await github.webhook(`${SERVER_URL.replace(/\/$/, '')}/webhooks/github`, WEBHOOK_SECRET, 'installation', payload)).toBeLessThan(300);
}

/** GET without following GitHub's redirects: the start sends the browser to GitHub, the callback to the console. */
async function visit(caller: Person['caller'], path: string): Promise<{ status: number; location: string; body: string }> {
  const r = await fetch(url(path), { headers: headersOf(caller, 'GET', false), redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
}

/** The state of an install `owner` starts (optionally for `?org=`). */
async function stateOf(owner: Person, query = ''): Promise<string> {
  const start = await visit(owner.caller, START + query);
  expect(start.status).toBe(302);
  return new URL(start.location).searchParams.get('state') ?? '';
}

/** Comes back from GitHub with `installation`, authorized as `login`, in `session`; returns the console's query. */
async function back(session: Person['caller'], installation: number, login: string, state: string): Promise<string> {
  const r = await visit(session, `${CALLBACK}?installation_id=${installation}&code=${github.webCode(login)}&state=${state}`);
  expect(r.status).toBe(302);
  expect(r.location.split('?')[0]).toMatch(/\/github$/);
  return new URL(r.location).search;
}

describe.skipIf(WHY !== '')(`E2E-GH-INSTALL: an organization installs only its own GitHub installation${WHY ? ` (${WHY})` : ''}`, () => {
  beforeAll(async () => {
    await github.start(PORT);
    github.installation(42, 'acme', 'acme-admin');
    github.installation(43, 'globex', 'globex-admin');
    // Since ostrom-server#118 the callback links an installation only once this webhook named who installed it.
    await created(42, 'acme', 'acme-admin');
    await created(43, 'globex', 'globex-admin');
  });
  afterAll(() => github.stop());

  it('E2E-GH-INSTALL-001 B cannot take acme’s installation nor A’s state; acme’s owner installs it', async () => {
    const a = await signIn(email('gh-a'));
    const b = await signIn(email('gh-b'));
    // The install is for the caller's organization (or the `?org=` it names): a person without one gets 404 at the
    // start, so each has their own first.
    await orgOf(a);
    await orgOf(b);

    expect(await back(b.caller, 42, 'globex-admin', await stateOf(b))).toBe('?error=installation_not_yours');
    expect((await call(b.caller, 'GET', '/api/v1/github/app')).body).toMatchObject({ installed: false });
    expect(github.requests.some((r) => r.path === '/user/installations')).toBe(true);

    // A's state brought back in B's session (a link sent to someone else) is refused, and still serves A.
    const stateA = await stateOf(a);
    expect(await back(b.caller, 42, 'acme-admin', stateA)).toBe('?error=forbidden');
    expect(await back(b.caller, 43, 'globex-admin', await stateOf(b))).toBe('?installed=1');
    expect((await call(b.caller, 'GET', '/api/v1/github/app')).body).toMatchObject({ installed: true });

    expect(await back(a.caller, 42, 'acme-admin', stateA)).toBe('?installed=1');
    expect((await call(a.caller, 'GET', '/api/v1/github/app')).body).toMatchObject({ installed: true });
    expect(await back(a.caller, 42, 'acme-admin', stateA)).toBe('?error=forbidden');
    // B names A's organization: 404, an organization B is not in is not found (ostrom-server#143).
    expect((await visit(b.caller, `${START}?org=${(await orgOf(a)).id}`)).status).toBe(404);
    // The person's token lists their installations and names them (`GET /user`, compared with who installed it since
    // ostrom-server#118); it is never sent anywhere else.
    const withToken = github.requests.filter((r) => r.authorization.includes('ghu_')).map((r) => r.path);
    expect(withToken.filter((p) => p !== '/user/installations' && p !== '/user')).toEqual([]);
  });
});
