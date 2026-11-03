// SPDX-License-Identifier: Apache-2.0
// Registered runners (`ostrom-runner machine`) beating at once: each virtual user is one runner, which sends its
// heartbeat with an empty report (a machine with Docker that runs no session yet) every OSTROM_LOAD_RUNNER_INTERVAL
// seconds (5 by default, the shortest cadence used in the console journey; 20 s is the runner's default), for
// OSTROM_LOAD_DURATION. The first OSTROM_LOAD_RUNNERS runners of $OSTROM_LOAD_RUNNERS_FILE (scripts/runners-load-setup.ts).
// The job samples the server pods' CPU and memory meanwhile (chart-load.yml).
import http from 'k6/http';
import { check, sleep } from 'k6';

const RUNNERS = Number(__ENV.OSTROM_LOAD_RUNNERS || 100);
const INTERVAL = Number(__ENV.OSTROM_LOAD_RUNNER_INTERVAL || 5);
const BASE = (__ENV.OSTROM_URL || 'http://localhost:8080').replace(/\/$/, '');
const runners = JSON.parse(open(__ENV.OSTROM_LOAD_RUNNERS_FILE)).slice(0, RUNNERS);

export const options = {
  scenarios: {
    beats: { executor: 'constant-vus', vus: RUNNERS, duration: __ENV.OSTROM_LOAD_DURATION || '2m', gracefulStop: '15s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:heartbeat}': ['p(95)<100'],
  },
};

const body = JSON.stringify({ executions: [], workspaces: [] });

export default function () {
  const runner = runners[(__VU - 1) % runners.length];
  // Spread over the interval, as machines started at different times are.
  if (__ITER === 0) sleep(Math.random() * INTERVAL);
  const r = http.post(`${BASE}/api/v1/runners/${runner.id}/heartbeat`, body, {
    headers: { authorization: `Bearer ${runner.token}`, 'content-type': 'application/json' },
    tags: { name: 'heartbeat' },
  });
  check(r, { 'heartbeat 200': (res) => res.status === 200 });
  sleep(INTERVAL);
}
