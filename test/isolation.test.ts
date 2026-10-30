import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headersOf, intrusions } from '../src/isolation.ts';

let server: Server;
let base = '';
const seen: IncomingMessage['headers'][] = [];

// A deliberately leaky server: /leak answers 200 with the owner's id, /crash 500, /echo refuses but echoes the id.
beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.headers);
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/leak') return send(200, { orgId: 'org-A' });
    if (req.url === '/crash') return send(500, { error: { type: 'internal' } });
    if (req.url === '/mine') return send(200, { orgId: 'org-B' });
    if (req.url === '/mine-crash') return send(503, {});
    if (req.url === '/echo') return send(404, { error: { type: 'not_found', message: 'Gate gate-A1 not found.' } });
    return send(404, { error: { type: 'not_found', message: 'Not found.' } });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe('isolation', () => {
  it('builds bearer or cookie headers, with the CSRF token only on writes', () => {
    expect(headersOf({ token: 't' }, 'GET', false)).toEqual({ authorization: 'Bearer t' });
    expect(headersOf({ cookie: 'ostrom_session=s', csrf: 'c' }, 'POST', true)).toEqual({ 'content-type': 'application/json', cookie: 'ostrom_session=s', 'x-csrf-token': 'c' });
    expect(headersOf({ cookie: 'ostrom_session=s', csrf: 'c' }, 'GET', false)).toEqual({ cookie: 'ostrom_session=s' });
    expect(headersOf({ csrf: 'c' }, 'HEAD', false)).toEqual({});
    expect(headersOf({}, 'DELETE', false)).toEqual({});
  });

  it('lists every success, server error and echo of the owner, and nothing for a clean refusal', async () => {
    const v = await intrusions(
      base,
      [
        { name: 'GET /leak', method: 'GET', path: '/leak' },
        { name: 'POST /crash', method: 'POST', path: '/crash', body: { x: 1 } },
        { name: 'GET /echo', method: 'GET', path: '/echo' },
        { name: 'GET /clean', method: 'GET', path: '/clean' },
        { name: 'GET /mine', method: 'GET', path: '/mine', ownScope: true },
        { name: 'GET /mine-crash', method: 'GET', path: '/mine-crash', ownScope: true },
        { name: 'GET /leak (own scope)', method: 'GET', path: '/leak', ownScope: true },
      ],
      { token: 'intruder' },
      ['org-A', 'gate-A1', ''],
    );
    expect(v).toEqual([
      { route: 'GET /leak', status: 200, reason: 'not refused' },
      { route: 'GET /leak', status: 200, reason: 'echoes org-A' },
      { route: 'POST /crash', status: 500, reason: 'server error' },
      { route: 'GET /echo', status: 404, reason: 'echoes gate-A1' },
      { route: 'GET /mine-crash', status: 503, reason: 'server error' },
      { route: 'GET /leak (own scope)', status: 200, reason: 'echoes org-A' },
    ]);
    expect(seen.at(-6)?.['content-type']).toBe('application/json');
    expect(seen.at(-4)?.authorization).toBe('Bearer intruder');
  });
});
