// Short load test run on every ostrom-server pull request (about 70 s). The thresholds fail the job.
// Usage: k6 run load/smoke.js  (OSTROM_URL, OSTROM_LOAD_TOKEN, OSTROM_LOAD_APPROVER_TOKEN, OSTROM_ROUTE_*)
// OSTROM_LOAD_SCENARIOS picks the scenarios (default: all) while the server does not serve every route yet.
import http from 'k6/http';
import { check } from 'k6';
import { action, approve, ask, askPushToMain, headers, pick, requireTokens, route } from './lib.js';

// Public scenarios (health, instance) need no token; the others ask gates and say yes.
const PUBLIC = ['health', 'instance'];
const SCENARIOS = {
  instance: {
    scenario: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '60s', preAllocatedVUs: 10, exec: 'instance' },
    thresholds: { 'http_req_duration{name:instance}': ['p(95)<50', 'p(99)<100'] },
  },
  health: {
    scenario: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '60s', preAllocatedVUs: 10, exec: 'health' },
    thresholds: { 'http_req_duration{name:health}': ['p(95)<50', 'p(99)<100'] },
  },
  asks: {
    scenario: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '60s', preAllocatedVUs: 40, exec: 'asks' },
    thresholds: { 'http_req_duration{name:ask}': ['p(95)<50', 'p(99)<150'] },
  },
  gates: {
    scenario: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, exec: 'gates' },
    thresholds: { 'http_req_duration{name:gate}': ['p(95)<150', 'p(99)<400'], 'http_req_duration{name:approve}': ['p(95)<150', 'p(99)<400'] },
  },
};

const picked = pick(Object.keys(SCENARIOS));

export const options = {
  scenarios: Object.fromEntries(picked.map((k) => [k, SCENARIOS[k].scenario])),
  thresholds: Object.assign({ http_req_failed: ['rate<0.01'], checks: ['rate>0.99'] }, ...picked.map((k) => SCENARIOS[k].thresholds)),
};

export function setup() {
  if (picked.some((k) => !PUBLIC.includes(k))) requireTokens(`smoke (${picked.join(',')})`);
}

export function instance() {
  const r = http.get(route('instance'), { headers: headers(''), tags: { name: 'instance' } });
  check(r, { 'instance 200': (x) => x.status === 200, 'instance ed25519': (x) => x.status === 200 && x.json('signingKey.algorithm') === 'ed25519' });
}

export function health() {
  const r = http.get(route('health'), { headers: headers(''), tags: { name: 'health' } });
  check(r, { 'health 200': (x) => x.status === 200 });
}

// The hook's question on an ordinary boundary action: answered at once, with a gate status.
export function asks() {
  const i = __VU * 100000 + __ITER;
  const r = ask(action(i), i, 'ask');
  check(r, { 'ask 200 with a status': (x) => x.status === 200 && typeof x.json('gate.status') === 'string' });
}

// A push to main: a pending approval, then a yes from the approver, with a signed receipt.
export function gates() {
  const i = __VU * 100000 + __ITER;
  const g = askPushToMain(i, 'gate');
  check(g, { 'gate 200 pending with an approval': (x) => x.status === 200 && x.json('gate.status') === 'pending' && !!x.json('approval.id') });
  if (g.status !== 200 || !g.json('approval.id')) return;
  const a = approve(g.json('approval'), 'approve');
  check(a, { 'approve 200 with a signed receipt': (x) => x.status === 200 && x.json('approval.status') === 'approved' && !!x.json('receipt.signature') });
}
