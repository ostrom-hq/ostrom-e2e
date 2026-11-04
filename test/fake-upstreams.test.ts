// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { Agent as HttpsAgent, get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE, FakeUpstreams, INPUT_TOKENS, MCP_TOOLS, MCP_VERSIONS, message, shapeOf, streamFrames } from '../src/fake-upstreams.ts';

const fakes = new FakeUpstreams(30);
let url = '';
const post = async (path: string, body: unknown) => {
  const r = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const rpc = (mode: string, method: string, params?: unknown, id: number | null = 1) =>
  post(`/mcp/${mode}`, { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) });
const stats = async () => (await (await fetch(`${url}/stats`)).json()) as { provider: Record<string, number>; mcp: Record<string, number> };
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10));
};

/** Starts a request and cuts it once `bytes` bytes of the answer (0: none, the headers are not awaited) came back. */
const cut = (path: string, body: unknown, bytes: number) =>
  new Promise<number>((resolve) => {
    const target = new URL(url + path);
    const req = httpRequest({ host: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let seen = 0;
      res.on('data', (c: Buffer) => {
        seen += c.length;
        if (seen >= bytes) req.destroy();
      });
      res.on('error', () => undefined);
    });
    req.on('error', () => undefined);
    req.on('close', () => resolve(0));
    req.end(JSON.stringify(body));
    if (bytes === 0) setTimeout(() => req.destroy(), 30);
  });

beforeAll(async () => {
  url = (await fakes.start()).http;
});
afterAll(async () => {
  await fakes.stop();
  await fakes.stop();
});

describe('shapeOf', () => {
  it('reads ostrom_fake, bounds each field and keeps the default for anything else', () => {
    expect(shapeOf(undefined)).toEqual(DEFAULT_SHAPE);
    expect(shapeOf({ ostrom_fake: null })).toEqual(DEFAULT_SHAPE);
    expect(shapeOf({ ostrom_fake: { chunks: 3, gapMs: 5, ttfbMs: 7 } })).toEqual({ chunks: 3, gapMs: 5, ttfbMs: 7 });
    expect(shapeOf({ ostrom_fake: { chunks: 1e9, gapMs: -1, ttfbMs: 1.5 } })).toEqual({ chunks: 10_000, gapMs: 0, ttfbMs: 0 });
    expect(shapeOf({ ostrom_fake: { chunks: '3' } }).chunks).toBe(DEFAULT_SHAPE.chunks);
  });

  it('writes the frames and the whole message with the usage the gateway prices', () => {
    const frames = streamFrames('claude-opus-5', 4);
    expect(frames.head).toContain(`"input_tokens":${INPUT_TOKENS}`);
    expect(frames.tail).toContain('"output_tokens":4');
    expect(frames.tail.endsWith('event: message_stop\ndata: {"type":"message_stop"}\n\n')).toBe(true);
    expect(message('m', 2)).toMatchObject({ model: 'm', usage: { input_tokens: INPUT_TOKENS, output_tokens: 2 } });
  });
});

describe('FakeUpstreams provider', () => {
  it('answers a whole message after its delay, with the model asked or the default one', async () => {
    const r = await post('/v1/messages', { model: 'claude-opus-5', ostrom_fake: { chunks: 2, gapMs: 1, ttfbMs: 1 } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ model: 'claude-opus-5', usage: { output_tokens: 2 } });
    expect(JSON.parse((await post('/v1/messages', {})).text)).toMatchObject({ model: 'claude-opus-5', usage: { output_tokens: 20 } });
  });

  it('streams the deltas at once or spaced, and ends with the usage', async () => {
    const fast = await post('/v1/messages', { model: 'm', stream: true, ostrom_fake: { chunks: 3 } });
    expect(fast.headers.get('content-type')).toBe('text/event-stream');
    expect(fast.text.match(/content_block_delta/g)).toHaveLength(6);
    expect(fast.text).toContain('"output_tokens":3');
    const spaced = await post('/v1/messages', { model: 'm', stream: true, ostrom_fake: { chunks: 2, gapMs: 2 } });
    expect(spaced.text).toContain('message_stop');
    const empty = await post('/v1/messages', { model: 'm', stream: true, ostrom_fake: { chunks: 0 } });
    expect(empty.text).not.toContain('content_block_delta');
  });

  it('counts a stream the client cuts as aborted, closed at once, and resets its counts', async () => {
    await fetch(`${url}/stats/reset`, { method: 'POST' });
    await cut('/v1/messages', { stream: true, ostrom_fake: { chunks: 1000, gapMs: 20 } }, 1);
    await cut('/v1/messages', { ostrom_fake: { ttfbMs: 5_000 } }, 0);
    await until(async () => (await stats()).provider['aborted'] === 2);
    expect((await stats()).provider).toEqual({ open: 0, total: 2, completed: 0, aborted: 2 });
    expect((await fetch(`${url}/stats/reset`, { method: 'POST' })).status).toBe(204);
    expect((await stats()).provider['total']).toBe(0);
  });

  it('keeps serving when a client leaves in the middle of its request body', async () => {
    const target = new URL(url);
    await new Promise<void>((resolve) => {
      const socket = connect(Number(target.port), target.hostname, () => {
        socket.write('POST /v1/messages HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\ncontent-length: 1000\r\n\r\n{"mo');
        setTimeout(() => socket.destroy(), 20);
      });
      socket.on('close', () => resolve());
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true });
  });

  it('streams a long answer with no gap without growing the stack', async () => {
    const long = await post('/v1/messages', { model: 'm', stream: true, ostrom_fake: { chunks: 10_000, gapMs: 0 } });
    expect(long.text.split('event: content_block_delta').length - 1).toBe(10_000);
    expect(long.text).toContain('message_stop');
  });

  it('counts a call that ends after a reset in its own counts, never below zero in the new ones', async () => {
    await fetch(`${url}/stats/reset`, { method: 'POST' });
    const target = new URL(`${url}/mcp/hang`);
    const req = httpRequest({ host: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'content-type': 'application/json' } });
    req.on('error', () => undefined);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    await until(async () => (await stats()).mcp['open'] === 1);
    await fetch(`${url}/stats/reset`, { method: 'POST' });
    req.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect((await stats()).mcp).toEqual({ open: 0, total: 0, completed: 0, aborted: 0 });
  });

  it('answers health, 400 to malformed JSON and 404 elsewhere', async () => {
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true });
    expect((await post('/v1/messages', '{')).status).toBe(400);
    expect((await fetch(`${url}/v1/messages`)).status).toBe(404);
    expect((await post('/mcp/other', {})).status).toBe(404);
  });
});

describe('FakeUpstreams MCP', () => {
  it('initializes in the version asked, or a version it speaks, with a session id', async () => {
    const asked = await rpc('fast', 'initialize', { protocolVersion: MCP_VERSIONS[0] });
    expect(JSON.parse(asked.text).result.protocolVersion).toBe(MCP_VERSIONS[0]);
    expect(asked.headers.get('mcp-session-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse((await rpc('fast', 'initialize')).text).result.protocolVersion).toBe(MCP_VERSIONS[1]);
  });

  it('lists its tools, echoes, sleeps, and refuses unknown tools and methods', async () => {
    expect(JSON.parse((await rpc('fast', 'tools/list')).text).result.tools).toEqual(MCP_TOOLS);
    expect(JSON.parse((await rpc('fast', 'tools/call', { name: 'echo', arguments: { text: 'hi' } })).text).result.content[0].text).toBe('hi');
    expect(JSON.parse((await rpc('fast', 'tools/call', { name: 'echo' })).text).result.content[0].text).toBe('ok');
    expect(JSON.parse((await rpc('fast', 'tools/call', { name: 'sleep', arguments: { ms: 2 } })).text).result.content[0].text).toBe('slept 2 ms');
    expect(JSON.parse((await rpc('fast', 'tools/call', { name: 'nope' })).text).error.code).toBe(-32602);
    expect(JSON.parse((await rpc('fast', 'resources/list')).text).error.code).toBe(-32601);
  });

  it('accepts notifications and session deletes, refuses what is not a JSON-RPC POST', async () => {
    expect((await rpc('fast', 'notifications/initialized', undefined, null)).status).toBe(202);
    expect((await fetch(`${url}/mcp/fast`, { method: 'DELETE' })).status).toBe(204);
    // 405: the server offers no SSE stream on GET (Streamable HTTP), which a client must not take for a broken server.
    const get = await fetch(`${url}/mcp/fast`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, DELETE');
    expect((await post('/mcp/fast', { id: 1, method: 'ping' })).status).toBe(400);
    expect((await post('/mcp/fast', 'null')).status).toBe(400);
  });

  it('answers late on /mcp/slow and never on /mcp/hang, a cut call counted once', async () => {
    const started = Date.now();
    expect((await rpc('slow', 'tools/list')).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    await fetch(`${url}/stats/reset`, { method: 'POST' });
    await cut('/mcp/hang', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 0);
    await until(async () => (await stats()).mcp['aborted'] === 1);
    expect((await stats()).mcp).toEqual({ open: 0, total: 1, completed: 0, aborted: 1 });
  });
});

describe('FakeUpstreams over TLS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-upstreams-'));
  const tlsFakes = new FakeUpstreams();
  let urls: { http: string; https?: string } = { http: '' };

  beforeAll(async () => {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    urls = await tlsFakes.start(0, { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') });
  });
  afterAll(async () => {
    await tlsFakes.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the same routes on HTTPS, on a port of its own unless one is given', async () => {
    expect(urls.https).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
    const status = await new Promise<number>((resolve) => httpsGet(`${String(urls.https)}/health`, { rejectUnauthorized: false }, (res) => resolve(res.statusCode ?? 0)));
    expect(status).toBe(200);
    const fixed = new FakeUpstreams();
    const port = Number(new URL(String(urls.https)).port) + 1;
    const again = await fixed.start(0, { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8'), port });
    expect(again.https).toBe(`https://127.0.0.1:${port}`);
    await fixed.stop();
  });

  // The relay's MCP calls cost about 55 ms per HTTPS round trip in chart-load 41612342204: the fake tells whether the
  // client reuses its connections (one handshake for many requests) or opens one per request.
  it('counts the connections, full and resumed TLS handshakes, and requests of its HTTPS port', async () => {
    const tlsStats = async () => {
      const text = await new Promise<string>((resolve) =>
        httpsGet(`${String(urls.https)}/stats`, { rejectUnauthorized: false, agent: false }, (res) => {
          let body = '';
          res.on('data', (c: Buffer) => (body += c.toString()));
          res.on('end', () => resolve(body));
        }),
      );
      return (JSON.parse(text) as { tls: Record<string, number> }).tls;
    };
    const health = (agent: HttpsAgent) =>
      new Promise<void>((resolve) =>
        httpsGet(`${String(urls.https)}/health`, { rejectUnauthorized: false, agent }, (res) => {
          res.resume();
          res.on('end', () => resolve());
        }),
      );
    tlsFakes.reset();
    expect(tlsFakes.tls).toEqual({ connections: 0, handshakes: 0, resumed: 0, requests: 0 });
    // Kept alive: three requests on one connection, one handshake.
    const kept = new HttpsAgent({ keepAlive: true, maxSockets: 1 });
    for (let i = 0; i < 3; i++) await health(kept);
    kept.destroy();
    expect(tlsFakes.tls).toEqual({ connections: 1, handshakes: 1, resumed: 0, requests: 3 });
    // A connection per request, the TLS session resumed from the first (TLS 1.2 session ids: resumed at once).
    const fresh = new HttpsAgent({ keepAlive: false, maxVersion: 'TLSv1.2' });
    await health(fresh);
    await health(fresh);
    fresh.destroy();
    expect(tlsFakes.tls).toEqual({ connections: 3, handshakes: 3, resumed: 1, requests: 5 });
    // The stats request itself is counted after it is read.
    expect((await tlsStats())['requests']).toBe(6);
    tlsFakes.reset();
    expect(tlsFakes.tls['requests']).toBe(0);
  });
});
