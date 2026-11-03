// SPDX-License-Identifier: Apache-2.0
// Two bursts on the server: 100 simultaneous requests without a credential (each one a 401), then 100 simultaneous
// authenticated asks (POST /api/v1/gates, ungated actions, each one a 200). A refused or cut request crosses a
// threshold. The server's ci-e2e runs it after the race and also checks that the container neither stopped nor
// restarted, and that its memory stayed under the chart's limit (ostrom-server e2e-journey.yml, « Burst guard »).
// Usage: k6 run load/burst.js  (OSTROM_URL, OSTROM_LOAD_TOKEN)
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { action, ask, headers, route } from './lib.js';

const unauthOk = new Counter('burst_unauth_401');
const authOk = new Counter('burst_auth_200');
const other = new Counter('burst_other');

export const options = {
  scenarios: {
    unauth: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '20s', exec: 'unauth' },
    auth: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '20s', startTime: '20s', exec: 'auth' },
  },
  thresholds: { burst_unauth_401: ['count==100'], burst_auth_200: ['count==100'], burst_other: ['count==0'] },
};

export function setup() {
  if (!__ENV.OSTROM_LOAD_TOKEN) exec.test.abort('burst needs OSTROM_LOAD_TOKEN (a requester; templates/README.md)');
}

function count(r, expected, counter, tag) {
  if (r.status === expected) counter.add(1);
  else {
    // Say which answer it was (0: the connection was cut), so a broken burst names its cause in the log.
    other.add(1, { burst: tag, status: String(r.status) });
    console.warn(`burst ${tag}: unexpected ${r.status} ${String(r.body).slice(0, 200)}`);
  }
}

export function unauth() {
  const body = { repo: 'acme/api', class: 'test.run', tool: 'Bash', command: 'npm test' };
  count(http.post(route('gates'), JSON.stringify(body), { headers: headers(''), tags: { name: 'burst-unauth' } }), 401, unauthOk, 'unauth');
}

export function auth() {
  const n = exec.vu.idInTest;
  count(ask(action(n), Date.now() + n, 'burst-auth'), 200, authOk, 'auth');
}
