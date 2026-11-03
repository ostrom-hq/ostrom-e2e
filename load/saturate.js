// SPDX-License-Identifier: Apache-2.0
// Measurement only (perf/race-memory-probe, never merged): the three ceilings of a replica filled at once, each with
// 100 calls beyond it (server#266). Held at the same time: OSTROM_SAT_STREAMS `/usage/live` streams (open connections),
// OSTROM_SAT_WAITS gate waits (`GET /gates/{id}?wait=30`, waiting calls), then OSTROM_SAT_CALLS simultaneous yes on one
// approval (ordinary calls, past their ceiling and queue), and `/health` polled all along.
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { BASE, approvalOf, approve, approverHeaders, askPushToMain, headers, requireTokens } from './lib.js';

const STREAMS = Number(__ENV.OSTROM_SAT_STREAMS || 200);
const WAITS = Number(__ENV.OSTROM_SAT_WAITS || 175);
const CALLS = Number(__ENV.OSTROM_SAT_CALLS || 400);
const ASKER = __ENV.OSTROM_LOAD_TOKEN || '';
const statuses = new Counter('sat_status');
const retryAfter = new Counter('sat_retry_after');
const health = new Counter('sat_health');

const kinds = ['stream', 'wait', 'call', 'health'];
const codes = ['0', '200', '401', '403', '409', '429', '500', '502', '503', 'other'];
export const options = {
  scenarios: {
    streams: { executor: 'per-vu-iterations', vus: STREAMS, iterations: 1, maxDuration: '60s', exec: 'stream' },
    waits: { executor: 'per-vu-iterations', vus: WAITS, iterations: 1, maxDuration: '60s', exec: 'wait' },
    ...(CALLS > 0 ? { calls: { executor: 'per-vu-iterations', vus: CALLS, iterations: 1, maxDuration: '60s', exec: 'call', startTime: '8s' } } : {}),
    health: { executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: '40s', preAllocatedVUs: 5, exec: 'healthCheck' },
  },
  // Sub-metrics only exist in the summary when a threshold names them.
  thresholds: Object.fromEntries([
    ...kinds.flatMap((k) => codes.map((c) => [`sat_status{kind:${k},status:${c}}`, ['count>=0']])),
    ...kinds.map((k) => [`sat_retry_after{kind:${k}}`, ['count>=0']]),
    ...['200', 'other'].map((c) => [`sat_health{status:${c}}`, ['count>=0']]),
    ['http_req_duration{name:sat-call}', ['max>=0']],
  ]),
};

export function setup() {
  requireTokens('saturate');
  const held = askPushToMain(Date.now(), 'sat-gate');
  const raced = askPushToMain(Date.now() + 1, 'sat-gate');
  if (held.status !== 200 || raced.status !== 200) exec.test.abort(`gates not asked: ${held.status} ${raced.status}`);
  const approval = approvalOf(raced.json());
  if (!approval || !approval.id) exec.test.abort(`no pending approval: ${raced.body}`);
  return { heldGate: held.json('gate.id'), approval };
}

const seen = {};
function count(kind, r) {
  const known = codes.includes(String(r.status));
  statuses.add(1, { kind, status: known ? String(r.status) : 'other' });
  // An unlisted status is named once per kind, with the start of its body, so the summary is never short of a code.
  if (!known && !seen[`${kind}${r.status}`]) {
    seen[`${kind}${r.status}`] = true;
    console.warn(`SATODD ${kind} status=${r.status} error=${r.error_code} body=${String(r.body).slice(0, 160)}`);
  }
  if (r.headers['Retry-After'] !== undefined) retryAfter.add(1, { kind });
}

export function stream() {
  // Held until the timeout: a stream that stays open ends with status 0, a refused one with its 503.
  const h = approverHeaders();
  count('stream', http.get(`${BASE}/api/v1/usage/live`, { headers: { cookie: h.cookie, accept: 'text/event-stream' }, timeout: '40s', tags: { name: 'sat-stream' } }));
}

export function wait(data) {
  count('wait', http.get(`${BASE}/api/v1/gates/${data.heldGate}?wait=30`, { headers: headers(ASKER), timeout: '45s', tags: { name: 'sat-wait' } }));
}

export function call(data) {
  count('call', approve(data.approval, 'sat-call'));
}

export function healthCheck() {
  const r = http.get(`${BASE}/health`, { timeout: '5s', tags: { name: 'sat-health' } });
  health.add(1, { status: r.status === 200 ? '200' : 'other' });
}

export function handleSummary(data) {
  const m = data.metrics;
  const c = (k) => (m[k] ? m[k].values.count : 0);
  const line = (kind) =>
    `${kind}: ${codes.filter((s) => c(`sat_status{kind:${kind},status:${s}}`) > 0).map((s) => `${s}x${c(`sat_status{kind:${kind},status:${s}}`)}`).join(' ')} retry_after=${c(`sat_retry_after{kind:${kind}}`)}`;
  const d = m['http_req_duration{name:sat-call}'];
  const p = (q) => (d && d.values[q] !== undefined ? d.values[q].toFixed(0) : '?');
  return {
    stdout: [
      `SAT streams=${STREAMS} waits=${WAITS} calls=${CALLS}`,
      `SAT ${line('stream')}`,
      `SAT ${line('wait')}`,
      `SAT ${line('call')} med=${p('med')}ms p95=${p('p(95)')}ms max=${p('max')}ms`,
      `SAT health: 200x${c('sat_health{status:200}')} other=${c('sat_health{status:other}')}`,
      '',
    ].join('\n'),
  };
}
