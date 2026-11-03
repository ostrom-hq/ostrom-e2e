// SPDX-License-Identifier: Apache-2.0
// Prepares the registered runners' load test (load/runners.js) on the running server, through its own routes: as many
// organizations as needed (an organization holds 100 runners at most), each owner signed in by its e-mailed link (only
// a browser session registers a runner), and their runners registered. Writes the runners (id and key) to the JSON file
// $OSTROM_LOAD_RUNNERS_FILE, `ready=true|false` and `reason` to $GITHUB_OUTPUT. Never fails the job: while a piece is
// not on main, the runners' load test is skipped with the reason.
// Usage (CI): OSTROM_E2E_SERVER_URL=… OSTROM_E2E_MAIL_DIR=… OSTROM_LOAD_RUNNERS=500 OSTROM_LOAD_RUNNERS_FILE=… \
//   node scripts/runners-load-setup.ts
import { appendFileSync, writeFileSync } from 'node:fs';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from '../scenarios/env.ts';
import { call, email, orgOf, signIn } from '../scenarios/org.ts';

const PER_ORG = 100;
const out = (file: string | undefined, line: string) => (file ? appendFileSync(file, `${line}\n`) : console.log(line));

async function setup(): Promise<string> {
  if (SERVER_URL === '') return 'no server';
  const file = process.env['OSTROM_LOAD_RUNNERS_FILE'] ?? '';
  if (file === '') return 'no OSTROM_LOAD_RUNNERS_FILE';
  const wanted = Number(process.env['OSTROM_LOAD_RUNNERS'] ?? '500');
  if (!(await isServed(SERVER_URL, '/api/v1/runners', 'POST'))) return 'not served yet: POST /api/v1/runners';
  const runners: { id: string; token: string }[] = [];
  for (let org = 0; runners.length < wanted; org++) {
    const owner = await signIn(email(`runners-${org}`));
    // The runners routes name the organization (the `Ostrom-Org` header).
    const caller = { ...owner.caller, org: (await orgOf(owner)).id };
    for (let i = 0; i < PER_ORG && runners.length < wanted; i++) {
      const r = await call(caller, 'POST', '/api/v1/runners', { name: `k6-machine-${i}`, labels: ['docker'] });
      const { id, token } = r.body ?? {};
      if (r.status !== 201 || typeof id !== 'string' || typeof token !== 'string') {
        return `register → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`;
      }
      runners.push({ id, token });
    }
  }
  writeFileSync(file, JSON.stringify(runners), { mode: 0o600 });
  console.log(`${runners.length} runners registered in ${Math.ceil(runners.length / PER_ORG)} organizations`);
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
if (reason) console.log(`::notice title=runners load test skipped::${reason}`);
