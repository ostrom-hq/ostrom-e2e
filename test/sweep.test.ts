// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { type Call, type Leak, type Operation, fill, judge, keyOf, leakKey, mimic, normalize, operations, paramPrefix, parseServed, plan, reconcile, resolve, sample } from '../src/sweep.ts';

describe('served routes', () => {
  it('reads one route per line, without comments, URLs or doubles; a `!` route is served all the same', () => {
    const text = ['# header', '', 'GET /api/v1/rules', 'GET /api/v1/rules/{}', '! PUT /api/v1/x/{id}', 'GET https://api.openai.com/auth', 'GET /api/v1/rules', 'nonsense'].join('\n');
    expect(parseServed(text)).toEqual([
      { method: 'GET', key: '/api/v1/rules' },
      { method: 'GET', key: '/api/v1/rules/{}' },
      { method: 'PUT', key: '/api/v1/x/{}' },
    ]);
    expect(keyOf('/a/{id}/{ticket}/{path}')).toBe('/a/{}/{}/{}');
  });
});

const DOC = {
  paths: {
    '/api/v1/rules/{id}': {
      parameters: [{ $ref: '#/components/parameters/OstromOrg' }],
      get: { operationId: 'getRule', parameters: [{ name: 'id', in: 'path' }, null] },
      patch: { operationId: 'updateRule', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Patch' } } } } },
      delete: { requestBody: { content: { 'text/plain': {} } } },
    },
    '/health': { get: { operationId: 'health', security: [] } },
    '/api/v1/tokens': { $ref: '#/components/pathItems/Tokens' },
    '/api/v1/empty': null,
    '/api/v1/me': { get: { operationId: 'me', security: [{ bearer: [] }], parameters: [{ name: 'X-Trace', in: 'header' }], requestBody: {} } },
  },
  components: {
    parameters: { OstromOrg: { name: 'Ostrom-Org', in: 'header' } },
    schemas: { Patch: { type: 'object', required: ['a/b'], properties: { 'a/b': { type: 'string' } } } },
    pathItems: { Tokens: { post: { operationId: 'createToken' } } },
  },
};

describe('operations', () => {
  it('follows references, escapes and cycles', () => {
    expect(resolve(DOC, { $ref: '#/components/schemas/Patch/properties/a~1b' })).toEqual({ type: 'string' });
    expect(resolve({ x: { y: '~' } }, { $ref: '#/x/y' })).toBe('~');
    expect(resolve({ 'a~b': 1 }, { $ref: '#/a~0b' })).toBe(1);
    expect(resolve(DOC, { $ref: 'other.yaml#/x' })).toEqual({ $ref: 'other.yaml#/x' });
    expect(resolve(DOC, 'plain')).toBe('plain');
    expect(resolve(DOC, { $ref: '#/nope/deeper' })).toBeUndefined();
    const loop = { a: { $ref: '#/a' } };
    expect(resolve(loop, { $ref: '#/a' })).toEqual({ $ref: '#/a' });
  });

  it('reads every operation: its parameters, organization header, public security and body', () => {
    const ops = operations(DOC);
    const by = (id: string) => ops.find((o) => o.id === id) as Operation;
    expect(by('getRule')).toEqual({ method: 'GET', path: '/api/v1/rules/{id}', key: '/api/v1/rules/{}', id: 'getRule', public: false, orgScoped: true, params: ['id'] });
    expect(by('updateRule').body).toEqual({ $ref: '#/components/schemas/Patch' });
    expect(by('delete /api/v1/rules/{id}')).toMatchObject({ method: 'DELETE', orgScoped: true });
    expect(by('delete /api/v1/rules/{id}').body).toBeUndefined();
    expect(by('health')).toMatchObject({ public: true, orgScoped: false, params: [] });
    expect(by('createToken')).toMatchObject({ method: 'POST', key: '/api/v1/tokens', public: false });
    expect(by('me')).toMatchObject({ public: false });
    expect(ops).toHaveLength(6);
    expect(operations(undefined)).toEqual([]);
  });
});

describe('sample', () => {
  const doc = { components: { schemas: { Role: { enum: ['owner', 'member'] }, Null: { type: 'null' } } } };
  it('takes const, example, examples, default and enum before the type', () => {
    expect(sample(doc, undefined)).toBeUndefined();
    expect(sample(doc, 'text')).toBeUndefined();
    expect(sample(doc, { const: 'c' })).toBe('c');
    expect(sample(doc, { example: 'e', type: 'string' })).toBe('e');
    expect(sample(doc, { examples: ['x1'] })).toBe('x1');
    expect(sample(doc, { examples: [], type: 'boolean' })).toBe(false);
    expect(sample(doc, { default: 7 })).toBe(7);
    expect(sample(doc, { $ref: '#/components/schemas/Role' })).toBe('owner');
    expect(sample(doc, { enum: [], type: 'integer' })).toBe(1);
  });

  it('merges allOf, takes the first non-null branch, and follows the type', () => {
    expect(sample(doc, { allOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 3 } } }, { type: 'string' }, { required: ['b'] }] })).toEqual({ a: 3, b: 'sweep' });
    expect(sample(doc, { oneOf: [{ $ref: '#/components/schemas/Null' }, { type: 'number' }] })).toBe(1);
    expect(sample(doc, { anyOf: [{ type: 'null' }] })).toBeNull();
    expect(sample(doc, { type: ['null', 'string'] })).toBe('sweep');
    expect(sample(doc, { type: ['null'] })).toBeNull();
    expect(sample(doc, { properties: { a: {} } })).toEqual({});
    expect(sample(doc, { type: 'object' })).toEqual({});
    expect(sample(doc, {})).toEqual({});
    expect(sample(doc, { type: 'array', minItems: 1, items: { type: 'string', format: 'uuid' } })).toEqual(['00000000-0000-4000-8000-00000000c0de']);
    expect(sample(doc, { type: 'array', minItems: 1 })).toEqual(['sweep']);
    expect(sample(doc, { type: 'array' })).toEqual([]);
  });

  it('gives strings their format and length', () => {
    expect(sample(doc, { type: 'string', format: 'date-time' })).toBe('2026-11-02T00:00:00Z');
    expect(sample(doc, { type: 'string', format: 'date' })).toBe('2026-11-02');
    expect(sample(doc, { type: 'string', format: 'email' })).toBe('sweep@sweep.e2e.ostrom.test');
    expect(sample(doc, { type: 'string', format: 'uri' })).toBe('https://sweep.e2e.ostrom.test/');
    expect(sample(doc, { type: 'string', format: 'url' })).toBe('https://sweep.e2e.ostrom.test/');
    expect(sample(doc, { type: 'string', minLength: 8 })).toBe('sweepxxx');
    expect(sample(doc, { type: 'string' })).toBe('sweep');
  });

  it('stops deep schemas', () => {
    const deep = { components: { schemas: { N: { type: 'object', required: ['n'], properties: { n: { $ref: '#/components/schemas/N' } } } } } };
    const out = JSON.stringify(sample(deep, { $ref: '#/components/schemas/N' }));
    expect(out).toContain('"n":"sweep"');
  });
});

describe('plan', () => {
  const op = (o: Partial<Operation> & Pick<Operation, 'method' | 'path'>): Operation => ({ key: keyOf(o.path), id: o.path, public: false, orgScoped: false, params: [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string), ...o });
  const ops = [
    op({ method: 'GET', path: '/health', public: true }),
    op({ method: 'GET', path: '/a/{id}/{ticket}', public: true }),
    op({ method: 'GET', path: '/api/v1/orgs/{org}/members/{login}' }),
    op({ method: 'GET', path: '/api/v1/rules', orgScoped: true }),
    op({ method: 'GET', path: '/api/v1/auth/me' }),
    op({ method: 'POST', path: '/api/v1/auth/logout' }),
    op({ method: 'POST', path: '/api/v1/tokens' }),
    op({ method: 'GET', path: '/api/v1/waits/{id}', orgScoped: true }),
  ];
  const kinds = { '/a/{id}': 'artifact', '/a/{}/{ticket}': 'ticket', '/api/v1/orgs/{org}': 'org', '/api/v1/orgs/{}/members/{login}': 'login' };

  it('names the prefix of a parameter', () => {
    expect(paramPrefix('/api/v1/orgs/{org}/members/{login}', 'login')).toBe('/api/v1/orgs/{}/members/{login}');
    expect(paramPrefix('/api/v1/orgs/{org}/members/{login}', 'org')).toBe('/api/v1/orgs/{org}');
  });

  it('gives each served route its case, and says why the others have none', () => {
    const served = parseServed(['GET /health', 'GET /a/{}/{}', 'GET /api/v1/orgs/{}/members/{}', 'GET /api/v1/rules', 'GET /api/v1/auth/me', 'POST /api/v1/auth/logout', 'POST /api/v1/tokens', 'GET /api/v1/waits/{}', 'GET /api/v1/ghost'].join('\n'));
    const { cases, uncovered } = plan(served, ops, kinds, { 'POST /api/v1/auth/logout': 'ends the caller' });
    expect(cases.map((c) => [c.label, c.kind])).toEqual([
      ['GET /health', 'public'],
      ['GET /a/{}/{}', 'public'],
      ['GET /api/v1/orgs/{}/members/{}', 'strict'],
      ['GET /api/v1/rules', 'org'],
      ['GET /api/v1/auth/me', 'own'],
      ['POST /api/v1/auth/logout', 'skipped'],
    ]);
    expect(cases[1]?.kinds).toEqual({ id: 'artifact', ticket: 'ticket' });
    expect(cases[5]?.reason).toBe('ends the caller');
    expect(uncovered).toEqual([
      "POST /api/v1/tokens: a write on the caller's own account, without an organization: say why it is not called",
      'GET /api/v1/waits/{}: no resource kind for {id} (/api/v1/waits/{id})',
      'GET /api/v1/ghost: no operation in the contract',
    ]);
  });

  it('fills a path with URL-encoded values', () => {
    expect(fill('/api/v1/orgs/{org}/members/{login}', { org: 'o 1', login: 'ada/b' })).toBe('/api/v1/orgs/o%201/members/ada%2Fb');
    expect(fill('/x/{id}', {})).toBe('/x/');
  });
});

describe('mimic', () => {
  it('keeps the shape of a value and changes it', () => {
    const uuid = '3f2a9c1e-0b7d-4e5f-8a6b-1c2d3e4f5a6b';
    const other = mimic(uuid);
    expect(other).not.toBe(uuid);
    expect(other).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mimic('Ada_lovelace.X')).toMatch(/^[A-Z][a-f][a-f]_[g-z][g-z][g-z][a-f][g-z][a-f][a-f][a-f]\.[A-Z]$/);
  });

  it('adds a character when chance gives the same value back, or nothing can change', () => {
    expect(mimic('0', () => 0)).toBe('00');
    expect(mimic('--')).toBe('--0');
  });
});

describe('judge', () => {
  const at = (status: number, body: unknown, sent: string[] = []): Call => ({ answer: { status, text: typeof body === 'string' ? body : JSON.stringify(body) }, sent });
  const notFound = { error: { type: 'not_found', message: 'Rule not found.', requestId: 'r1' } };

  it('makes bodies comparable', () => {
    expect(normalize(JSON.stringify({ error: { message: 'Rule rule-A not found', requestId: 'x', traceId: 'y' } }), ['rule-A', 'ab'])).toBe('{"error":{"message":"Rule <sent> not found"}}');
    expect(normalize('plain rule-A', ['rule-A', 'plain'])).toBe('<sent> <sent>');
    expect(normalize(JSON.stringify({ confirmationId: 'gcf_1', confirmUrl: 'http://x/confirm/gcf_1', expiresAt: '2026-11-03T11:23:15Z' }), [])).toBe('{}');
  });

  it('accepts the answer of a missing resource, and nothing of A', () => {
    expect(judge('strict', at(404, notFound, ['rule-A']), at(404, { error: { ...notFound.error, requestId: 'r2' } }, ['rule-B']), { "A's org id": 'org-A-1' })).toEqual([]);
    expect(judge('org', at(200, { items: [] }), at(200, { items: [1] }), {})).toEqual([]);
    expect(judge('own', at(200, { me: 'B' }), undefined, { "A's e-mail": 'a@x.test', short: 'abc' })).toEqual([]);
  });

  it('names a success, a crash, an oracle and an echo', () => {
    expect(judge('strict', at(200, { id: 'rule-A' }, ['rule-A']), at(404, notFound), {})).toEqual(["answers 200 on A's resource", "tells A's resource from a missing one: 200, missing 404"]);
    expect(judge('public', at(500, {}), at(500, {}), {})).toEqual(['server error 500']);
    expect(judge('strict', at(403, { error: { type: 'forbidden' } }), at(404, notFound), {})).toEqual(["tells A's resource from a missing one: 403, missing 404"]);
    expect(judge('org', at(404, { error: { message: 'gone' } }), at(404, notFound), {})).toEqual(["tells A's resource from a missing one: same 404, another body"]);
    expect(judge('refs', at(200, { updated: 1 }), at(200, { updated: 0 }), {})).toEqual(["tells A's resource from a missing one: same 200, another body"]);
    expect(judge('refs', at(200, { updated: 0 }), at(200, { updated: 0 }), {})).toEqual([]);
    expect(judge('own', at(200, { org: 'org-A-1', mine: 'a@x.test' }, ['a@x.test']), undefined, { "A's org id": 'org-A-1', "A's e-mail": 'a@x.test' })).toEqual(["echoes A's org id"]);
  });

  it('sets the known leaks apart, and the fixed ones', () => {
    const leak = (route: string): Leak => ({ caller: 'pat', route, variant: 'Ostrom-Org: A', status: 200, reasons: ['x'], body: '{}' });
    expect(leakKey(leak('GET /r'))).toBe('pat | GET /r | Ostrom-Org: A');
    const { unexpected, fixed } = reconcile([leak('GET /r'), leak('GET /s')], { 'pat | GET /r | Ostrom-Org: A': 'server#1', 'pat | GET /t | Ostrom-Org: A': 'server#2' });
    expect(unexpected.map((l) => l.route)).toEqual(['GET /s']);
    expect(fixed).toEqual(['pat | GET /t | Ostrom-Org: A']);
  });
});
