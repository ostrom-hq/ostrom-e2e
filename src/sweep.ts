// SPDX-License-Identifier: Apache-2.0
// The isolation sweep, generated from the contract: every route the server serves (ostrom-core's
// api/contract/served-routes.txt, plus what scripts/served-routes.py reads in the server under test) gets a case from
// its OpenAPI operation. A member of organization B calls it on A's resources: A's real ids, `Ostrom-Org: A`. The
// answer must be the one a missing resource gets (same status, same body), never a success on A's ids, never a server
// error, never anything of A. A served route without a case fails the sweep: a new route cannot be forgotten.

/** One served route: `GET /api/v1/rules/{}` (path parameters written `{}`). */
export interface Served {
  readonly method: string;
  readonly key: string;
}

/** `/api/v1/rules/{id}` → `/api/v1/rules/{}`. */
export const keyOf = (path: string): string => path.replace(/\{[^}]+\}/g, '{}');

/**
 * The routes of a served-routes list: one `METHOD /path` per line; `#` comments, blank lines and anything that is not
 * a path (a URL the source scan picked up) are left out; a leading `!` (a route served in another shape than the
 * contract's) is dropped, the route is served all the same. Each route once, in order.
 */
export function parseServed(text: string): Served[] {
  const seen = new Set<string>();
  const out: Served[] = [];
  for (const raw of text.split('\n')) {
    const m = /^!?\s*([A-Z]+)\s+(\/\S*)\s*$/.exec(raw.trim());
    if (!m) continue;
    const route = { method: m[1] as string, key: keyOf(m[2] as string) };
    const label = `${route.method} ${route.key}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(route);
  }
  return out;
}

type Json = Record<string, unknown>;

/** What the sweep needs of an OpenAPI operation. */
export interface Operation {
  readonly method: string;
  /** The contract's path, with its parameter names: `/api/v1/orgs/{org}/members/{login}`. */
  readonly path: string;
  readonly key: string;
  readonly id: string;
  /** `security: []`: no credential at all (health, sign-in, webhooks, artifact links). */
  readonly public: boolean;
  /** Acts in the caller's current organization, named by `Ostrom-Org`. */
  readonly orgScoped: boolean;
  /** The path parameters, in path order. */
  readonly params: readonly string[];
  /** The JSON request body's schema, when there is one. */
  readonly body?: unknown;
}

/** Follows `$ref: '#/a/b'` inside the document, until a node that is not a reference. */
export function resolve(doc: unknown, node: unknown): unknown {
  let current = node;
  for (let hops = 0; hops < 32; hops++) {
    const ref = (current as Json | undefined)?.['$ref'];
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return current;
    current = ref
      .slice(2)
      .split('/')
      .reduce<unknown>((at, part) => (at as Json | undefined)?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], doc);
  }
  return current;
}

const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

/** Every operation of an OpenAPI document, served or planned (the served list says which the server answers). */
export function operations(doc: unknown): Operation[] {
  const out: Operation[] = [];
  const paths = ((doc as Json | undefined)?.['paths'] ?? {}) as Json;
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = (resolve(doc, rawItem) ?? {}) as Json;
    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const declared = [...((item['parameters'] as unknown[] | undefined) ?? []), ...((op['parameters'] as unknown[] | undefined) ?? [])].map((p) => (resolve(doc, p) ?? {}) as Json);
      const orgScoped = declared.some((p) => p['in'] === 'header' && String(p['name']).toLowerCase() === 'ostrom-org');
      const security = op['security'];
      const schema = ((op['requestBody'] as Json | undefined)?.['content'] as Json | undefined)?.['application/json'] as Json | undefined;
      out.push({
        method: method.toUpperCase(),
        path,
        key: keyOf(path),
        id: String(op['operationId'] ?? `${method} ${path}`),
        public: Array.isArray(security) && security.length === 0,
        orgScoped,
        params: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string),
        ...(schema?.['schema'] !== undefined ? { body: schema['schema'] } : {}),
      });
    }
  }
  return out;
}

/**
 * A small valid instance of a schema: its `const`, example, default or first enum value; the required properties of an
 * object; the first non-null branch of a `oneOf`/`anyOf`; the merge of an `allOf`. Enough for a request to pass the
 * shape checks, so that what answers is the authorization, not the validation.
 */
export function sample(doc: unknown, node: unknown, depth = 0): unknown {
  const s = resolve(doc, node) as Json | undefined;
  if (!s || typeof s !== 'object' || depth > 8) return undefined;
  if ('const' in s) return s['const'];
  if (s['example'] !== undefined) return s['example'];
  if (Array.isArray(s['examples']) && s['examples'].length > 0) return s['examples'][0];
  if (s['default'] !== undefined) return s['default'];
  if (Array.isArray(s['enum']) && s['enum'].length > 0) return s['enum'][0];
  if (Array.isArray(s['allOf'])) {
    return Object.assign({}, ...s['allOf'].map((part) => sample(doc, part, depth + 1)).filter((v) => v && typeof v === 'object'));
  }
  const branches = (s['oneOf'] ?? s['anyOf']) as unknown[] | undefined;
  if (Array.isArray(branches)) {
    const branch = branches.find((b) => (resolve(doc, b) as Json | undefined)?.['type'] !== 'null');
    return branch === undefined ? null : sample(doc, branch, depth + 1);
  }
  const types = Array.isArray(s['type']) ? (s['type'] as string[]) : [s['type']];
  const type = types.find((t) => t !== 'null') ?? (types.includes('null') ? 'null' : s['properties'] || s['required'] ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const props = (s['properties'] ?? {}) as Json;
      const out: Json = {};
      for (const name of (s['required'] as string[] | undefined) ?? []) out[name] = sample(doc, props[name], depth + 1) ?? 'sweep';
      return out;
    }
    case 'array':
      return Number(s['minItems'] ?? 0) > 0 ? [sample(doc, s['items'], depth + 1) ?? 'sweep'] : [];
    case 'string':
      return stringOf(s);
    case 'integer':
    case 'number':
      return typeof s['minimum'] === 'number' ? s['minimum'] : 1;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return {};
  }
}

function stringOf(s: Json): string {
  switch (s['format']) {
    case 'uuid':
      return '00000000-0000-4000-8000-00000000c0de';
    case 'date-time':
      return '2026-11-02T00:00:00Z';
    case 'date':
      return '2026-11-02';
    case 'email':
      return 'sweep@sweep.e2e.ostrom.test';
    case 'uri':
    case 'url':
      return 'https://sweep.e2e.ostrom.test/';
    default:
      return 'sweep'.padEnd(Number(s['minLength'] ?? 0), 'x');
  }
}

/**
 * How a case is judged:
 * - `public`: no credential is read; nothing may crash or echo A, and A's ids answer as missing ones;
 * - `strict`: the path names A's resources; never a success, and the answer of a missing resource;
 * - `org`: acts in the organization `Ostrom-Org` names; with A named, the answer of a missing organization (a token
 *   bound to its own organization may ignore the header: then it answers about B, and nothing of A);
 * - `own`: reads the caller's own account; nothing of A;
 * - `refs`: acts in B's own organization but names A's resources in its query or body; the answer of missing ones,
 *   body included even on a success (`{updated: 0}` for both);
 * - `skipped`: not called, for the reason given (a write on the caller's own credential, which would end the sweep).
 */
export type CaseClass = 'public' | 'strict' | 'org' | 'own' | 'refs' | 'skipped';

export interface Case {
  readonly label: string;
  readonly op: Operation;
  readonly kind: CaseClass;
  /** The kind of resource each path parameter names, by parameter name. */
  readonly kinds: Readonly<Record<string, string>>;
  readonly reason?: string;
}

/** The prefix that names a path parameter: `/api/v1/orgs/{}/members/{login}` for `login`. */
export function paramPrefix(path: string, param: string): string {
  return `${keyOf(path.slice(0, path.indexOf(`{${param}}`)))}{${param}}`;
}

/**
 * The case of every served route: from its operation, the kind of resource of each path parameter (`paramKinds`, by
 * prefix), and the routes not called on purpose (`skipped`, label → why). What has no case is in `uncovered`, with why.
 */
export function plan(served: readonly Served[], ops: readonly Operation[], paramKinds: Readonly<Record<string, string>>, skipped: Readonly<Record<string, string>>): { cases: Case[]; uncovered: string[] } {
  const cases: Case[] = [];
  const uncovered: string[] = [];
  for (const route of served) {
    const label = `${route.method} ${route.key}`;
    const op = ops.find((o) => o.method === route.method && o.key === route.key);
    if (!op) {
      uncovered.push(`${label}: no operation in the contract`);
      continue;
    }
    const why = skipped[label];
    if (why !== undefined) {
      cases.push({ label, op, kind: 'skipped', kinds: {}, reason: why });
      continue;
    }
    const kinds: Record<string, string> = {};
    const unknown: string[] = [];
    for (const p of op.params) {
      const kind = paramKinds[paramPrefix(op.path, p)];
      if (kind === undefined) unknown.push(`{${p}}`);
      else kinds[p] = kind;
    }
    if (unknown.length > 0) {
      uncovered.push(`${label}: no resource kind for ${unknown.join(', ')} (${unknown.map((u) => paramPrefix(op.path, u.slice(1, -1))).join(', ')})`);
      continue;
    }
    if (op.public) cases.push({ label, op, kind: 'public', kinds });
    else if (op.params.length > 0) cases.push({ label, op, kind: 'strict', kinds });
    else if (op.orgScoped) cases.push({ label, op, kind: 'org', kinds });
    else if (op.method === 'GET') cases.push({ label, op, kind: 'own', kinds });
    else uncovered.push(`${label}: a write on the caller's own account, without an organization: say why it is not called`);
  }
  return { cases, uncovered };
}

/** `/api/v1/rules/{id}` with `{id: 'r1'}` → `/api/v1/rules/r1` (each value URL-encoded). */
export function fill(path: string, values: Readonly<Record<string, string>>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(values[name] ?? ''));
}

/**
 * Another value of the same shape: each digit, hexadecimal letter, other lower-case letter and upper-case letter is
 * replaced by a random one of its class; anything else (`-`, `_`, `.`) stays. A missing resource's id then fails or
 * passes the server's format checks exactly as A's does, and only its existence differs.
 */
export function mimic(value: string, random: () => number = Math.random): string {
  const pick = (chars: string) => chars[Math.floor(random() * chars.length)] as string;
  const once = () =>
    [...value]
      .map((c) => {
        if (/[0-9]/.test(c)) return pick('0123456789');
        if (/[a-f]/.test(c)) return pick('abcdef');
        if (/[g-z]/.test(c)) return pick('ghijklmnopqrstuvwxyz');
        if (/[A-Z]/.test(c)) return pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        return c;
      })
      .join('');
  for (let i = 0; i < 8; i++) {
    const other = once();
    if (other !== value) return other;
  }
  return `${value}0`;
}

/** An answer as the sweep keeps it. */
export interface Answer {
  readonly status: number;
  readonly text: string;
}

// A governance write answers a confirmation minted for that very call (ostrom-server#146): its id, link and expiry.
const VOLATILE = new Set(['requestId', 'traceId', 'timestamp', 'time', 'now', 'serverTime', 'confirmationId', 'confirmUrl', 'expiresAt']);

/**
 * An answer's body made comparable: the values the request sent are replaced by `<sent>` (a message may name the id
 * it was given), and the keys that change on every request (`requestId`, `traceId`, …) are dropped.
 */
export function normalize(text: string, sent: readonly string[]): string {
  let body = text;
  for (const s of [...sent].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length)) body = body.split(s).join('<sent>');
  try {
    return JSON.stringify(JSON.parse(body, (k, v: unknown) => (VOLATILE.has(k) ? undefined : v)));
  } catch {
    return body;
  }
}

/** One call of a case: what was asked, with A's values or a missing resource's, and what came back. */
export interface Call {
  readonly answer: Answer;
  /** The values the request carried (path values, `Ostrom-Org`, body), for `normalize` and the echo check. */
  readonly sent: readonly string[];
}

/**
 * Why a case's answer is wrong, if it is: a server error; a success on A's resources (`strict` only); an answer that
 * tells A's resource from a missing one (status, or body once normalized); an echo of something of A the request did
 * not carry. `markers` are A's values by name (`A's org id`, `A's e-mail`…).
 */
export function judge(kind: CaseClass, a: Call, missing: Call | undefined, markers: Readonly<Record<string, string>>): string[] {
  const reasons: string[] = [];
  const { status, text } = a.answer;
  if (status >= 500) reasons.push(`server error ${status}`);
  if (kind === 'strict' && status < 400) reasons.push(`answers ${status} on A's resource`);
  if (missing && status < 500) {
    const other = missing.answer;
    if (other.status !== status) reasons.push(`tells A's resource from a missing one: ${status}, missing ${other.status}`);
    else if ((status >= 300 || kind === 'refs') && normalize(text, a.sent) !== normalize(other.text, missing.sent)) reasons.push(`tells A's resource from a missing one: same ${status}, another body`);
  }
  for (const [name, value] of Object.entries(markers)) {
    if (value.length < 4 || a.sent.some((s) => s.includes(value))) continue;
    if (text.includes(value)) reasons.push(`echoes ${name}`);
  }
  return reasons;
}

/** A wrong answer, for the report and the JOURNAL. */
export interface Leak {
  readonly caller: string;
  readonly route: string;
  readonly variant: string;
  readonly status: number;
  readonly reasons: readonly string[];
  readonly body: string;
}

export const leakKey = (l: Pick<Leak, 'caller' | 'route' | 'variant'>) => `${l.caller} | ${l.route} | ${l.variant}`;

/**
 * The leaks against the list of known ones (key → the PR or JOURNAL line that will fix it): those not known yet, and
 * the known ones that no longer happen (fixed: take them out of the list, as an `it.fails` that passes).
 */
export function reconcile(found: readonly Leak[], known: Readonly<Record<string, string>>): { unexpected: Leak[]; fixed: string[] } {
  const keys = new Set(found.map(leakKey));
  return { unexpected: found.filter((l) => known[leakKey(l)] === undefined), fixed: Object.keys(known).filter((k) => !keys.has(k)) };
}
