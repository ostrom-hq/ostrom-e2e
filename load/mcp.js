// SPDX-License-Identifier: Apache-2.0
// The MCP relay under load, with upstreams that answer at once, late, never, or not at all, all at the same time:
// - fast: `echo` on a server that answers at once, 1.5 calls/s (under the relay's 120 calls per member, server and
//   minute). Its p95 is the relay's own cost; it must hold while the other servers are slow or down.
// - slow: `echo` on a server that answers every message 1 s late (2 at a time): the call succeeds, late.
// - hang: `echo` on a server that never answers: the relay gives up at its deadline (OSTROM_MCP_CALL_TIMEOUT_MS of
//   the load pass) with a tool error, never a hung request.
// - down: `echo` on a server nothing listens on: a tool error at once.
// At the end, what the fakes' HTTPS port saw (`mcp_tls_*` in the summary): TCP connections, TLS handshakes (and resumed
// ones) and HTTP requests, every one the relay sends (initialize, notifications/initialized, the call, the session's
// DELETE) to any of the HTTPS servers. As many handshakes as requests means a connection per request; far fewer, reuse.
// Usage: k6 run load/mcp.js  (OSTROM_URL, OSTROM_LOAD_RELAY_TOKEN; OSTROM_LOAD_MCP_DEADLINE_MS, the relay's deadline)
import { check, sleep } from 'k6';
import { Counter, Gauge } from 'k6/metrics';
import { callTool, fakeStats, requireRelayToken, resetFake, rpcResult } from './relay-lib.js';

const DURATION = __ENV.OSTROM_LOAD_MCP_DURATION || '60s';
const DEADLINE_MS = Number(__ENV.OSTROM_LOAD_MCP_DEADLINE_MS || 5000);
const unexpected = new Counter('mcp_unexpected');
const tls = Object.fromEntries(['connections', 'handshakes', 'resumed', 'requests'].map((k) => [k, new Gauge(`mcp_tls_${k}`)]));
// The first unexpected answers of each VU are printed; past them, only counted (run 41539188060 printed 61 000).
const WARNINGS = 5;
let warned = 0;

export const options = {
  scenarios: {
    fast: { executor: 'constant-arrival-rate', rate: 3, timeUnit: '2s', duration: DURATION, preAllocatedVUs: 4, maxVUs: 4, exec: 'fast' },
    slow: { executor: 'constant-vus', vus: 2, duration: DURATION, exec: 'slow' },
    hang: { executor: 'constant-vus', vus: 1, duration: DURATION, exec: 'hang' },
    down: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '2s', duration: DURATION, preAllocatedVUs: 2, maxVUs: 2, exec: 'down' },
  },
  thresholds: {
    mcp_unexpected: ['count==0'],
    'http_req_duration{name:mcp-fast}': ['p(95)<250'],
    'http_req_duration{name:mcp-slow}': ['p(95)<10000'],
    // The deadline, plus what the relay needs to answer.
    'http_req_duration{name:mcp-hang}': [`max<${DEADLINE_MS + 2000}`],
    'http_req_duration{name:mcp-down}': ['p(95)<1000'],
  },
};

export function setup() {
  requireRelayToken('the MCP relay');
  resetFake();
}

export function teardown() {
  const seen = fakeStats();
  if (!seen || !seen.tls) return console.warn('mcp: no TLS counts from the fakes');
  for (const [k, gauge] of Object.entries(tls)) gauge.add(seen.tls[k] || 0);
  const per = seen.tls.requests > 0 ? (seen.tls.handshakes / seen.tls.requests).toFixed(2) : 'n/a';
  console.log(`mcp tls: ${JSON.stringify(seen.tls)}, ${per} handshakes per request`);
}

/** Calls `echo` on `server` and checks the answer is a success (`ok`) or a tool error (not ok), never anything else. */
function echo(server, ok) {
  const r = callTool(server, 'echo', { text: 'k6' }, `mcp-${server}`, { timeout: `${Math.ceil(DEADLINE_MS / 1000) + 30}s` });
  const result = rpcResult(r);
  const good = result !== null && (ok ? result.isError !== true && JSON.stringify(result.content).includes('k6') : result.isError === true);
  if (!check(r, { [`mcp ${server} ${ok ? 'answers' : 'fails as a tool error'}`]: () => good })) {
    unexpected.add(1, { server });
    if (warned++ < WARNINGS) console.warn(`mcp ${server}: ${r.status} ${String(r.body).slice(0, 300)}`);
    // A constant-VU scenario that fails at once would otherwise spin.
    sleep(0.5);
  }
}

export function fast() {
  echo('fast', true);
}

export function slow() {
  echo('slow', true);
}

export function hang() {
  echo('hang', false);
}

export function down() {
  echo('down', false);
}
