// SPDX-License-Identifier: Apache-2.0
// E2E-GH-INSTALL: installing the GitHub App, against the bench's fake GitHub. The server links an installation to an
// organization only if the person who came back from GitHub reaches it (`GET /user/installations` with the token of
// the install's OAuth code): organization B's owner who returns with the id of acme's installation gets 403
// `installation_not_yours`, and acme's owner then installs it. The server must point OSTROM_GITHUB_API and
// OSTROM_GITHUB_WEB at the fake (OSTROM_E2E_GITHUB_PORT, set by the workflow with the App's test settings).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/fake-github.ts';
import { headersOf } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from './env.ts';
import { type Person, call, email, orgsUnavailable, signIn, url } from './org.ts';

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

/** GET without following GitHub's redirects: the start sends the browser to GitHub, the callback to the console. */
async function visit(caller: Person['caller'], path: string): Promise<{ status: number; location: string; body: string }> {
  const r = await fetch(url(path), { headers: headersOf(caller, 'GET', false), redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
}

/** Starts an install as `owner` and comes back from GitHub with `installation`, authorized as `login`. */
async function install(owner: Person, installation: number, login: string) {
  const start = await visit(owner.caller, START);
  expect(start.status).toBe(302);
  const state = new URL(start.location).searchParams.get('state') ?? '';
  return visit({}, `${CALLBACK}?installation_id=${installation}&code=${github.webCode(login)}&state=${state}`);
}

describe.skipIf(WHY !== '')(`E2E-GH-INSTALL: an organization installs only its own GitHub installation${WHY ? ` (${WHY})` : ''}`, () => {
  beforeAll(async () => {
    await github.start(PORT);
    github.installation(42, 'acme', 'acme-admin');
    github.installation(43, 'globex', 'globex-admin');
  });
  afterAll(() => github.stop());

  it('E2E-GH-INSTALL-001 B cannot take acme’s installation; acme’s owner installs it', async () => {
    const a = await signIn(email('gh-a'));
    const b = await signIn(email('gh-b'));

    const stolen = await install(b, 42, 'globex-admin');
    expect(stolen.status).toBe(403);
    expect((JSON.parse(stolen.body) as { error: { type: string } }).error.type).toBe('installation_not_yours');
    expect((await call(b.caller, 'GET', '/api/v1/github/app')).body).toMatchObject({ installed: false });
    expect(github.requests.some((r) => r.path === '/user/installations')).toBe(true);

    const own = await install(b, 43, 'globex-admin');
    expect(own.status).toBe(302);
    expect((await call(b.caller, 'GET', '/api/v1/github/app')).body).toMatchObject({ installed: true });

    const acme = await install(a, 42, 'acme-admin');
    expect(acme.status).toBe(302);
    expect((await call(a.caller, 'GET', '/api/v1/github/app')).body).toMatchObject({ installed: true });
    // The person's token is used to list their installations, never sent anywhere else.
    expect(github.requests.filter((r) => r.authorization.includes('ghu_')).every((r) => r.path === '/user/installations')).toBe(true);
  });
});
