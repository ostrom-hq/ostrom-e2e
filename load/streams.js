// SPDX-License-Identifier: Apache-2.0
// Streams held open together through the gateway: OSTROM_LOAD_STREAMS of them (50, then 200 in the load pass), each a
// minute long (120 deltas 500 ms apart), all started at once. Every stream must end whole: a server killed for its
// memory (OOMKilled at the chart's 256 Mi) cuts the streams it held. The memory each open stream costs comes from the
// pods' samples taken during the run (chart-load.yml, scripts/relay-summary.ts).
// Usage: k6 run load/streams.js  (OSTROM_URL, OSTROM_LOAD_RELAY_TOKEN, OSTROM_LOAD_STREAMS)
import { check } from 'k6';
import { infer, requireRelayToken, whole } from './relay-lib.js';

const STREAMS = Number(__ENV.OSTROM_LOAD_STREAMS || 50);
const CHUNKS = Number(__ENV.OSTROM_LOAD_STREAM_CHUNKS || 120);
const GAP_MS = Number(__ENV.OSTROM_LOAD_STREAM_GAP_MS || 500);
const TAG = `stream-${STREAMS}`;

export const options = {
  scenarios: { streams: { executor: 'per-vu-iterations', vus: STREAMS, iterations: 1, maxDuration: '5m' } },
  thresholds: { checks: ['rate==1'], [`http_req_duration{name:${TAG}}`]: ['max<300000'], [`http_req_waiting{name:${TAG}}`]: ['p(95)<10000'] },
};

export function setup() {
  requireRelayToken('the open streams');
}

export default function () {
  const r = infer(false, true, { chunks: CHUNKS, gapMs: GAP_MS }, TAG, { timeout: '4m' });
  check(r, { 'stream whole': (x) => whole(x, true) });
}
