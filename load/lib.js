// Shared helpers of the k6 load tests of the Ostrom server.
// Routes default to the control-server spec of the prototype study (research/perf-langages/controle/SPEC.md):
// POST /check, POST /gate, POST /approve, GET /receipts/:id, GET /health. When ostrom-server fixes its public routes,
// override them with the OSTROM_ROUTE_* variables in the workflow rather than editing the scenarios.
import http from 'k6/http';

export const BASE = (__ENV.OSTROM_URL || 'http://127.0.0.1:4600').replace(/\/$/, '');
export const ROUTES = {
  health: __ENV.OSTROM_ROUTE_HEALTH || '/health',
  check: __ENV.OSTROM_ROUTE_CHECK || '/check',
  gate: __ENV.OSTROM_ROUTE_GATE || '/gate',
  approve: __ENV.OSTROM_ROUTE_APPROVE || '/approve',
  receipt: __ENV.OSTROM_ROUTE_RECEIPT || '/receipts/',
};
export const ORGS = Number(__ENV.OSTROM_LOAD_ORGS || 10);
const TOKEN = __ENV.OSTROM_LOAD_TOKEN || '';

export function headers(extra) {
  const h = { 'content-type': 'application/json' };
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  return Object.assign(h, extra || {});
}

export function org(i) {
  return `org-${String(i % ORGS).padStart(4, '0')}`;
}

export function sha(n) {
  // 40 hex characters, unique per (vu, iteration).
  let s = '';
  let x = n >>> 0;
  while (s.length < 40) {
    x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    s += x.toString(16).padStart(8, '0');
  }
  return s.slice(0, 40);
}

const COMMANDS = ['git push origin main', 'npm test', 'helm upgrade api ./chart', 'ls -la', 'git status', 'rm -rf build'];
export function command(i) {
  return COMMANDS[i % COMMANDS.length];
}

export function post(route, body, tag) {
  return http.post(BASE + route, JSON.stringify(body), { headers: headers(), tags: { name: tag } });
}
