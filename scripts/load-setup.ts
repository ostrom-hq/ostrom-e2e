// SPDX-License-Identifier: Apache-2.0
// Prepares the gate load tests (load/smoke.js `gates`, load/race.js) on the running server, through its own routes:
// a requester (dev-a, owner) with a `gates:ask` token, an approver (rev-b, admin of the same organization) signed in
// by its e-mailed link (only a browser session may say yes), and rev-b made approver of pushes to main of the repo.
// Writes `ready=true|false` and `reason` to $GITHUB_OUTPUT, the credentials to $GITHUB_ENV (masked). Never fails the
// job: while a piece is not on main, the gate load tests are skipped with the reason.
// Usage (CI): OSTROM_E2E_SERVER_URL=… OSTROM_E2E_MAIL_DIR=… node scripts/load-setup.ts
import { appendFileSync } from 'node:fs';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from '../scenarios/env.ts';
import { call, email, orgOf, orgsUnavailable, signIn } from '../scenarios/org.ts';

const REPO = process.env['OSTROM_LOAD_REPO'] ?? 'acme/api';
const out = (file: string | undefined, line: string) => (file ? appendFileSync(file, `${line}\n`) : console.log(line));

async function setup(): Promise<string> {
  if (SERVER_URL === '') return 'no server';
  for (const [method, path] of [['POST', '/api/v1/gates'], ['POST', '/api/v1/approvals/00000000-0000-0000-0000-000000000000/answer'], ['POST', '/api/v1/tokens'], ['POST', '/api/v1/workflows']] as const) {
    if (!(await isServed(SERVER_URL, path, method))) return `not served yet: ${method} ${path}`;
  }
  const orgs = await orgsUnavailable();
  if (orgs) return orgs;
  const devA = await signIn(email('dev-a'));
  const org = await orgOf(devA);
  const revBEmail = email('rev-b');
  const invited = await call(devA.caller, 'POST', '/api/v1/members/invites', { invites: [{ email: revBEmail, role: 'admin' }] });
  if (invited.status !== 200) return `invite → ${invited.status} ${JSON.stringify(invited.body)}`;
  const revB = await signIn(revBEmail);
  if ((await orgOf(revB)).id !== org.id) return 'rev-b did not join the organization of dev-a';
  const token = await call(devA.caller, 'POST', '/api/v1/tokens', { name: 'k6 requester', scopes: ['gates:ask', 'gates:read'], expiresInDays: 1 });
  const secret = token.body['secret'];
  if (token.status !== 200 || typeof secret !== 'string') return `token → ${token.status} ${JSON.stringify(token.body)}`;
  // The approver of pushes to main of REPO comes from a compiled workflow (contract `POST /api/v1/workflows`). Its
  // body is written here once the compiler is on main; until then the gate is not configured and the tests wait.
  const workflow = await call(devA.caller, 'POST', '/api/v1/workflows', {
    name: 'k6 push to main',
    scope: `repo:${REPO}`,
    nodes: [{ id: 'push-main', type: 'gate', on: { class: 'git.push', ref: 'refs/heads/main' }, approvers: [revBEmail], enforce: true }],
  });
  if (workflow.status >= 300) return `workflow → ${workflow.status} ${JSON.stringify(workflow.body)}`;
  const { cookie = '', csrf = '' } = revB.caller;
  for (const v of [secret, cookie, csrf]) console.log(`::add-mask::${v}`);
  out(process.env['GITHUB_ENV'], `OSTROM_LOAD_TOKEN=${secret}`);
  out(process.env['GITHUB_ENV'], `OSTROM_LOAD_APPROVER_COOKIE=${cookie}`);
  out(process.env['GITHUB_ENV'], `OSTROM_LOAD_APPROVER_CSRF=${csrf}`);
  return '';
}

let reason: string;
try {
  reason = await setup();
} catch (error) {
  reason = `setup failed: ${String(error)}`;
}
out(process.env['GITHUB_OUTPUT'], `ready=${reason === '' ? 'true' : 'false'}`);
out(process.env['GITHUB_OUTPUT'], `reason=${reason.replaceAll('\n', ' ').slice(0, 300)}`);
if (reason) console.log(`::notice title=gate load tests skipped::${reason}`);
