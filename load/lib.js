// Shared helpers of the k6 load tests of the Ostrom server, written against the contract ostrom-core/api/openapi.yaml
// (`/api/v1/...`; the server's liveness probe stays `/health`). Override a route with OSTROM_ROUTE_* in the workflow
// rather than editing the scenarios.
// Tokens: OSTROM_LOAD_TOKEN asks the gates (a device token of the requester), OSTROM_LOAD_APPROVER_TOKEN says yes
// (a person who approves the gate of OSTROM_LOAD_REPO and is not the requester). The workflow creates both before k6.
import exec from 'k6/execution';
import http from 'k6/http';

export const BASE = (__ENV.OSTROM_URL || 'http://127.0.0.1:4600').replace(/\/$/, '');
export const ROUTES = {
  health: __ENV.OSTROM_ROUTE_HEALTH || '/health',
  instance: __ENV.OSTROM_ROUTE_INSTANCE || '/api/v1/instance',
  gates: __ENV.OSTROM_ROUTE_GATES || '/api/v1/gates',
  answer: __ENV.OSTROM_ROUTE_ANSWER || '/api/v1/approvals/{id}/answer',
  receipt: __ENV.OSTROM_ROUTE_RECEIPT || '/api/v1/receipts/{id}',
};
export const REPO = __ENV.OSTROM_LOAD_REPO || 'acme/api';
const ASKER = __ENV.OSTROM_LOAD_TOKEN || '';
const APPROVER = __ENV.OSTROM_LOAD_APPROVER_TOKEN || '';

export function headers(token) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export function route(name, id) {
  return BASE + ROUTES[name].replace('{id}', encodeURIComponent(id || ''));
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

// Boundary actions a hook asks about, most of them ungated (answered at once) and one gated push to main.
const ACTIONS = [
  { class: 'test.run', command: 'npm test' },
  { class: 'git.push', command: 'git push origin feat/x', ref: 'refs/heads/feat/x' },
  { class: 'deploy', command: 'helm upgrade api ./chart --dry-run' },
  { class: 'fs.delete', command: 'rm -rf build' },
];
export function action(i) {
  return ACTIONS[i % ACTIONS.length];
}

/** Asks the gate of an action (POST /api/v1/gates, hook PreToolUse). */
export function ask(a, n, tag) {
  const body = { repo: REPO, class: a.class, tool: 'Bash', command: a.command };
  if (a.class === 'git.push') body.push = { remote: 'origin', refs: [{ ref: a.ref, sha: sha(n) }] };
  return http.post(route('gates'), JSON.stringify(body), { headers: headers(ASKER), tags: { name: tag } });
}

/** Asks for a push to main: always gated, returns the response (approval in `approval`). */
export function askPushToMain(n, tag) {
  return ask({ class: 'git.push', command: 'git push origin main', ref: 'refs/heads/main' }, n, tag);
}

/** Says yes to an approval (POST /api/v1/approvals/{id}/answer) as the approver. */
export function approve(approval, tag) {
  const body = { answer: 'approve', shownDigest: approval.shownDigest };
  return http.post(route('answer', approval.id), JSON.stringify(body), { headers: headers(APPROVER), tags: { name: tag } });
}

/** Stops the run at once, with the reason, when a scenario that asks gates has no tokens (else: 401s and vague thresholds). */
export function requireTokens(why) {
  const missing = [['OSTROM_LOAD_TOKEN', ASKER], ['OSTROM_LOAD_APPROVER_TOKEN', APPROVER]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) exec.test.abort(`${why} needs ${missing.join(' and ')} (a requester and an approver of ${REPO}; templates/README.md)`);
}

/** The scenarios named by OSTROM_LOAD_SCENARIOS (all of `known` when unset). */
export function pick(known) {
  return (__ENV.OSTROM_LOAD_SCENARIOS || known.join(',')).split(',').map((s) => s.trim()).filter((s) => known.includes(s));
}
