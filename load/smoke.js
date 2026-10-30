// Short load test run on every ostrom-server pull request (about 70 s). The thresholds fail the job.
// Usage: k6 run load/smoke.js  (OSTROM_URL, optional OSTROM_LOAD_TOKEN, OSTROM_ROUTE_*)
import http from 'k6/http';
import { check } from 'k6';
import { BASE, ROUTES, command, headers, org, post, sha } from './lib.js';

export const options = {
  scenarios: {
    health: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '60s', preAllocatedVUs: 10, exec: 'health' },
    checks: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '60s', preAllocatedVUs: 40, exec: 'checks' },
    gates: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '60s', preAllocatedVUs: 20, exec: 'gates' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:health}': ['p(95)<50', 'p(99)<100'],
    'http_req_duration{name:check}': ['p(95)<50', 'p(99)<150'],
    'http_req_duration{name:gate}': ['p(95)<150', 'p(99)<400'],
    'http_req_duration{name:approve}': ['p(95)<150', 'p(99)<400'],
    checks: ['rate>0.99'],
  },
};

export function health() {
  const r = http.get(BASE + ROUTES.health, { headers: headers(), tags: { name: 'health' } });
  check(r, { 'health 200': (x) => x.status === 200 });
}

export function checks() {
  const i = __VU * 100000 + __ITER;
  const r = post(ROUTES.check, { org: org(i), repo: 'backend', tool: 'Bash', command: command(i) }, 'check');
  check(r, { 'check 200 with a decision': (x) => x.status === 200 && ['allow', 'gate', 'deny'].includes(x.json('decision')) });
}

export function gates() {
  const i = __VU * 100000 + __ITER;
  const o = org(i);
  const g = post(ROUTES.gate, { org: o, repo: 'backend', action: 'push-main', sha: sha(i), asked_by: 'alice', command: 'git push origin main' }, 'gate');
  check(g, { 'gate 201': (x) => x.status === 201 });
  if (g.status !== 201) return;
  const a = post(ROUTES.approve, { org: o, gate_id: g.json('id'), by: g.json('approvers.0'), result: 'approved' }, 'approve');
  check(a, { 'approve 200 with a signed receipt': (x) => x.status === 200 && String(x.json('receipt.signature')).startsWith('ed25519;') });
}
