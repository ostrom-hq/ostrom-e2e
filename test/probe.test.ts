// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstServed, isServed } from '../src/probe.ts';

let server: Server;
let base = '';
const answers: Record<string, [number, string]> = {
  '/generic': [404, '{"error":{"type":"not_found","message":"Not found."}}'],
  '/domain': [404, '{"error":{"type":"not_found","message":"Organization not found."}}'],
  '/bare': [404, '{}'],
  '/html': [404, '<html>nope</html>'],
  '/auth': [401, '{"error":{"type":"unauthenticated","message":"Sign in."}}'],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const [status, body] = req.method === 'POST' && req.url === '/post-only' ? ([200, '{}'] as [number, string]) : (answers[req.url ?? ''] ?? (answers['/generic'] as [number, string]));
    res.writeHead(status, { 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe('probe', () => {
  it('reads the router generic 404 as « not served », anything else as served', async () => {
    expect(await isServed(base, '/generic')).toBe(false);
    expect(await isServed(base, '/unknown')).toBe(false);
    expect(await isServed(base, '/domain')).toBe(true);
    expect(await isServed(base, '/bare')).toBe(true);
    expect(await isServed(base, '/html')).toBe(true);
    expect(await isServed(base, '/auth')).toBe(true);
    expect(await isServed(base, '/post-only', 'POST')).toBe(true);
  });

  it('picks the first served path', async () => {
    expect(await firstServed(base, ['/generic', '/auth', '/domain'])).toBe('/auth');
    expect(await firstServed(base, ['/generic'])).toBeUndefined();
    expect(await firstServed(base, ['/generic', '/post-only'], 'POST')).toBe('/post-only');
  });
});
