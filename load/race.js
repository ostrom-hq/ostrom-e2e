// 100 simultaneous "yes" on the same approval: exactly one 200, 99 × 409, one receipt (conformance « 100 approbations
// simultanées » of the control-server spec; YES-006). Run on every ostrom-server PR and every night.
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { approvalOf, approve, askPushToMain, requireTokens } from './lib.js';

const ok = new Counter('race_ok');
const conflict = new Counter('race_conflict');
const other = new Counter('race_other');

export const options = {
  scenarios: { race: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '30s' } },
  thresholds: { race_ok: ['count==1'], race_conflict: ['count==99'], race_other: ['count==0'] },
};

export function setup() {
  requireTokens('race');
  const g = askPushToMain(Date.now(), 'gate');
  if (g.status !== 200 || !g.json('gate.id')) exec.test.abort(`the push to main was not gated: ${g.status} ${g.body}`);
  const approval = approvalOf(g.json());
  if (!approval || !approval.id) exec.test.abort(`no pending approval for the approver: ${g.body}`);
  return approval;
}

export default function (approval) {
  const r = approve(approval, 'approve-race');
  if (r.status === 200) ok.add(1);
  else if (r.status === 409) conflict.add(1);
  else other.add(1);
}
