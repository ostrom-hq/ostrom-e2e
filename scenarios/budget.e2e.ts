// SPDX-License-Identifier: Apache-2.0
// E2E-BUDGET : the organization's monthly budget, enforced by the gateway on a model call (PARCOURS 3.5;
// ostrom-server#133, contract core#55, recipe of SPEND-GUARD at JOURNAL 02/11 23:43). The gateway checks the budget
// before it looks for an account or a key: a call that may cost more than what is left is refused, « Budget left too
// low for this call », without `Retry-After`. A spend the provider really billed (the fake provider of
// src/fake-tokens.ts, OSTROM_GATEWAY_ANTHROPIC_URL) that reaches the limit refuses the next call, « Monthly budget
// reached », with `Retry-After` until the month's end. Both are 429 in Anthropic's error shape (`rate_limit_error`).
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeTokens } from '../src/fake-tokens.ts';
import { isServed } from '../src/probe.ts';
import { FAKE_TOKENS_PORT, SERVER_URL } from './env.ts';
import { call, email, orgOf, orgsUnavailable, signIn, url } from './org.ts';

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
  afterAll(() => provider.stop());

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
    await provider.start(FAKE_TOKENS_PORT);
    const { c, agentToken } = await orgWithBudget('budget-002');
    // A shared Claude account of the organization, its access token valid for hours (no refresh on the way).
    const shared = await call(c, 'POST', '/api/v1/accounts', {
      provider: 'claude', label: 'Max of budget-002', providerAccountId: `acct-budget-${randomUUID()}`,
      accessToken: `at-budget-${randomUUID()}`, refreshToken: `rt-budget-${randomUUID()}`, expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
    });
    expect(shared.status, JSON.stringify(shared.body)).toBeLessThan(300);
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
});
