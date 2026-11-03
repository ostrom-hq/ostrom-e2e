// SPDX-License-Identifier: Apache-2.0
// E2E-GATE-016: a pull request whose author linked no Ostrom person (decision Q-GATES-G1, option a; ostrom-server#281).
// Under the `never` self-approval policy, its gate waits for an approver who linked a GitHub account, and another one
// than the author's: an approver who linked none reads `you.canApprove` = false with the reason, and their yes is
// refused (403 `github_link_required`); a no needs nothing. Once they link their GitHub (from « My account », the OAuth
// round trip of the sign-in fake), their yes passes and the GitHub check turns green. The person who links the author's
// own GitHub account after the pull request opened is refused (403 `self_approval_refused`).
//
// Two fake GitHubs, as the bench starts the server: sign-in and linking on OSTROM_E2E_FAKE_GITHUB_PORT (4610), the
// App (installation, pull requests, check runs) on OSTROM_E2E_GITHUB_PORT (4700). The App's webhooks are signed with the
// bench's secret (OSTROM_GITHUB_WEBHOOK_SECRET of the workflows).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeGitHub } from '../src/fake-github.ts';
import { type Caller, headersOf } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { FAKE_GITHUB_PORT, SERVER_URL } from './env.ts';
import { type Person, call, cookiesOf, email, invite, join, orgOf, orgsUnavailable, profileOf, signIn, url } from './org.ts';

const APP_PORT = Number(process.env['OSTROM_E2E_GITHUB_PORT'] ?? '0');
const WEBHOOK_SECRET = process.env['OSTROM_E2E_GITHUB_WEBHOOK_SECRET'] ?? 'whsec_github_e2e';
const START = '/api/v1/github/app/install/start';
const CALLBACK = '/api/v1/github/app/install/callback';
const ID = randomUUID();

async function unavailable(): Promise<string> {
  const orgs = await orgsUnavailable();
  if (orgs !== '') return orgs;
  if (APP_PORT === 0 || FAKE_GITHUB_PORT === 0) return 'no OSTROM_E2E_GITHUB_PORT or OSTROM_E2E_FAKE_GITHUB_PORT';
  const routes: [string, string][] = [
    ['GET', CALLBACK],
    ['POST', '/api/v1/auth/github/link'],
    ['GET', '/api/v1/approvals/queue'],
    ['POST', `/api/v1/approvals/${ID}/answer`],
    ['PUT', '/api/v1/gates/policy'],
  ];
  const missing: string[] = [];
  for (const [method, path] of routes) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

const WHY = await unavailable();
const app = new FakeGitHub();
const signin = new FakeGitHub();

/** GET without following redirects (the install sends the browser to GitHub, then back to the console). */
async function visit(caller: Caller, path: string): Promise<{ status: number; location: string }> {
  const r = await fetch(url(path), { headers: headersOf(caller, 'GET', false), redirect: 'manual' });
  await r.text();
  return { status: r.status, location: r.headers.get('location') ?? '' };
}

/** The owner installs the App on `account` for their org: start, GitHub's signed webhook, then the callback. */
async function install(owner: Person, installation: number, account: string, admin: string): Promise<void> {
  app.installation(installation, account, admin);
  const start = await visit(owner.caller, START);
  expect(start.status).toBe(302);
  const state = new URL(start.location).searchParams.get('state') ?? '';
  await hook('installation', { action: 'created', installation: { id: installation, account: { login: account, type: 'Organization' } }, sender: { login: admin } });
  const back = await visit(owner.caller, `${CALLBACK}?installation_id=${installation}&code=${app.webCode(admin)}&state=${state}`);
  expect(back.status).toBe(302);
  expect(new URL(back.location).search).toBe('?installed=1');
}

/** A webhook of the App, signed like GitHub's. */
async function hook(event: string, payload: unknown): Promise<void> {
  expect(await app.webhook(`${SERVER_URL.replace(/\/$/, '')}/webhooks/github`, WEBHOOK_SECRET, event, payload)).toBeLessThan(300);
}

/** The GitHub id the sign-in fake gives `login` (the one its `/user` answers once that login signed in). */
async function githubIdOf(login: string): Promise<number> {
  signin.oauthCode(login, `${login}@e2e.ostrom.test`);
  const r = await fetch(`${signin.url}/user`, { headers: { authorization: `token gho_${login}` } });
  return ((await r.json()) as { id: number }).id;
}

/** `person` links the GitHub account `login` from « My account »: the link starts, GitHub consents, the callback links. */
async function linkGitHub(person: Person, login: string): Promise<void> {
  const started = await fetch(url('/api/v1/auth/github/link?redirect=%2Faccount'), { method: 'POST', headers: headersOf(person.caller, 'POST', false) });
  const body = (await started.json()) as { authorizationUrl?: string };
  expect(started.status, JSON.stringify(body)).toBe(200);
  const to = new URL(body.authorizationUrl ?? '');
  expect(`${to.origin}${to.pathname}`).toBe(`${signin.url}/login/oauth/authorize`);
  const back = new URL(to.searchParams.get('redirect_uri') ?? '');
  back.searchParams.set('code', signin.oauthCode(login, `${login}@e2e.ostrom.test`));
  back.searchParams.set('state', to.searchParams.get('state') ?? '');
  const cookie = [person.caller.cookie, cookiesOf(started)].filter((c) => c).join('; ');
  const done = await fetch(url(back.pathname + back.search), { redirect: 'manual', headers: { ...headersOf(person.caller, 'GET', false), cookie } });
  expect(done.status).toBe(302);
  expect(done.headers.get('location') ?? '').not.toMatch(/error=/);
  const account = await call(person.caller, 'GET', '/api/v1/auth/me/account');
  expect(account.body?.['providers'], JSON.stringify(account.body)).toEqual(expect.arrayContaining(['github']));
}

/** `GitHub opens pull request `number` of `repo` by the GitHub account (`login`, `id`) to main. */
async function opened(installation: number, repo: string, number: number, author: { login: string; id: number }): Promise<string> {
  const headSha = randomUUID().replaceAll('-', '').padEnd(40, '0').slice(0, 40);
  app.pull(repo, { number, headSha, baseRef: 'main', headRef: `feature-${number}`, author: author.login });
  await hook('pull_request', {
    action: 'opened',
    installation: { id: installation },
    repository: { full_name: repo },
    pull_request: { number, state: 'open', base: { ref: 'main' }, head: { ref: `feature-${number}`, sha: headSha }, user: author },
  });
  return headSha;
}

type Pending = { approval: { id: string; shownDigest?: string }; pr?: { number?: string }; you: { canApprove: boolean; reason?: string } };

/** The pending approval of pull request `number` in `who`'s queue. */
async function pendingOf(who: Caller, number: number): Promise<Pending> {
  for (let i = 0; i < 20; i++) {
    const q = await call(who, 'GET', '/api/v1/approvals/queue');
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const found = ((q.body['pending'] ?? []) as Pending[]).find((p) => p.pr?.number === String(number)); // the contract serves the number as a string
    if (found) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no pending approval for pull request ${number}`);
}

const answer = (who: Caller, p: Pending, verdict: 'approve' | 'reject') =>
  call(who, 'POST', `/api/v1/approvals/${p.approval.id}/answer`, { answer: verdict, shownDigest: p.approval.shownDigest });

describe.skipIf(WHY !== '')(`E2E-GATE: a pull request of an author linked to nobody${WHY ? ` (${WHY})` : ''}`, () => {
  beforeAll(async () => {
    await app.start(APP_PORT);
    await signin.start(FAKE_GITHUB_PORT);
  });
  afterAll(async () => {
    await app.stop();
    await signin.stop();
  });

  it('E2E-GATE-016 a PR of an author linked to nobody waits for an approver linked to another GitHub; the author\'s own account is refused', async () => {
    const owner = await signIn(email('gate016-owner'));
    const org = await orgOf(owner);
    const o: Caller = { ...owner.caller, org: org.id };
    const run = randomUUID().slice(0, 6);
    const account = `acme016-${run}`;
    const repo = `${account}/api`;
    const installation = 16_000 + Math.floor(Math.random() * 1000);

    // Two approvers join: `rev-b`, who linked no GitHub, and a third person who will link the author's own account.
    const revEmail = email('gate016-revb');
    const thirdEmail = email('gate016-third');
    expect((await invite(owner, org.id, [revEmail, thirdEmail], 'member')).status).toBe(200);
    const rev = (await join(revEmail)).person;
    const third = (await join(thirdEmail)).person;
    const r: Caller = { ...rev.caller, org: org.id };
    const t: Caller = { ...third.caller, org: org.id };
    const revLogin = (await profileOf(rev.caller)).login;
    const thirdLogin = (await profileOf(third.caller)).login;

    // The org installs the App, a rule gates a push to main of the repository for both, and self-approval is never.
    await install(owner, installation, account, `admin-${run}`);
    const rule = await call(o, 'POST', '/api/v1/rules', {
      statement: 'A merge to main waits for a review', group: 'git', scope: [repo],
      gate: { actions: [{ class: 'push-main', label: 'Merge to main', patterns: [], repos: [repo] }], approvers: [revLogin, thirdLogin] },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const policy = await call(o, 'PUT', '/api/v1/gates/policy', { selfApproval: 'never' });
    expect(policy.status, JSON.stringify(policy.body)).toBeLessThan(300);

    // The author's GitHub account (A) is linked to nobody yet; `rev-b` will link another one (B).
    const authorLogin = `gh-author-${run}`;
    const author = { login: authorLogin, id: await githubIdOf(authorLogin) };
    const pr = 100 + Math.floor(Math.random() * 800);
    const head = await opened(installation, repo, pr, author);
    await opened(installation, repo, pr + 1, author);
    await opened(installation, repo, pr + 2, author);

    // Before any link: `rev-b` cannot say yes, reads why, and is refused; the gate and its check still wait.
    const before = await pendingOf(r, pr);
    expect(before.you.canApprove, JSON.stringify(before)).toBe(false);
    expect(before.you.reason ?? '').toMatch(/link your own GitHub account in My account/i);
    const refused = await answer(r, before, 'approve');
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect((refused.body['error'] as { type?: string } | undefined)?.type).toBe('github_link_required');
    expect((await pendingOf(r, pr)).approval.id).toBe(before.approval.id);
    const check = () => app.checkRuns.filter((c) => c.repo === repo && c.headSha === head);
    expect(check().length, JSON.stringify(app.checkRuns)).toBeGreaterThan(0);
    expect(check().every((c) => c.conclusion !== 'success')).toBe(true);

    // A no needs no link.
    const no = await answer(r, await pendingOf(r, pr + 1), 'reject');
    expect(no.status, JSON.stringify(no.body)).toBe(200);

    // `rev-b` links GitHub account B: their yes now passes, and the check of the pull request turns green.
    await linkGitHub(rev, `gh-revb-${run}`);
    const after = await pendingOf(r, pr);
    expect(after.you.canApprove, JSON.stringify(after)).toBe(true);
    const yes = await answer(r, after, 'approve');
    expect(yes.status, JSON.stringify(yes.body)).toBe(200);
    await expect.poll(() => check().some((c) => c.conclusion === 'success'), { timeout: 10_000 }).toBe(true);

    // The third person links the author's own account A after the pull requests opened: their yes is a self-approval.
    await linkGitHub(third, authorLogin);
    const own = await answer(t, await pendingOf(t, pr + 2), 'approve');
    expect(own.status, JSON.stringify(own.body)).toBe(403);
    expect((own.body['error'] as { type?: string } | undefined)?.type).toBe('self_approval_refused');
  });
});
