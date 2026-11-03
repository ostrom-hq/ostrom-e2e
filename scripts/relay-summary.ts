// SPDX-License-Identifier: Apache-2.0
// The job summary of the gateway and relay load pass (chart-load.yml):
// - the gateway's overhead, gateway minus direct, at p50, p95 and p99 of the first byte (`http_req_waiting`) and of
//   the end (`http_req_duration`), JSON and stream, from load/inference.js's `--summary-export`;
// - the memory of each server pod while streams are held open (load/streams.js): its peak in the phase (and the 20 s
//   after, `kubectl top` lags), against its level at rest in the 30 s before the first phase, and what each open
//   stream costs (the streams spread over the replicas). The same rest for every phase: memory freed by the 50 streams
//   is not given back to the system in 30 s, and a later phase's own "before" would hide what the streams cost;
// With `--check`, exits 1 when an overhead at p95 is over OSTROM_LOAD_MAX_OVERHEAD_MS (15), or cannot be computed
// (a series or a statistic missing from the summary): a check that checks nothing is not a pass.
// Usage: node scripts/relay-summary.ts [--check] inference-summary.json top-samples.txt phases.txt [replicas]
//   phases.txt: one `<name> <streams> <start epoch s> <end epoch s>` line per phase of load/streams.js.
import { existsSync, readFileSync } from 'node:fs';

type Trend = Record<string, number | undefined>;
const MAX_OVERHEAD_MS = Number(process.env['OSTROM_LOAD_MAX_OVERHEAD_MS'] ?? '15');
const args = process.argv.slice(2);
const check = args[0] === '--check';
const [inferenceFile = '', samplesFile = '', phasesFile = '', replicasArg = '2'] = check ? args.slice(1) : args;
const ms = (v: number | undefined) => (v === undefined ? '' : v.toFixed(1));
let failed = false;
let out = '';

if (existsSync(inferenceFile)) {
  const metrics = (JSON.parse(readFileSync(inferenceFile, 'utf8')) as { metrics: Record<string, Trend> }).metrics;
  out += '#### Gateway overhead (gateway minus direct, same fake provider, same ingress)\n\n';
  out += '| call | measure | direct p50 / p95 / p99 (ms) | gateway p50 / p95 / p99 (ms) | overhead p50 / p95 / p99 (ms) |\n|---|---|---|---|---|\n';
  for (const kind of ['json', 'sse']) {
    for (const [measure, metric] of [['first byte', 'http_req_waiting'], ['end', 'http_req_duration']] as const) {
      const direct = metrics[`${metric}{name:direct-${kind}}`];
      const gateway = metrics[`${metric}{name:gateway-${kind}}`];
      const stats = ['med', 'p(95)', 'p(99)'];
      if (!direct || !gateway || stats.some((s) => typeof direct[s] !== 'number' || typeof gateway[s] !== 'number')) {
        failed = true;
        out += `| ${kind} | ${measure} | missing | missing | not computed |\n`;
        continue;
      }
      const diff = stats.map((s) => (gateway[s] as number) - (direct[s] as number));
      const over = (diff[1] as number) > MAX_OVERHEAD_MS;
      failed ||= over;
      out += `| ${kind} | ${measure} | ${stats.map((s) => ms(direct[s])).join(' / ')} | ${stats.map((s) => ms(gateway[s])).join(' / ')} | ${diff.map((d) => ms(d)).join(' / ')}${over ? ` (over ${MAX_OVERHEAD_MS} ms at p95)` : ''} |\n`;
    }
  }
  out += '\n';
} else {
  failed = true;
  out += `Gateway overhead: not run (${inferenceFile || 'no summary'}).\n\n`;
}

interface Sample {
  readonly ts: number;
  readonly pod: string;
  readonly mib: number;
}

if (existsSync(samplesFile) && existsSync(phasesFile)) {
  const samples: Sample[] = readFileSync(samplesFile, 'utf8')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length >= 5 && f[2]?.includes('-server-'))
    .map((f) => ({ ts: Number(f[0]), pod: f[2] as string, mib: Number(String(f[4]).replace(/Mi$/, '')) }));
  const replicas = Number(replicasArg);
  out += '#### Memory of the server pods while streams are open (limit 256 Mi)\n\n';
  out += '| phase | pod | at rest (Mi) | peak (Mi) | per open stream (KiB) |\n|---|---|---|---|---|\n';
  const phases = readFileSync(phasesFile, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => l.trim().split(/\s+/));
  const first = Math.min(...phases.map((f) => Number(f[2] ?? '0')));
  for (const [name = '', streams = '0', start = '0', end = '0'] of phases) {
    const [from, to] = [Number(start), Number(end) + 20];
    for (const pod of [...new Set(samples.map((s) => s.pod))].sort()) {
      const mine = samples.filter((s) => s.pod === pod);
      const rest = mine.filter((s) => s.ts >= first - 30 && s.ts < first).map((s) => s.mib);
      const during = mine.filter((s) => s.ts >= from && s.ts <= to).map((s) => s.mib);
      if (during.length === 0) continue;
      const base = rest.length ? Math.min(...rest) : Math.min(...during);
      const peak = Math.max(...during);
      const perStream = ((peak - base) * 1024) / (Number(streams) / replicas);
      // Under its rest: the pod restarted in the phase, and the figure means nothing.
      out += `| ${name} (${streams} streams) | ${pod} | ${base} | ${peak} | ${peak < base ? 'n/a (restarted)' : perStream.toFixed(0)} |\n`;
    }
  }
  out += '\n';
} else {
  out += 'Memory per open stream: no samples or no phases.\n\n';
}

process.stdout.write(out);
if (check && failed) {
  process.stderr.write(`The gateway's overhead at p95 is over ${MAX_OVERHEAD_MS} ms.\n`);
  process.exit(1);
}
