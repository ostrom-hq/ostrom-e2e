// E2E-BILL : billing (ostrom-server#15) from outside, on the server image, with stripe-mock behind it and the bench
// playing Stripe's webhooks. Each part switches itself on when its routes are on main (src/probe.ts).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isServed } from '../src/probe.ts';
import { stripeEvent, stripeSignature } from '../src/stripe.ts';
import { SERVER_URL, STRIPE_WEBHOOK_SECRET } from './env.ts';
import { BILLING, STRIPE_WEBHOOK, call, email, orgOf, orgsUnavailable, signIn, url } from './org.ts';

const WEBHOOK_SERVED = SERVER_URL !== '' && (await isServed(SERVER_URL, STRIPE_WEBHOOK, 'POST'));
const ROUTES_SERVED = SERVER_URL !== '' && (await isServed(SERVER_URL, BILLING(randomUUID())));
const ORGS = ROUTES_SERVED ? await orgsUnavailable() : 'billing routes not served yet';
const INVALID_SIGNATURE = { error: { type: 'invalid_request', message: 'Invalid Stripe signature.' } };

const post = (body: string, signature?: string) =>
  fetch(url(STRIPE_WEBHOOK), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature === undefined ? {} : { 'stripe-signature': signature }) },
    body,
  });

describe.skipIf(!WEBHOOK_SERVED || STRIPE_WEBHOOK_SECRET === '')('E2E-BILL: Stripe webhook', () => {
  it('E2E-BILL-001 a signed event is received once: an event of no organization ignored, the same event id a duplicate', async () => {
    // No customer and no org_id: billing has nothing to act on. (An unknown org_id is processed: billing makes the
    // organization's billing row on the fly, ostrom-server#15 `findBilling`; JOURNAL 07:10 QA → BILLING.)
    const id = `evt_e2e_${randomUUID().replaceAll('-', '')}`;
    const body = stripeEvent(id, 'customer.subscription.updated', { object: 'subscription', id: 'sub_e2e', metadata: {} });
    const first = await post(body, stripeSignature(STRIPE_WEBHOOK_SECRET, body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, outcome: 'ignored' });
    const again = await post(body, stripeSignature(STRIPE_WEBHOOK_SECRET, body));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, outcome: 'duplicate' });
  });

  it('E2E-BILL-002 a missing, wrong, stale or replayed-on-another-body signature is refused (400), nothing recorded', async () => {
    const body = stripeEvent(`evt_e2e_${randomUUID().replaceAll('-', '')}`, 'invoice.paid', { object: 'invoice', id: 'in_e2e' });
    const now = Math.floor(Date.now() / 1000);
    const refused = [
      await post(body),
      await post(body, stripeSignature('whsec_not_the_secret', body)),
      await post(body, stripeSignature(STRIPE_WEBHOOK_SECRET, body, now - 600)),
      await post(body, stripeSignature(STRIPE_WEBHOOK_SECRET, body, now + 600)),
      await post(body.replace('in_e2e', 'in_other'), stripeSignature(STRIPE_WEBHOOK_SECRET, body)),
      await post(body, 'garbage'),
    ];
    for (const r of refused) {
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual(INVALID_SIGNATURE);
    }
    // Refused events were not recorded: the same id, signed properly, is processed for the first time.
    const ok = await post(body, stripeSignature(STRIPE_WEBHOOK_SECRET, body));
    expect(await ok.json()).toEqual({ received: true, outcome: 'ignored' });
  });

  it('E2E-BILL-003 an event over 256 KiB is refused with 413 before its signature is checked', async () => {
    const body = stripeEvent('evt_e2e_big', 'invoice.paid', { object: 'invoice', id: 'in_big', pad: 'x'.repeat(256 * 1024) });
    const r = await post(body, stripeSignature(STRIPE_WEBHOOK_SECRET, body));
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: { type: string } }).error.type).toBe('payload_too_large');
  });
});

describe.skipIf(!ROUTES_SERVED)('E2E-BILL: billing routes need a person', () => {
  it('E2E-BILL-004 every billing route answers 401 with WWW-Authenticate: Bearer without credentials', async () => {
    const org = randomUUID();
    const routes: [string, string][] = [
      ['GET', BILLING(org)], ['POST', `${BILLING(org)}/checkout`], ['POST', `${BILLING(org)}/portal`], ['POST', `${BILLING(org)}/plan`],
      ['POST', `${BILLING(org)}/cancel`], ['POST', `${BILLING(org)}/resume`], ['GET', `${BILLING(org)}/invoices`],
    ];
    for (const [method, path] of routes) {
      const r = await call({}, method, path, method === 'POST' ? { plan: 'team', interval: 'month' } : undefined);
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.headers.get('www-authenticate'), `${method} ${path}`).toBe('Bearer');
      expect(r.body, `${method} ${path}`).toMatchObject({ error: { type: 'unauthorized' } });
    }
  });
});

describe.skipIf(ORGS !== '')(`E2E-BILL: an organization's subscription${ORGS ? ` (${ORGS})` : ''}`, () => {
  it('E2E-BILL-005 the owner opens a Stripe test checkout; the overview says Free, purchasable, with the prices', async () => {
    const owner = await signIn(email('owner'));
    const org = await orgOf(owner);
    const overview = await call(owner.caller, 'GET', BILLING(org.id));
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ orgId: org.id, plan: 'free', effectivePlan: 'free', purchasable: true, limits: { maxPeople: 5 } });
    const checkout = await call(owner.caller, 'POST', `${BILLING(org.id)}/checkout`, { plan: 'team', interval: 'month' });
    expect(checkout.status).toBe(200);
    expect(String(checkout.body['url'])).toMatch(/^https:\/\//);
    const unknown = await call(owner.caller, 'POST', `${BILLING(org.id)}/checkout`, { plan: 'enterprise', interval: 'month' });
    expect(unknown.status).toBe(400);
  });

  it('E2E-BILL-006 Free holds 5 people: the sixth is refused with 402 payment_required (at the invite or at the join)', async () => {
    const owner = await signIn(email('owner'));
    const org = await orgOf(owner);
    const emails = [1, 2, 3, 4, 5].map((i) => email(`m${i}`));
    const refusals: unknown[] = [];
    const invited = await call(owner.caller, 'POST', '/api/v1/members/invites', { invites: emails.map((e) => ({ email: e, role: 'member' })) });
    if (invited.status === 402) refusals.push(invited.body);
    else {
      expect(invited.status).toBe(200);
      for (const e of emails) {
        try {
          const p = await signIn(e);
          const joined = await call(p.caller, 'GET', '/api/v1/org');
          if (joined.status === 402) refusals.push(joined.body);
        } catch (error) {
          if (String(error).includes(' 402 ')) refusals.push(String(error));
          else throw error;
        }
      }
    }
    expect(refusals.length).toBeGreaterThan(0);
    expect(JSON.stringify(refusals)).toMatch(/payment_required/);
    expect(JSON.stringify(refusals)).toMatch(/5 people/);
    const members = await call(owner.caller, 'GET', '/api/v1/members');
    expect(members.status).toBe(200);
    const list = (Array.isArray(members.body) ? members.body : (members.body['items'] ?? members.body['members'])) as unknown[];
    expect(list.length).toBeLessThanOrEqual(5);
    expect((await call(owner.caller, 'GET', BILLING(org.id))).body).toMatchObject({ activePeople: expect.any(Number) });
  });

  it('E2E-BILL-007 a member without a billing role reads the overview but cannot buy, change or cancel (403)', async () => {
    const owner = await signIn(email('owner'));
    const org = await orgOf(owner);
    const memberEmail = email('member');
    expect((await call(owner.caller, 'POST', '/api/v1/members/invites', { invites: [{ email: memberEmail, role: 'member' }] })).status).toBe(200);
    const member = await signIn(memberEmail);
    expect((await orgOf(member)).id).toBe(org.id);
    expect((await call(member.caller, 'GET', BILLING(org.id))).status).toBe(200);
    for (const action of ['checkout', 'portal', 'plan', 'cancel', 'resume']) {
      const r = await call(member.caller, 'POST', `${BILLING(org.id)}/${action}`, { plan: 'team', interval: 'month' });
      expect(r.status, action).toBe(403);
    }
  });
});
