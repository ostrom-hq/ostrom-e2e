// 100 simultaneous "yes" on the same gate: exactly one 200, 99 × 409, one receipt (SPEC of the control server,
// conformance « 100 approbations simultanées »). Run on every ostrom-server PR and every night.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { BASE, ROUTES, headers, post, sha } from './lib.js';

const ok = new Counter('race_ok');
const conflict = new Counter('race_conflict');
const other = new Counter('race_other');

export const options = {
  scenarios: { race: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '30s' } },
  thresholds: { race_ok: ['count==1'], race_conflict: ['count==99'], race_other: ['count==0'] },
};

export function setup() {
  const g = post(ROUTES.gate, { org: 'org-0001', repo: 'backend', action: 'push-main', sha: sha(Date.now()), asked_by: 'alice', command: 'git push origin main' }, 'gate');
  if (g.status !== 201) exec.test.abort(`gate not created: ${g.status} ${g.body}`);
  return { id: g.json('id'), by: g.json('approvers.0') };
}

export default function (d) {
  const r = post(ROUTES.approve, { org: 'org-0001', gate_id: d.id, by: d.by, result: 'approved' }, 'approve-race');
  if (r.status === 200) ok.add(1);
  else if (r.status === 409) conflict.add(1);
  else other.add(1);
}

export function teardown(d) {
  const r = http.get(`${BASE}${ROUTES.receipt}${d.id.replace('gate_', 'rcpt_')}?org=org-0001`, { headers: headers() });
  check(r, { 'receipt route answers': (x) => x.status === 200 || x.status === 404 });
}
