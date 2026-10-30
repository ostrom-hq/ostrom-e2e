// Stripe webhooks as Stripe sends them: an event body and its `Stripe-Signature` header (HMAC-SHA256 of
// `<t>.<body>` keyed by the whole `whsec_…` secret, lowercase hex), so the bench can play Stripe against the server.
import { createHmac } from 'node:crypto';

/** The `Stripe-Signature` header of a body, signed at `t` (Unix seconds, now by default). */
export function stripeSignature(secret: string, payload: string, t: number = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
}

/** A Stripe event body around `object` (the `data.object` Stripe sends). */
export function stripeEvent(id: string, type: string, object: Record<string, unknown>, created: number = Math.floor(Date.now() / 1000)): string {
  return JSON.stringify({ id, object: 'event', api_version: '2025-03-31.basil', created, type, livemode: false, data: { object } });
}
