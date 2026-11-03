// SPDX-License-Identifier: Apache-2.0
// A client that leaves in the middle of a stream: OSTROM_LOAD_CUTS streams through the gateway (a minute long each,
// one delta every 100 ms), each cut by the client after 3 s. Then, with nothing else running:
// - the gateway closes its upstream connection at once: the fake provider counts every stream as cut by its client
//   (`aborted`) and none open, within `cut_release_ms` of the cuts (threshold: 2 s at most);
// - the usage of each cut call is recorded, not left hanging: one ledger event per cut stream
//   (`GET /api/v1/usage/events`), within the same delay.
// Usage: k6 run load/cut.js  (OSTROM_URL, OSTROM_LOAD_FAKE_URL, OSTROM_LOAD_RELAY_TOKEN, OSTROM_LOAD_CUTS)
import { sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Gauge } from 'k6/metrics';
import { BASE } from './lib.js';
import { MODEL, TOKEN, fakeStats, infer, requireRelayToken, resetFake } from './relay-lib.js';

const CUTS = Number(__ENV.OSTROM_LOAD_CUTS || 20);
const WAIT_S = 15;

const release = new Gauge('cut_release_ms');
const open = new Gauge('cut_upstream_open');
const aborted = new Gauge('cut_upstream_aborted');
const recorded = new Gauge('cut_usage_recorded');

export const options = {
  scenarios: { cut: { executor: 'per-vu-iterations', vus: CUTS, iterations: 1, maxDuration: '1m' } },
  thresholds: {
    cut_upstream_open: ['value==0'],
    cut_upstream_aborted: [`value>=${CUTS}`],
    cut_usage_recorded: [`value>=${CUTS}`],
    cut_release_ms: ['value<=2000'],
  },
};

export function setup() {
  requireRelayToken('the cut streams');
  resetFake();
  const before = fakeStats();
  if (!before) exec.test.abort(`the fake provider does not answer its stats at ${__ENV.OSTROM_LOAD_FAKE_URL}`);
  return { from: new Date().toISOString() };
}

export default function () {
  // The request timeout is the client leaving: k6 closes the connection.
  infer(false, true, { chunks: 600, gapMs: 100 }, 'stream-cut', { timeout: '3s' });
}

/** The ledger's events of the model since `from`, among the newest 200. */
function events(from) {
  // ISO instants in UTC compare as text; to the second, since the server writes more fraction digits than k6 parses.
  const since = from.slice(0, 19);
  const r = http.get(`${BASE}/api/v1/usage/events?limit=200`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    tags: { name: 'usage-events' },
  });
  if (r.status !== 200) return -1;
  return (r.json('events') || []).filter((e) => e.name === MODEL && String(e.at).slice(0, 19) >= since).length;
}

export function teardown(data) {
  const started = Date.now();
  let stats = fakeStats();
  let seen = events(data.from);
  while (Date.now() - started < WAIT_S * 1000 && (!stats || stats.provider.open > 0 || stats.provider.aborted < CUTS || seen < CUTS)) {
    sleep(0.1);
    stats = fakeStats();
    seen = events(data.from);
  }
  release.add(Date.now() - started);
  open.add(stats ? stats.provider.open : -1);
  aborted.add(stats ? stats.provider.aborted : -1);
  recorded.add(seen);
  console.log(`cut: ${JSON.stringify(stats && stats.provider)}, ${seen} usage events, ${Date.now() - started} ms after the cuts`);
}
