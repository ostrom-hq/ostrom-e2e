// SPDX-License-Identifier: Apache-2.0
// E2E-BUDGET : the organization's monthly budget, enforced by the gateway on a model call (PARCOURS 3.5;
// ostrom-server#133, contract core#55, recipe of SPEND-GUARD at JOURNAL 02/11 23:43). The gateway checks the budget
// before it looks for an account or a key: a call that may cost more than what is left is refused, « Budget left too
// low for this call », without `Retry-After`. A spend the provider really billed (the fake provider of
// src/fake-tokens.ts, OSTROM_GATEWAY_ANTHROPIC_URL) that reaches the limit refuses the next call, « Monthly budget
// reached », with `Retry-After` until the month's end. Both are 429 in Anthropic's error shape (`rate_limit_error`).
// E2E-PARC-047 : a person's budget by the day (ostrom-server#230), named by their member id. « block » refuses that
// person, « Daily budget reached », and no other member; « warn » lets the call through, shows the budget past in
// `/spending` (`exceeded`) and writes `budget.exceeded` to the org's audit log; another org sees none of it.
// E2E-PARC-048 : a workflow's budget (ostrom-server#337), named by the workflow's id (`subject`), counts the model calls
// of the launches that play it (`createLaunch.workflowId`, server#314). « block » refuses those calls only, « Monthly
// budget reached: this workflow's limit », and no session without the workflow or of another one; « warn » lets the
// call through, shows the budget past in `/spending` and writes `budget.exceeded` with `scope: workflow`.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeTokens } from '../src/fake-tokens.ts';
import { isServed } from '../src/probe.ts';
import { FAKE_TOKENS_PORT, MAIL_DIR, SERVER_URL } from './env.ts';
import { call, email, invite, join, membersOf, orgOf, orgsUnavailable, signIn, url } from './org.ts';

const T = 120_000;

async function unavailable(): Promise<string> {
  const orgs = await orgsUnavailable();
  if (orgs !== '') return orgs;
  const needed: [string, string][] = [['PUT', '/api/v1/budgets'], ['POST', '/api/v1/launches'], ['POST', '/api/v1/inference/v1/messages'], ['POST', '/api/v1/accounts']];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

const WHY = await unavailable();
const WHY_PROVIDER = WHY || (FAKE_TOKENS_PORT <= 0 ? 'no fake provider (OSTROM_E2E_FAKE_TOKENS_PORT)' : '');
const WHY_PERSON = WHY_PROVIDER || (MAIL_DIR === '' ? 'no OSTROM_E2E_MAIL_DIR' : '') || (await unservedPerson());

/** A person's budget, its `warn` and what is past a limit come with ostrom-server#230 (629ae71). */
async function unservedPerson(): Promise<string> {
  const needed: [string, string][] = [['GET', '/api/v1/spending'], ['GET', '/api/v1/audit'], ['GET', '/api/v1/orgs/{id}/members'], ['POST', '/api/v1/orgs/{id}/members/invites']];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

/** A workflow's budget needs the workflows, the spending and the audit log (ostrom-server#337, f031ec9 on main). */
async function unservedWorkflow(): Promise<string> {
  const needed: [string, string][] = [['POST', '/api/v1/workflows'], ['GET', '/api/v1/spending'], ['GET', '/api/v1/audit']];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}
const WHY_WORKFLOW = WHY_PROVIDER || (await unservedWorkflow());
const named = (title: string, why: string) => (why === '' ? title : `${title} (skipped: ${why})`);

/** An owner whose organization has a budget of $1 a month, hard stop, and the agent token of one of its launches. */
async function orgWithBudget(who: string) {
  const owner = await signIn(email(who));
  const org = await orgOf(owner);
  const c = { ...owner.caller, org: org.id };
  const budget = await call(c, 'PUT', '/api/v1/budgets', { scope: 'org', usdPerMonth: 1, hardStop: true });
  expect(budget.status, JSON.stringify(budget.body)).toBeLessThan(300);
  const launch = await call(c, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/budget' });
  expect(launch.status, JSON.stringify(launch.body)).toBe(201);
  return { owner, org, c, agentToken: String(launch.body['agentToken']) };
}

/** A shared Claude account of the organization, its access token valid for hours (no refresh on the way). */
async function sharedAccount(c: Parameters<typeof call>[0], label: string) {
  const shared = await call(c, 'POST', '/api/v1/accounts', {
    provider: 'claude', label, providerAccountId: `acct-budget-${randomUUID()}`,
    accessToken: `at-budget-${randomUUID()}`, refreshToken: `rt-budget-${randomUUID()}`, expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
  });
  expect(shared.status, JSON.stringify(shared.body)).toBeLessThan(300);
}

/** Reads `path` until `done` holds, ten seconds at most: the gateway writes its ledger after it has answered. */
async function readUntil(c: Parameters<typeof call>[0], path: string, done: (body: Record<string, unknown>) => boolean) {
  let r = await call(c, 'GET', path);
  for (let i = 0; i < 20 && r.status === 200 && !done(r.body); i++) {
    await sleep(500);
    r = await call(c, 'GET', path);
  }
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

/** A Messages call as Claude Code makes it through the gateway: the agent's token in `x-api-key`. */
async function infer(agentToken: string, maxTokens: number, messages: unknown[] = []) {
  const r = await fetch(url('/api/v1/inference/v1/messages'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': agentToken, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-5', max_tokens: maxTokens, messages }),
  });
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  const error = (body['error'] ?? {}) as { type?: string; message?: string };
  return { status: r.status, retryAfter: r.headers.get('retry-after'), body, error };
}

describe('E2E-BUDGET: the gateway keeps a model call within the monthly budget', () => {
  const provider = new FakeTokens();
  let listening = false;
  afterAll(() => provider.stop());
  /** One fake provider for the file: the server was started pointing at its one port. */
  async function listen() {
    if (!listening) await provider.start(FAKE_TOKENS_PORT);
    listening = true;
  }

  it.skipIf(WHY !== '')(named('E2E-BUDGET-001 a call that may cost more than the budget left is refused, « Budget left too low », and a smaller one is not', WHY), async () => {
    const { agentToken } = await orgWithBudget('budget-001');
    // claude-opus-5 bills $25 per million output tokens: 100 000 may cost $2.50, more than the $1 left.
    const big = await infer(agentToken, 100_000);
    expect(big.status, JSON.stringify(big.body)).toBe(429);
    expect(big.error.type).toBe('rate_limit_error');
    expect(big.error.message ?? '').toMatch(/^Budget left too low for this call: /);
    expect(big.retryAfter, 'a call that fits later needs no wait').toBeNull();
    // The same call asking for one token fits: the budget no longer refuses it (no account nor key here: not a 429).
    const small = await infer(agentToken, 1);
    expect(small.status, JSON.stringify(small.body)).not.toBe(429);
  }, T);

  it.skipIf(WHY_PROVIDER !== '')(named('E2E-BUDGET-002 a spend the provider billed past the budget refuses the next call, « Monthly budget reached », with Retry-After', WHY_PROVIDER), async () => {
    await listen();
    const { c, agentToken } = await orgWithBudget('budget-002');
    await sharedAccount(c, 'Max of budget-002');
    // The provider bills 300 000 input tokens ($1.50 at $5 per million): admitted on its small reserve, then billed.
    provider.usage = { input_tokens: 300_000, output_tokens: 1 };
    const hello = [{ role: 'user', content: 'hello' }];
    const first = await infer(agentToken, 1, hello);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(provider.calls).toHaveLength(1);
    // The gateway writes its ledger after it has answered (RelayInference.record, « a call already answered »): the
    // spend is read until it shows, ten seconds at most (once read as 0 at once, server#237's run 41633689763).
    let spending = await call(c, 'GET', '/api/v1/spending?period=month');
    for (let i = 0; i < 20 && spending.status === 200 && Number(spending.body['totalUsd']) < 1; i++) {
      await sleep(500);
      spending = await call(c, 'GET', '/api/v1/spending?period=month');
    }
    expect(spending.status, JSON.stringify(spending.body)).toBe(200);
    expect(Number(spending.body['totalUsd']), JSON.stringify(spending.body)).toBeGreaterThanOrEqual(1);
    // The budget is spent: the next call is refused before the provider, until the month's end.
    const next = await infer(agentToken, 1, hello);
    expect(next.status, JSON.stringify(next.body)).toBe(429);
    expect(next.error.type).toBe('rate_limit_error');
    expect(next.error.message ?? '').toMatch(/^Monthly budget reached: /);
    expect(Number(next.retryAfter), `retry-after ${next.retryAfter}`).toBeGreaterThan(0);
    expect(provider.calls, 'the refused call never reached the provider').toHaveLength(1);
  }, T);
  it.skipIf(WHY_PERSON !== '')(named('E2E-PARC-047 3.5 a person\u2019s daily budget: « block » refuses that person only, « warn » lets the call through, shows it past in /spending and writes the audit line', WHY_PERSON), async () => {
    await listen();
    const owner = await signIn(email('parc-047'));
    const org = await orgOf(owner);
    const c = { ...owner.caller, org: org.id };
    // The person is the owner, named by their member id (ostrom-server#230), alone in the org so far.
    const self = String((((await membersOf(owner, org.id))[0] ?? {}) as Record<string, unknown>)['id']);
    expect(self, 'the members list carries each member id').toMatch(/^[0-9a-f-]{36}$/);
    const daily = await call(c, 'PUT', '/api/v1/budgets', { scope: 'member', subject: self, usdPerDay: 1, hardStop: true });
    expect(daily.status, JSON.stringify(daily.body)).toBe(200);
    await sharedAccount(c, 'Max of parc-047');
    const launch = await call(c, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/parc-047' });
    expect(launch.status, JSON.stringify(launch.body)).toBe(201);
    const token = String(launch.body['agentToken']);
    const hello = [{ role: 'user', content: 'hello' }];

    // « block », by the day: $1.50 billed ($5 per million input tokens) spends the person's $1 of today.
    provider.usage = { input_tokens: 300_000, output_tokens: 1 };
    const before = provider.calls.length;
    const first = await infer(token, 1, hello);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    await readUntil(c, '/api/v1/spending?period=month', (b) => Number(b['totalUsd']) >= 1);
    const refused = await infer(token, 1, hello);
    expect(refused.status, JSON.stringify(refused.body)).toBe(429);
    expect(refused.error.type).toBe('rate_limit_error');
    expect(refused.error.message ?? '').toMatch(/^Daily budget reached: your limit of \$1\.00 a day is spent; it resets on \d{4}-\d{2}-\d{2}\.$/);
    expect(Number(refused.retryAfter), `retry-after ${refused.retryAfter}`).toBeGreaterThan(0);
    expect(Number(refused.retryAfter), 'at most until tomorrow').toBeLessThanOrEqual(86_400);
    expect(provider.calls.length - before, 'the refused call never reached the provider').toBe(1);

    // Another member of the same org is not held by that person's budget. The shared account was created without
    // `allowedMembers`, so it is lent to the whole org (SharedAccountPool.allowed, ostrom-server main): the gateway
    // leases it to that member too, and the call is served and counted under them, not under the owner.
    const otherEmail = email('parc-047-other');
    expect((await invite(owner, org.id, [otherEmail])).status).toBeLessThan(300);
    const { person: other, accepted } = await join(otherEmail);
    expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
    const otherId = String(((await membersOf(owner, org.id)) as Record<string, unknown>[]).find((m) => m['id'] !== self)?.['id']);
    expect(otherId).toMatch(/^[0-9a-f-]{36}$/);
    const otherLaunch = await call({ ...other.caller, org: org.id }, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/parc-047' });
    expect(otherLaunch.status, JSON.stringify(otherLaunch.body)).toBe(201);
    const person = (b: Record<string, unknown>, id: string) =>
      Number(((b['byPerson'] ?? []) as Record<string, unknown>[]).find((l) => l['key'] === id)?.['usd'] ?? 0);
    const ownerSpent = person(await call(c, 'GET', '/api/v1/spending?period=month').then((r) => r.body), self);
    expect(ownerSpent, 'the owner\u2019s $1.50').toBeGreaterThanOrEqual(1.5);
    // $0.50 billed ($5 per million input tokens) to the other member.
    provider.usage = { input_tokens: 100_000, output_tokens: 1 };
    const passes = await infer(String(otherLaunch.body['agentToken']), 1, hello);
    expect(passes.status, JSON.stringify(passes.body)).toBe(200);
    expect(provider.calls.length - before, 'served by the provider, on the shared account').toBe(2);
    const counted = await readUntil(c, '/api/v1/spending?period=month', (b) => person(b, otherId) >= 0.5);
    expect(person(counted, otherId), JSON.stringify(counted['byPerson'])).toBeGreaterThanOrEqual(0.5);
    expect(person(counted, self), 'nothing more under the owner').toBe(ownerSpent);

    // « warn », the same $1 a day: the call goes through although today is past it.
    const warn = await call(c, 'PUT', '/api/v1/budgets', { scope: 'member', subject: self, usdPerDay: 1, hardStop: false });
    expect(warn.status, JSON.stringify(warn.body)).toBe(200);
    expect(warn.body).toMatchObject({ scope: 'member', subject: self, usdPerDay: 1, hardStop: false });
    const through = await infer(token, 1, hello);
    expect(through.status, JSON.stringify(through.body)).toBe(200);
    // /spending shows the person's daily budget past its limit, as one that warns.
    const past = (b: Record<string, unknown>) => ((b['exceeded'] ?? []) as Record<string, unknown>[]).filter((e) => e['subject'] === self);
    const spending = await readUntil(c, '/api/v1/spending?period=month', (b) => past(b).some((e) => e['hardStop'] === false));
    expect(past(spending).filter((e) => e['hardStop'] === false)).toEqual([
      expect.objectContaining({ scope: 'member', subject: self, period: 'day', usd: 1, hardStop: false }),
    ]);
    // The audit line of the overrun, written by the budgets, under that person.
    const audited = await readUntil(c, '/api/v1/audit?event=budget.exceeded', (b) => ((b['items'] ?? []) as unknown[]).length > 0);
    const line = ((audited['items'] ?? []) as Record<string, unknown>[]).find((i) => String(i['subject']).includes(self));
    expect(line, JSON.stringify(audited)).toBeDefined();
    expect(line?.['event']).toBe('budget.exceeded');
    expect(line?.['meta']).toMatchObject({ scope: 'member', period: 'day', action: 'warn', limit_usd: '1' });

    // Another organization sees none of it: not the budget, not the overrun, not the line.
    const stranger = await signIn(email('parc-047-b'));
    const b = { ...stranger.caller, org: (await orgOf(stranger)).id };
    expect(JSON.stringify((await call(b, 'GET', '/api/v1/budgets')).body)).not.toContain(self);
    expect(JSON.stringify((await call(b, 'GET', '/api/v1/spending?period=month')).body)).not.toContain(self);
    const theirs = await call(b, 'GET', '/api/v1/audit?event=budget.exceeded');
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    expect(JSON.stringify(theirs.body)).not.toContain(self);
  }, 2 * T);

  it.skipIf(WHY_WORKFLOW !== '')(named('E2E-PARC-048 3.5 a workflow\u2019s monthly budget: « block » refuses the calls of its sessions only, « warn » lets them through, shows it past in /spending and writes the audit line', WHY_WORKFLOW), async () => {
    await listen();
    const owner = await signIn(email('parc-048'));
    const org = await orgOf(owner);
    const c = { ...owner.caller, org: org.id };
    // Two workflows of the org (contract `Workflow`: one trigger node); the budget names the first by its id.
    const workflow = (id: string, name: string) => ({ id, name, domain: 'git', nodes: [{ id: 'start', kind: 'trigger', label: 'Session start' }], edges: [], start: 'start', status: 'proposed', foundAt: new Date().toISOString() });
    const wid = `parc-048-${randomUUID().slice(0, 8)}`;
    const otherWid = `parc-048-${randomUUID().slice(0, 8)}`;
    for (const [id, name] of [[wid, 'Parc 048'], [otherWid, 'Parc 048 other']] as const) {
      const made = await call(c, 'POST', '/api/v1/workflows', workflow(id, name));
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    }
    // A tiny monthly budget on that workflow, that stops: one cent.
    const block = await call(c, 'PUT', '/api/v1/budgets', { scope: 'workflow', subject: wid, usdPerMonth: 0.01, hardStop: true });
    expect(block.status, JSON.stringify(block.body)).toBe(200);
    expect(block.body).toMatchObject({ scope: 'workflow', subject: wid, usdPerMonth: 0.01, hardStop: true });
    const items = (b: Record<string, unknown>) => ((b['items'] ?? []) as Record<string, unknown>[]).filter((i) => i['subject'] === wid);
    expect(items((await call(c, 'GET', '/api/v1/budgets')).body)).toEqual([expect.objectContaining({ scope: 'workflow', usdPerMonth: 0.01, hardStop: true })]);
    await sharedAccount(c, 'Max of parc-048');
    const launch = async (workflowId?: string) => {
      const r = await call(c, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/parc-048', ...(workflowId ? { workflowId } : {}) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return String(r.body['agentToken']);
    };
    const token = await launch(wid);
    const hello = [{ role: 'user', content: 'hello' }];

    // « block »: $1.50 billed ($5 per million input tokens) to a session of the workflow spends its cent.
    provider.usage = { input_tokens: 300_000, output_tokens: 1 };
    const before = provider.calls.length;
    const first = await infer(token, 1, hello);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    await readUntil(c, '/api/v1/spending?period=month', (b) => Number(b['totalUsd']) >= 1);
    const refused = await infer(token, 1, hello);
    expect(refused.status, JSON.stringify(refused.body)).toBe(429);
    expect(refused.error.type).toBe('rate_limit_error');
    expect(refused.error.message ?? '').toMatch(/^Monthly budget reached: this workflow's limit of \$0\.01 is spent; it resets on \d{4}-\d{2}-01\.$/);
    expect(Number(refused.retryAfter), `retry-after ${refused.retryAfter}`).toBeGreaterThan(0);
    expect(provider.calls.length - before, 'the refused call never reached the provider').toBe(1);

    // The workflow's budget holds its sessions only: the same person, in a session without a workflow or of another
    // workflow, is served (no org nor member budget here).
    provider.usage = { input_tokens: 10, output_tokens: 1 };
    for (const [what, other] of [['without a workflow', await launch()], ['of another workflow', await launch(otherWid)]] as const) {
      const passes = await infer(other, 1, hello);
      expect(passes.status, `${what}: ${JSON.stringify(passes.body)}`).toBe(200);
    }
    expect(provider.calls.length - before, 'both served by the provider').toBe(3);
    // And the workflow's own session is still refused.
    expect((await infer(token, 1, hello)).status).toBe(429);

    // « warn », the same cent a month: the call goes through although the month is past it.
    const warn = await call(c, 'PUT', '/api/v1/budgets', { scope: 'workflow', subject: wid, usdPerMonth: 0.01, hardStop: false });
    expect(warn.status, JSON.stringify(warn.body)).toBe(200);
    expect(warn.body).toMatchObject({ scope: 'workflow', subject: wid, usdPerMonth: 0.01, hardStop: false });
    const through = await infer(token, 1, hello);
    expect(through.status, JSON.stringify(through.body)).toBe(200);
    // /spending shows the workflow's budget past its limit, as one that warns.
    const past = (b: Record<string, unknown>) => ((b['exceeded'] ?? []) as Record<string, unknown>[]).filter((e) => e['subject'] === wid);
    const spending = await readUntil(c, '/api/v1/spending?period=month', (b) => past(b).some((e) => e['hardStop'] === false));
    expect(past(spending).filter((e) => e['hardStop'] === false)).toEqual([
      expect.objectContaining({ scope: 'workflow', subject: wid, period: 'month', usd: 0.01, hardStop: false }),
    ]);
    expect(((spending['exceeded'] ?? []) as Record<string, unknown>[]).some((e) => e['subject'] === otherWid), 'the other workflow has no budget').toBe(false);
    // The audit line of the overrun, written by the budgets, under that workflow.
    const audited = await readUntil(c, '/api/v1/audit?event=budget.exceeded', (b) => ((b['items'] ?? []) as unknown[]).length > 0);
    const line = ((audited['items'] ?? []) as Record<string, unknown>[]).find((i) => String(i['subject']).includes(wid));
    expect(line, JSON.stringify(audited)).toBeDefined();
    expect(line?.['event']).toBe('budget.exceeded');
    expect(line?.['meta']).toMatchObject({ scope: 'workflow', period: 'month', action: 'warn', limit_usd: '0.01' });

    // Another organization cannot budget that workflow (404, as a workflow it does not have) and sees none of it.
    const stranger = await signIn(email('parc-048-b'));
    const b = { ...stranger.caller, org: (await orgOf(stranger)).id };
    const foreign = await call(b, 'PUT', '/api/v1/budgets', { scope: 'workflow', subject: wid, usdPerMonth: 5, hardStop: true });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(JSON.stringify((await call(b, 'GET', '/api/v1/budgets')).body)).not.toContain(wid);
    expect(JSON.stringify((await call(b, 'GET', '/api/v1/spending?period=month')).body)).not.toContain(wid);
    const theirs = await call(b, 'GET', '/api/v1/audit?event=budget.exceeded');
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    expect(JSON.stringify(theirs.body)).not.toContain(wid);
  }, 2 * T);
});
