// SPDX-License-Identifier: Apache-2.0
// Streams held open together through the gateway: OSTROM_LOAD_STREAMS of them (a ramp from 50 to 300 in the load
// pass), each a minute long (120 deltas 500 ms apart), all started at once. Every stream either ends whole or is
// refused at once as an overloaded provider refuses (503 `overloaded_error` with `retry-after`): a replica past its
// OSTROM_GATEWAY_MAX_OPEN_CALLS says so, and a server killed for its memory (OOMKilled at the chart's 256 Mi) cuts the
// streams it held instead. `streams_whole` counts the streams held open; the memory each costs comes from the pods'
// samples taken during the run (chart-load.yml, scripts/relay-summary.ts).
// Usage: k6 run load/streams.js  (OSTROM_URL, OSTROM_LOAD_RELAY_TOKEN, OSTROM_LOAD_STREAMS)
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { infer, requireRelayToken, whole } from './relay-lib.js';

const STREAMS = Number(__ENV.OSTROM_LOAD_STREAMS || 50);
const CHUNKS = Number(__ENV.OSTROM_LOAD_STREAM_CHUNKS || 120);
const GAP_MS = Number(__ENV.OSTROM_LOAD_STREAM_GAP_MS || 500);
const TAG = `stream-${STREAMS}`;

export const options = {
  scenarios: { streams: { executor: 'per-vu-iterations', vus: STREAMS, iterations: 1, maxDuration: '5m' } },
  thresholds: { checks: ['rate==1'], [`http_req_duration{name:${TAG}}`]: ['max<300000'], [`http_req_waiting{name:${TAG}}`]: ['p(95)<10000'] },
};

const held = new Counter('streams_whole');
const refused = new Counter('streams_refused');

/** The gateway's refusal past its ceiling, in the Anthropic shape. */
function overloaded(r) {
  if (r.status !== 503 || !r.headers['Retry-After']) return false;
  try {
    return JSON.parse(r.body).error.type === 'overloaded_error';
  } catch (_) {
    return false;
  }
}

export function setup() {
  requireRelayToken('the open streams');
}

export default function () {
  const r = infer(false, true, { chunks: CHUNKS, gapMs: GAP_MS }, TAG, { timeout: '4m' });
  const done = whole(r, true);
  const turnedAway = !done && overloaded(r);
  if (done) held.add(1);
  if (turnedAway) refused.add(1);
  check(r, { 'stream whole, or refused as overloaded': () => done || turnedAway });
}
