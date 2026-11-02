// SPDX-License-Identifier: Apache-2.0
// The k6 table of a job summary: p95, p99, error rate and requests/s of every `http_req_duration` metric (the whole run
// and each tagged sub-metric a threshold names) of the summaries given, from `k6 run --summary-export` run with
// `--summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)"`. A summary that is not there is listed as not run.
// Usage: node scripts/k6-summary.ts "smoke=smoke-summary.json" "gates=gates-summary.json" >> "$GITHUB_STEP_SUMMARY"
import { existsSync, readFileSync } from 'node:fs';

interface Metric {
  readonly 'p(95)'?: number;
  readonly 'p(99)'?: number;
  readonly value?: number;
  readonly rate?: number;
}

const ms = (v: number | undefined) => (v === undefined ? '' : v.toFixed(1));
const pct = (v: number | undefined) => (v === undefined ? '' : `${(v * 100).toFixed(2)} %`);

let out = '| script | metric | p95 (ms) | p99 (ms) | errors | req/s |\n|---|---|---|---|---|---|\n';
for (const arg of process.argv.slice(2)) {
  const at = arg.indexOf('=');
  const label = arg.slice(0, at);
  const file = arg.slice(at + 1);
  if (!existsSync(file)) {
    out += `| ${label} | not run | | | | |\n`;
    continue;
  }
  const metrics = (JSON.parse(readFileSync(file, 'utf8')) as { metrics: Record<string, Metric> }).metrics;
  for (const [name, trend] of Object.entries(metrics).filter(([k]) => k.startsWith('http_req_duration'))) {
    const tag = name.slice('http_req_duration'.length);
    const failed = metrics[`http_req_failed${tag}`] ?? (tag === '' ? metrics['http_req_failed'] : undefined);
    const reqs = metrics[`http_reqs${tag}`] ?? (tag === '' ? metrics['http_reqs'] : undefined);
    out += `| ${label} | ${tag || 'all'} | ${ms(trend['p(95)'])} | ${ms(trend['p(99)'])} | ${pct(failed?.value)} | ${reqs?.rate === undefined ? '' : reqs.rate.toFixed(1)} |\n`;
  }
}
process.stdout.write(out);
