// SPDX-License-Identifier: Apache-2.0
// Journeys of a signed-in person, run by chart-load.yml through the chart's ingress (kind, 2 server replicas): who am
// I, my organizations (the list, one of them, its members), and renaming that organization (a write). Thresholds per
// scenario; any failing threshold fails the job.
// The person is a QA account of `ostrom-server seed-test-account` (its token in OSTROM_LOAD_SEED_TOKEN, its
// organization in OSTROM_LOAD_SEED_ORG): an e-mailed sign-in under load is refused by the sign-in rate limits by
// design, creating organizations is limited per person and per hour, and a gate's yes needs a browser session, which
// load/smoke.js `gates` and load/race.js cover once scripts/load-setup.ts reports ready.
// Usage: OSTROM_URL=http://api.ostrom.test OSTROM_LOAD_SEED_TOKEN=… OSTROM_LOAD_SEED_ORG=… k6 run load/chart-journeys.js
import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { BASE, headers, pick } from './lib.js';

const TOKEN = __ENV.OSTROM_LOAD_SEED_TOKEN || '';
const ORG = __ENV.OSTROM_LOAD_SEED_ORG || '';

/** The thresholds of one scenario: latency, errors, checks, and at least one request. */
function limits(name, p95, p99) {
  return {
    [`http_req_duration{scenario:${name}}`]: [`p(95)<${p95}`, `p(99)<${p99}`],
    [`http_req_failed{scenario:${name}}`]: ['rate<0.01'],
    [`checks{scenario:${name}}`]: ['rate>0.99'],
    [`http_reqs{scenario:${name}}`]: ['count>0'],
  };
}

const rate = (r, exec, vus) => ({ executor: 'constant-arrival-rate', rate: r, timeUnit: '1s', duration: '60s', preAllocatedVUs: vus, maxVUs: vus * 4, exec });
const SCENARIOS = {
  me: { scenario: rate(40, 'me', 10), thresholds: limits('me', 100, 250) },
  orgs: { scenario: rate(20, 'orgs', 10), thresholds: limits('orgs', 150, 400) },
  rename: { scenario: rate(5, 'rename', 5), thresholds: limits('rename', 200, 500) },
};

const picked = pick(Object.keys(SCENARIOS));

export const options = {
  scenarios: Object.fromEntries(picked.map((k) => [k, SCENARIOS[k].scenario])),
  thresholds: Object.assign({}, ...picked.map((k) => SCENARIOS[k].thresholds)),
};

export function setup() {
  if (!TOKEN || !ORG) exec.test.abort('chart-journeys needs OSTROM_LOAD_SEED_TOKEN and OSTROM_LOAD_SEED_ORG (ostrom-server seed-test-account)');
}

const org = (path = '') => `${BASE}/api/v1/orgs/${encodeURIComponent(ORG)}${path}`;

// Who am I: the profile behind the token.
export function me() {
  const r = http.get(`${BASE}/api/v1/auth/me`, { headers: headers(TOKEN), tags: { name: 'me' } });
  check(r, { 'me 200': (x) => x.status === 200 });
}

// My organizations, then the seeded one, then its members.
export function orgs() {
  const list = http.get(`${BASE}/api/v1/orgs`, { headers: headers(TOKEN), tags: { name: 'orgs' } });
  check(list, { 'orgs 200 with the seeded one': (x) => x.status === 200 && (x.json('items') || []).some((o) => o.id === ORG) });
  const one = http.get(org(), { headers: headers(TOKEN), tags: { name: 'org' } });
  check(one, { 'org 200': (x) => x.status === 200 && x.json('id') === ORG });
  const members = http.get(org('/members'), { headers: headers(TOKEN), tags: { name: 'members' } });
  check(members, { 'members 200, at least the owner': (x) => x.status === 200 && (x.json('items') || []).length >= 1 });
}

// A write: the owner renames the organization.
export function rename() {
  const name = `Load ${__VU}-${__ITER}`;
  const r = http.patch(org(), JSON.stringify({ name }), { headers: headers(TOKEN), tags: { name: 'rename' } });
  check(r, { 'rename 200 with the new name': (x) => x.status === 200 && x.json('name') === name });
}
