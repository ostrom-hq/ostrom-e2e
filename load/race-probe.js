// SPDX-License-Identifier: Apache-2.0
// Measurement only (perf/race-memory-probe, never merged): one burst of N simultaneous requests of one kind, so the
// server's memory can be read around it (scripts/race-probe.sh). OSTROM_PROBE_KIND:
//   race     N yes on the same fresh approval (1 × 200, N-1 × 409), the race of load/race.js
//   decided  N yes on an approval already answered (N × 409): the race without its winner
//   read     N GET of one approval by the approver's session
//   ask      N asks of a push to main by the requester's token (N gates)
//   unauth   N yes without credentials (N × 401): the HTTP layer alone
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { approvalOf, approve, approverHeaders, askPushToMain, requireTokens, route } from './lib.js';

const KIND = __ENV.OSTROM_PROBE_KIND || 'race';
const N = Number(__ENV.OSTROM_PROBE_VUS || 100);
const codes = new Counter('probe_status');

export const options = {
  scenarios: { probe: { executor: 'per-vu-iterations', vus: N, iterations: 1, maxDuration: '60s' } },
  // Sub-metrics only exist in the summary when a threshold names them.
  thresholds: Object.fromEntries(['200', '401', '403', '409', '429', '500', '502', '503', '0'].map((s) => [`probe_status{status:${s}}`, ['count>=0']])),
};

export function setup() {
  requireTokens('race-probe');
  const g = askPushToMain(Date.now(), 'probe-gate');
  if (g.status !== 200 || !g.json('gate.id')) exec.test.abort(`the push to main was not gated: ${g.status} ${g.body}`);
  const approval = approvalOf(g.json());
  if (!approval || !approval.id) exec.test.abort(`no pending approval for the approver: ${g.body}`);
  if (KIND === 'decided') {
    const r = approve(approval, 'probe-first');
    if (r.status !== 200) exec.test.abort(`the first yes failed: ${r.status} ${String(r.body).slice(0, 200)}`);
  }
  return approval;
}

export default function (approval) {
  let r;
  if (KIND === 'race' || KIND === 'decided') r = approve(approval, 'probe');
  else if (KIND === 'read') r = http.get(route('approvals', '') + '/' + encodeURIComponent(approval.id), { headers: approverHeaders(), tags: { name: 'probe' } });
  else if (KIND === 'ask') r = askPushToMain(exec.vu.idInTest * 7919 + Date.now(), 'probe');
  else if (KIND === 'unauth') r = http.post(route('answer', approval.id), JSON.stringify({ answer: 'approve', shownDigest: approval.shownDigest }), { headers: { 'content-type': 'application/json' }, tags: { name: 'probe' } });
  else exec.test.abort(`unknown OSTROM_PROBE_KIND ${KIND}`);
  codes.add(1, { status: String(r.status) });
}

export function handleSummary(data) {
  const byStatus = Object.entries(data.metrics)
    .filter(([k]) => k.startsWith('probe_status{status:'))
    .filter(([, v]) => v.values.count > 0)
    .map(([k, v]) => `${k.slice('probe_status{status:'.length, -1)}x${v.values.count}`)
    .join(' ');
  const d = data.metrics['http_req_duration{name:probe}'] || data.metrics.http_req_duration;
  const p = (q) => (d && d.values[q] !== undefined ? d.values[q].toFixed(0) : '?');
  return { stdout: `PROBE kind=${KIND} n=${N} codes=[${byStatus}] med=${p('med')}ms max=${p('max')}ms\n` };
}
