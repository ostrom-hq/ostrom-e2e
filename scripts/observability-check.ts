// SPDX-License-Identifier: Apache-2.0
// Runs the queries of ostrom-infra's alerts and "Ostrom — Product" dashboard (observability/alerts.py and
// dashboards.py, `$__rate_interval` read as 5m) against the Prometheus of the chart load pass, fed by the real server
// through an OpenTelemetry Collector (load/observability/kind.yaml), and writes a job summary table: which query sees
// data, and its value. Copied from ostrom-infra: change a query in both places.
// Fails when the server sends no series at all (the metrics path is broken), or when a query named in
// OSTROM_OBS_REQUIRED (comma-separated ids, e.g. `gates-pending,sessions-active-local`) has no data.
// Usage: OSTROM_PROMETHEUS_URL=http://127.0.0.1:19090 node scripts/observability-check.ts >> "$GITHUB_STEP_SUMMARY"
const SERVER = 'job="ostrom/ostrom-server"';
const prometheus = process.env['OSTROM_PROMETHEUS_URL'] ?? 'http://127.0.0.1:19090';
const required = new Set((process.env['OSTROM_OBS_REQUIRED'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const quantile = (q: number, metric: string, by: string) =>
  `histogram_quantile(${q}, sum by (le, ${by}) (rate(${metric}_bucket{${SERVER}}[5m])))`;

const QUERIES: ReadonlyArray<readonly [id: string, where: string, query: string]> = [
  ['server-requests', 'pipeline', `sum(http_server_request_duration_seconds_count{${SERVER}})`],
  ['gates-pending', 'alert ostrom-gates-pending', `max(ostrom_gates_pending{${SERVER}})`],
  [
    'cloud-saturation',
    'alert ostrom-cloud-sessions-saturated',
    `max(ostrom_sessions_active{${SERVER}, where="cloud"}) / clamp_min(max(ostrom_sessions_cloud_capacity{${SERVER}}), 1)`,
  ],
  ['gates-requested', 'Gates requested by kind', `sum by (kind) (increase(ostrom_gates_requested_total{${SERVER}}[5m]))`],
  [
    'gates-answered',
    'Gates answered',
    `sum by (answer, channel) (increase(ostrom_gates_answered_total{${SERVER}}[5m]))`,
  ],
  ['gates-time-to-answer', 'Time to answer p95', quantile(0.95, 'ostrom_gates_time_to_answer_seconds', 'answer')],
  [
    'sessions-started',
    'Agent sessions started',
    `sum by (agent, where) (increase(ostrom_sessions_started_total{${SERVER}}[5m]))`,
  ],
  ['sessions-active-local', 'Agent sessions running (local)', `max(ostrom_sessions_active{${SERVER}, where="local"})`],
  ['sessions-active-cloud', 'Cloud session pods (active)', `max(ostrom_sessions_active{${SERVER}, where="cloud"})`],
  ['cloud-capacity', 'Cloud session pods (capacity)', `max(ostrom_sessions_cloud_capacity{${SERVER}})`],
  [
    'inference-cost',
    'Inference cost (USD per hour)',
    `sum by (source, provider) (rate(ostrom_inference_cost_usd_total{${SERVER}}[1h])) * 3600`,
  ],
  [
    'inference-tokens',
    'Tokens per minute',
    `sum by (type, provider) (rate(ostrom_inference_tokens_total{${SERVER}}[5m])) * 60`,
  ],
  ['inference-latency', 'Model call latency p95', quantile(0.95, 'ostrom_inference_duration_seconds', 'source, provider')],
];

interface Sample {
  readonly metric: Record<string, string>;
  readonly value: readonly [number, string];
}

async function query(expr: string): Promise<Sample[]> {
  const res = await fetch(`${prometheus}/api/v1/query?query=${encodeURIComponent(expr)}`);
  const body = (await res.json()) as { status: string; error?: string; data?: { result: Sample[] } };
  if (body.status !== 'success') throw new Error(`${expr}: ${body.error ?? res.status}`);
  return body.data?.result ?? [];
}

const show = (s: Sample) => {
  const labels = Object.entries(s.metric).map(([k, v]) => `${k}=${v}`).join(' ');
  return `${labels ? `${labels}: ` : ''}${Number(s.value[1]).toPrecision(4)}`;
};

let out = '### Metrics seen by the alert and dashboard queries\n\n| id | used by | data |\n|---|---|---|\n';
const missing: string[] = [];
for (const [id, where, expr] of QUERIES) {
  const samples = await query(expr);
  if (samples.length === 0 && (required.has(id) || id === 'server-requests')) missing.push(id);
  out += `| ${id}${required.has(id) ? ' (required)' : ''} | ${where} | ${samples.length ? samples.map(show).join('<br>') : 'no data'} |\n`;
}
const names = await query(`count by (__name__) ({${SERVER}, __name__=~"ostrom_.*"})`);
out += `\nostrom_* series sent by the server: ${names.map((s) => s.metric['__name__']).sort().join(', ') || 'none'}\n`;
process.stdout.write(out);
if (missing.length) {
  process.stderr.write(`::error title=observability::no data for ${missing.join(', ')}\n`);
  process.exitCode = 1;
}
