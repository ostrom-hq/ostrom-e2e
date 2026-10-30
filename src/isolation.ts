// SPDX-License-Identifier: Apache-2.0
// Isolation between organizations: every route an organization's member can call, called by a member of another
// organization with the first one's ids. Nothing may succeed, crash, or echo anything of the first organization.
export interface Caller {
  readonly token?: string;
  readonly cookie?: string;
  readonly csrf?: string;
  /**
   * The client address the caller claims through `X-Forwarded-For`. The bench's server trusts 127.0.0.1 as its proxy
   * (`OSTROM_TRUSTED_PROXIES`), so each person signs in from an address of its own and the per-address sign-in limits
   * count people, not the whole bench.
   */
  readonly from?: string;
  /**
   * The `Origin` a browser sends with the session cookie. Since ostrom-server#58 (audit S2-08), a session write needs it
   * to be an allowed origin (the console's), besides its CSRF token.
   */
  readonly origin?: string;
}

export interface RouteCase {
  /** `GET /api/v1/gates/{id}`-like label, for the report. */
  readonly name: string;
  readonly method: string;
  /** The path with the owner's ids filled in. */
  readonly path: string;
  readonly body?: unknown;
  /** A route scoped by the credential (`GET /api/v1/org`): the intruder may get 200, about its own organization. */
  readonly ownScope?: boolean;
}

export interface Violation {
  readonly route: string;
  readonly status: number;
  readonly reason: string;
}

/**
 * The headers a caller sends: bearer token, or session cookie plus its CSRF token on a state-changing request, and the
 * caller's address and `Origin` when it has them.
 */
export function headersOf(caller: Caller, method: string, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  if (caller.token) h['authorization'] = `Bearer ${caller.token}`;
  if (caller.cookie) h['cookie'] = caller.cookie;
  if (caller.csrf && method !== 'GET' && method !== 'HEAD') h['x-csrf-token'] = caller.csrf;
  if (caller.from) h['x-forwarded-for'] = caller.from;
  if (caller.origin) h['origin'] = caller.origin;
  return h;
}

/** Answers allowed to an intruder: unauthenticated, forbidden, not found, or a validation refusal. */
const REFUSALS = new Set([400, 401, 403, 404, 405, 422]);

/**
 * Calls every route as `intruder` and lists what leaks: a success, a server error, or a body that contains one of
 * `ownerMarkers` (the owner's org id, resource ids, e-mails, names).
 */
export async function intrusions(base: string, routes: readonly RouteCase[], intruder: Caller, ownerMarkers: readonly string[]): Promise<Violation[]> {
  const out: Violation[] = [];
  for (const r of routes) {
    const json = r.body !== undefined;
    const res = await fetch(base.replace(/\/$/, '') + r.path, {
      method: r.method,
      headers: headersOf(intruder, r.method, json),
      ...(json ? { body: JSON.stringify(r.body) } : {}),
    });
    const text = await res.text();
    if (res.status >= 500 || (!REFUSALS.has(res.status) && !r.ownScope)) out.push({ route: r.name, status: res.status, reason: res.status >= 500 ? 'server error' : 'not refused' });
    const leaked = ownerMarkers.filter((m) => m !== '' && text.includes(m));
    if (leaked.length) out.push({ route: r.name, status: res.status, reason: `echoes ${leaked.join(', ')}` });
  }
  return out;
}
