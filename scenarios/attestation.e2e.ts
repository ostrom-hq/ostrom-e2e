// SPDX-License-Identifier: Apache-2.0
// E2E-ATT : where a check run comes from, as decided on 30/10 at 13:23 (JOURNAL) and written in the contract (core#40,
// `CheckAttestation`, `ReceiptNode.attestation`, `RuleGateCheck.attested`). A check the workstation reports is
// `workstation_declared`: it says so in the signed receipt, the workstation can never claim more, and a rule gate that
// asks for an attested run is not satisfied by a declaration. Each scenario switches itself on when its routes are
// served (launches of SRV-LANCEUR, checks and workflow receipts of ostrom-server#78, rules of SRV-REGLES-2).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Caller } from '../src/isolation.ts';
import { isServed } from '../src/probe.ts';
import { SERVER_URL } from './env.ts';
import { type Org, type Person, call, email, orgOf, orgsUnavailable, signIn } from './org.ts';

const ORGS = await orgsUnavailable();
const ID = randomUUID();
const T = 120_000;

async function needs(...routes: [string, string][]): Promise<string> {
  if (ORGS !== '') return ORGS;
  const missing: string[] = [];
  for (const [method, path] of routes) if (!(await isServed(SERVER_URL, path.replaceAll('{id}', ID), method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}
const named = (title: string, why: string) => (why ? `${title} (skipped: ${why})` : title);

interface Owner {
  readonly person: Person;
  readonly org: Org;
  readonly c: Caller;
}

async function owner(who: string): Promise<Owner> {
  const person = await signIn(email(who));
  const org = await orgOf(person);
  return { person, org, c: { ...person.caller, org: org.id } };
}

function itemsOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const list = (body as Record<string, unknown> | undefined)?.['items'];
  expect(Array.isArray(list), `no items in ${JSON.stringify(body)}`).toBe(true);
  return list as Record<string, unknown>[];
}

/** The check nodes of a signed receipt, wherever the receipt nests them (`nodes`, `workflow.nodes`). */
function checkNodes(receipt: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o['kind'] === 'check' && typeof o['id'] === 'string') found.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(receipt);
  return found;
}

/** A rule whose gate on pushes to main of [repo] asks for the `tests` check, attested (contract RuleGate.checks). */
const ruleAskingAttested = (repo: string) => ({
  statement: 'Tests run by Ostrom or the CI before a push to main',
  group: 'git',
  scope: [repo],
  gate: { actions: [{ class: 'push-main', label: 'Push to main', patterns: [], repos: [repo] }], approvers: [], checks: [{ check: 'tests', attested: true }] },
});

/** The id the compiler gave the script of check node `nodeId` (`s-<node>`, PackageCompiler.kt), read in the package. */
function scriptOf(body: unknown, nodeId: string): string {
  const seen: unknown[] = [body];
  while (seen.length > 0) {
    const v = seen.pop();
    if (Array.isArray(v)) seen.push(...(v as unknown[]));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o['nodeId'] === nodeId && typeof o['id'] === 'string' && typeof o['path'] === 'string') return o['id'];
      seen.push(...Object.values(o));
    }
  }
  return `s-${nodeId}`;
}

/**
 * An accepted workflow with one check node (`tests`, `npm test`), its current package, a launch and its session, and
 * the agent's caller: what a workstation has when it reports a check.
 */
async function sessionWithCheck(who: string) {
  const a = await owner(who);
  const workflowId = `att-${randomUUID().slice(0, 8)}`;
  const made = await call(a.c, 'POST', '/api/v1/workflows', {
    id: workflowId, name: 'tests before push', domain: 'delivery', status: 'accepted', foundAt: new Date().toISOString(),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Session start' },
      { id: 'tests', kind: 'check', label: 'Tests', run: { command: 'npm test' } },
    ],
    edges: [{ from: 'start', to: 'tests' }],
  });
  expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
  const pkg = await call(a.c, 'GET', '/api/v1/packages/current');
  expect(pkg.status, JSON.stringify(pkg.body)).toBe(200);
  const digest = String(pkg.body['digest'] ?? (pkg.body['package'] as Record<string, unknown> | undefined)?.['digest'] ?? '');
  // The server serves the digest as bare hex (run 41483058195); a `sha256:` prefix is accepted too.
  expect(digest).toMatch(/^(sha256:)?[0-9a-f]{64}$/);
  const launch = await call(a.c, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/att' });
  expect(launch.status, JSON.stringify(launch.body)).toBe(201);
  const agent: Caller = { token: String(launch.body['agentToken']), org: a.org.id, ...(a.c.from ? { from: a.c.from } : {}) };
  // The agent's first hook opens the session of the launch (`POST /api/v1/sessions`, StartSessionRequest).
  const sessionId = randomUUID();
  const opened = await call(agent, 'POST', '/api/v1/sessions', { id: sessionId, launchId: launch.body['launchId'], repo: 'acme/att', agent: 'claude', packageDigest: digest });
  expect(opened.status, JSON.stringify(opened.body)).toBeLessThan(300);
  return { a, agent, digest, sessionId, scriptId: scriptOf(pkg.body, 'tests') };
}

const W001 = await needs(['POST', '/api/v1/workflows'], ['GET', '/api/v1/packages/current'], ['POST', '/api/v1/launches'], ['POST', '/api/v1/checks'], ['GET', '/api/v1/checks'], ['POST', '/api/v1/sessions/{id}/workflow-receipt']);
const W003 = await needs(['POST', '/api/v1/rules'], ['POST', '/api/v1/gates'], ['POST', '/api/v1/launches'], ['POST', '/api/v1/checks']);

describe('E2E-ATT: the attestation of a check run (decision 30/10 13:23, contract core#40)', () => {
  it.skipIf(W001 !== '')(named('E2E-ATT-001 a check the workstation reports is `workstation_declared` in the signed receipt, which verifies', W001), async () => {
    const { a, agent, digest, sessionId, scriptId } = await sessionWithCheck('att-001');
    const reported = await call(agent, 'POST', '/api/v1/checks', { sessionId, digest, nodeId: 'tests', scriptId, exit: 0, outcome: 'passed', durationMs: 1200 });
    expect(reported.status, JSON.stringify(reported.body)).toBe(201);
    const listed = itemsOf((await call(a.c, 'GET', `/api/v1/checks?sessionId=${encodeURIComponent(sessionId)}`)).body);
    expect(listed.map((c) => c['id'])).toContain(reported.body['id']);
    // The workflow receipt is signed for an ended session only (409 « still open », run 41489078824).
    const ended = await call(agent, 'POST', `/api/v1/sessions/${sessionId}/end`, { exitCode: 0 });
    expect(ended.status, JSON.stringify(ended.body)).toBeLessThan(300);
    const receipt = await call(agent, 'POST', `/api/v1/sessions/${sessionId}/workflow-receipt`, { digest, agent: 'claude' });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    expect(receipt.body['verification']).toMatchObject({ ok: true });
    const checks = checkNodes(receipt.body['receipt']);
    expect(checks.length, JSON.stringify(receipt.body['receipt'])).toBeGreaterThan(0);
    for (const node of checks) expect(node['attestation'], JSON.stringify(node)).toBe('workstation_declared');
  }, T);

  it.skipIf(W001 !== '')(named('E2E-ATT-002 a workstation cannot claim `ci` or `isolated_runner`: the run stays declared', W001), async () => {
    const { agent, digest, sessionId, scriptId } = await sessionWithCheck('att-002');
    for (const claimed of ['ci', 'isolated_runner']) {
      const r = await call(agent, 'POST', '/api/v1/checks', { sessionId, digest, nodeId: 'tests', scriptId, exit: 0, outcome: 'passed', attestation: claimed });
      // Refused, or recorded without the claim: never recorded as attested.
      expect([201, 400, 422], JSON.stringify(r.body)).toContain(r.status);
      if (r.status === 201) expect(r.body['attestation'] ?? 'workstation_declared').toBe('workstation_declared');
    }
    // The workflow receipt is signed for an ended session only (409 « still open », run 41489078824).
    const ended = await call(agent, 'POST', `/api/v1/sessions/${sessionId}/end`, { exitCode: 0 });
    expect(ended.status, JSON.stringify(ended.body)).toBeLessThan(300);
    const receipt = await call(agent, 'POST', `/api/v1/sessions/${sessionId}/workflow-receipt`, { digest, agent: 'claude' });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    for (const node of checkNodes(receipt.body['receipt'])) expect(node['attestation']).not.toMatch(/^(ci|isolated_runner)$/);
  }, T);

  // E2E-ATT-003 is split (JOURNAL 02/11 22:27). a: the rule keeps its gate's `checks` (RuleGateCheck, `attested`), since
  // ostrom-server#145 (b462063).
  it.skipIf(W003 !== '')(named('E2E-ATT-003a a rule gate keeps the checks it needs and their attestation', W003), async () => {
    const a = await owner('att-003a');
    const repo = `acme/att-${randomUUID().slice(0, 6)}`;
    const rule = await call(a.c, 'POST', '/api/v1/rules', ruleAskingAttested(repo));
    expect(rule.status, JSON.stringify(rule.body)).toBeLessThan(300);
    expect((rule.body['gate'] as Record<string, unknown> | undefined)?.['checks']).toEqual([{ check: 'tests', attested: true }]);
    const listed = await call(a.c, 'GET', '/api/v1/rules');
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const kept = itemsOf(listed.body).find((r) => r['id'] === rule.body['id']);
    expect((kept?.['gate'] as Record<string, unknown> | undefined)?.['checks'], JSON.stringify(kept)).toEqual([{ check: 'tests', attested: true }]);
  }, T);

  // b: the gate refuses a check the workstation only declared. Known gap: the gate does not enforce the attestation yet;
  // it waits for the SRV-REGLES-2 PR that makes it (JOURNAL 02/11 22:27, after server#81; no PR open yet). `it.fails`
  // until then: remove `.fails` when it merges.
  (W003 !== '' ? it.skip : it.fails)(named('E2E-ATT-003b a rule gate asking for an attested check is not satisfied by a declared run', W003), async () => {
    const { a, agent, digest, sessionId, scriptId } = await sessionWithCheck('att-003b');
    const repo = `acme/att-${randomUUID().slice(0, 6)}`;
    const rule = await call(a.c, 'POST', '/api/v1/rules', ruleAskingAttested(repo));
    expect(rule.status, JSON.stringify(rule.body)).toBeLessThan(300);
    expect((await call(agent, 'POST', '/api/v1/checks', { sessionId, digest, nodeId: 'tests', scriptId, exit: 0, outcome: 'passed' })).status).toBe(201);
    const sha = randomUUID().replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const asked = await call(agent, 'POST', '/api/v1/gates', { repo, class: 'git.push', tool: 'Bash', command: 'git push origin main', push: { remote: 'origin', refs: [{ ref: 'refs/heads/main', sha }] } });
    expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(500);
    // The push does not pass on a declaration: refused or waiting, and the answer says the check is only declared.
    expect(JSON.stringify(asked.body)).not.toMatch(/"(decision|status)":"(allow|allowed|approved)"/);
    expect(JSON.stringify(asked.body)).toMatch(/attest|declared/i);
  }, T);
});
