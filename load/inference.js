// SPDX-License-Identifier: Apache-2.0
// The inference gateway's overhead: the same call to the fake provider, made directly and through the gateway, both
// through the same ingress, in the same iteration (in alternate order), so that the two series see the same load.
// Time to first byte is `http_req_waiting`, time to the end `http_req_duration`, each tagged direct-* or gateway-*:
// scripts/relay-summary.ts reads the summary and gives the gateway's overhead at p50, p95 and p99 (threshold of the
// load pass: under 15 ms at p95).
// - json: a whole message of 20 deltas, answered at once by the fake.
// - sse: a stream of 20 deltas 5 ms apart.
// Usage: k6 run load/inference.js  (OSTROM_URL, OSTROM_LOAD_FAKE_URL, OSTROM_LOAD_RELAY_TOKEN; OSTROM_LOAD_SCENARIOS)
import { check } from 'k6';
import exec from 'k6/execution';
import { pick } from './lib.js';
import { infer, requireRelayToken, whole } from './relay-lib.js';

const RATE = Number(__ENV.OSTROM_LOAD_INFERENCE_RATE || 20);
const DURATION = __ENV.OSTROM_LOAD_INFERENCE_DURATION || '60s';
const SHAPES = { json: { chunks: 20, gapMs: 0 }, sse: { chunks: 20, gapMs: 5 } };
const SECONDS = Number(DURATION.replace(/s$/, ''));
const picked = pick(['json', 'sse']);
export const options = {
  // One after the other, 5 s apart: each scenario has the server to itself.
  scenarios: Object.fromEntries(
    picked.map((name, i) => [
      name,
      { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 20, maxVUs: 100, startTime: `${i * (SECONDS + 5)}s`, exec: name },
    ]),
  ),
  // The tagged series are in the exported summary only when a threshold names them: wide bounds, the verdict on the
  // overhead is scripts/relay-summary.ts's (direct against gateway).
  thresholds: Object.assign(
    { checks: ['rate==1'] },
    ...picked.flatMap((name) =>
      ['direct', 'gateway'].flatMap((side) => [
        { [`http_req_waiting{name:${side}-${name}}`]: ['p(95)<10000'] },
        { [`http_req_duration{name:${side}-${name}}`]: ['p(95)<10000'] },
      ]),
    ),
  ),
};

export function setup() {
  requireRelayToken('the gateway overhead');
}

function pair(kind, stream) {
  // Alternate who goes first, so that neither series is always the one on a warm connection.
  const order = exec.scenario.iterationInTest % 2 === 0 ? [true, false] : [false, true];
  for (const direct of order) {
    const r = infer(direct, stream, SHAPES[kind], `${direct ? 'direct' : 'gateway'}-${kind}`);
    check(r, { [`${direct ? 'direct' : 'gateway'} ${kind} whole`]: (x) => whole(x, stream) });
  }
}

export function json() {
  pair('json', false);
}

export function sse() {
  pair('sse', true);
}
