// SPDX-License-Identifier: Apache-2.0
// Signs the gate load tests' approver (rev-b, set up by scripts/load-setup.ts) in again by its e-mailed link, right
// before load/smoke.js `gates` and load/race.js. A yes from the console needs a sign-in of less than five minutes
// (ostrom-server#41 and #150, `StepUpRequiredException`): the session load-setup.ts opens is older than that once the
// registered runners' phase (setup, then two 2-minute heartbeat runs) has gone by, and every yes got 403
// `step_up_required` (run 41827441341: 308 yes accepted in the first 15 s of the gates, then none; the race 100 × 403).
// Writes the new session to $GITHUB_ENV (masked), in place of the first one. Fails the step when it cannot sign in:
// the gates would only measure 403s.
// Usage (CI): OSTROM_E2E_SERVER_URL=… OSTROM_E2E_MAIL_DIR=… OSTROM_LOAD_APPROVER_EMAIL=… node scripts/load-approver-signin.ts
import { appendFileSync } from 'node:fs';
import { signIn } from '../scenarios/org.ts';

const approver = process.env['OSTROM_LOAD_APPROVER_EMAIL'] ?? '';
if (approver === '') throw new Error('OSTROM_LOAD_APPROVER_EMAIL is empty: scripts/load-setup.ts did not set the approver up');
const { cookie = '', csrf = '' } = (await signIn(approver)).caller;
if (cookie === '' || csrf === '') throw new Error(`the sign-in of ${approver} gave no session cookie or CSRF token`);
for (const v of [cookie, csrf]) console.log(`::add-mask::${v}`);
const env = process.env['GITHUB_ENV'];
for (const line of [`OSTROM_LOAD_APPROVER_COOKIE=${cookie}`, `OSTROM_LOAD_APPROVER_CSRF=${csrf}`]) {
  if (env) appendFileSync(env, `${line}\n`);
}
console.log(`approver signed in again at ${new Date().toISOString()}`);
