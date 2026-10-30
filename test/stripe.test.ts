import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { stripeEvent, stripeSignature } from '../src/stripe.ts';

describe('stripe', () => {
  it('signs `<t>.<body>` with the whole whsec_ secret, as Stripe does', () => {
    const v1 = createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex');
    expect(stripeSignature('whsec_x', '{"a":1}', 1700000000)).toBe(`t=1700000000,v1=${v1}`);
  });

  it('signs at the current second by default', () => {
    const t = Number(/^t=(\d+),v1=[0-9a-f]{64}$/.exec(stripeSignature('whsec_x', '{}'))?.[1]);
    expect(Math.abs(t - Date.now() / 1000)).toBeLessThan(5);
  });

  it('wraps an object in a Stripe event', () => {
    const e = JSON.parse(stripeEvent('evt_1', 'invoice.paid', { object: 'invoice', id: 'in_1' }, 42)) as Record<string, unknown>;
    expect(e).toMatchObject({ id: 'evt_1', object: 'event', type: 'invoice.paid', created: 42, livemode: false, data: { object: { id: 'in_1' } } });
    const now = (JSON.parse(stripeEvent('evt_2', 'x', {})) as { created: number }).created;
    expect(Math.abs(now - Date.now() / 1000)).toBeLessThan(5);
  });
});
