// E2E-SRV : what the server foundation serves today (ostrom-server#1), tested from outside, on the server's own image
// and a real PostgreSQL: health, the instance and its signing key, the uniform error body, the request id header.
import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SERVER_URL } from './env.ts';

const url = (path: string) => SERVER_URL.replace(/\/$/, '') + path;
const JSON_TYPE = /^application\/json\b/;
const GENERATED_ID = /^[0-9a-f]{32}$/;

interface Health { status: string; version: string; checks: Record<string, string> }
interface Key { keyId: string; algorithm: string; publicKeyPem: string; firstSeenAt: string }
interface Instance { id: string; version: string; createdAt: string; signingKey: Key }
interface ApiError { error: { type: string; message: string } }

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; body: T }> {
  const r = await fetch(url(path), init);
  return { status: r.status, headers: r.headers, body: (await r.json()) as T };
}

describe.skipIf(SERVER_URL === '')('E2E-SRV: server foundation', () => {
  it('E2E-SRV-001 /health and /api/v1/health: 200, status ok, version, database check', async () => {
    for (const path of ['/health', '/api/v1/health']) {
      const r = await json<Health>(path);
      expect(r.status, path).toBe(200);
      expect(r.headers.get('content-type'), path).toMatch(JSON_TYPE);
      expect(r.body.status, path).toBe('ok');
      expect(r.body.version, path).toMatch(/^\d+\.\d+\.\d+/);
      expect(r.body.checks, path).toEqual({ database: 'ok' });
    }
  });

  it('E2E-SRV-002 /api/v1/instance: stable id, Ed25519 key in SPKI PEM, listed in /api/v1/instance/keys', async () => {
    const first = await json<Instance>('/api/v1/instance');
    const second = await json<Instance>('/api/v1/instance');
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const { id, createdAt, signingKey } = first.body;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(createdAt))).toBe(false);
    expect(signingKey.algorithm).toBe('ed25519');
    expect(signingKey.keyId).not.toBe('');
    expect(createPublicKey(signingKey.publicKeyPem).asymmetricKeyType).toBe('ed25519');
    const keys = await json<{ keys: Key[] }>('/api/v1/instance/keys');
    expect(keys.status).toBe(200);
    expect(keys.body.keys).toContainEqual(signingKey);
  });

  it('E2E-SRV-003 errors: one JSON body {"error":{"type","message"}} for 404 and 405', async () => {
    for (const path of ['/nowhere', '/api/v1/nowhere', '/api/v1/instance/nowhere']) {
      const r = await json<ApiError>(path);
      expect(r.status, path).toBe(404);
      expect(r.headers.get('content-type'), path).toMatch(JSON_TYPE);
      expect(r.body, path).toEqual({ error: { type: 'not_found', message: 'Not found.' } });
    }
    for (const path of ['/health', '/api/v1/instance']) {
      const r = await json<ApiError>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(r.status, path).toBe(405);
      expect(r.headers.get('content-type'), path).toMatch(JSON_TYPE);
      expect(r.body, path).toEqual({ error: { type: 'method_not_allowed', message: 'Method not allowed.' } });
    }
  });

  it('E2E-SRV-004 X-Request-Id: a valid id comes back, a missing or unsafe one is replaced by a generated id', async () => {
    const kept = await fetch(url('/health'), { headers: { 'x-request-id': 'e2e-srv_004' } });
    expect(kept.headers.get('x-request-id')).toBe('e2e-srv_004');
    const missing = await fetch(url('/health'));
    expect(missing.headers.get('x-request-id')).toMatch(GENERATED_ID);
    for (const unsafe of ['bad id with spaces', 'a'.repeat(129), 'x;drop']) {
      const r = await fetch(url('/api/v1/nowhere'), { headers: { 'x-request-id': unsafe } });
      expect(r.status).toBe(404);
      expect(r.headers.get('x-request-id'), unsafe).toMatch(GENERATED_ID);
    }
    const a = (await fetch(url('/health'))).headers.get('x-request-id');
    const b = (await fetch(url('/health'))).headers.get('x-request-id');
    expect(a).not.toBe(b);
  });
});
