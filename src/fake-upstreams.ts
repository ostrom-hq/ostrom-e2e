// SPDX-License-Identifier: Apache-2.0
// Stand-ins for what the gateway and the MCP relay call, so that the load pass measures the server and never a real
// provider: a model provider speaking Anthropic Messages (JSON and server-sent events) and Streamable HTTP MCP servers.
// The server points at them through OSTROM_GATEWAY_ANTHROPIC_URL and the URLs of the MCP servers it is given.
// - `POST /v1/messages`: the answer's shape comes from the request's `ostrom_fake` member (a real provider has none):
//   `chunks` text deltas, `gapMs` between two of them, `ttfbMs` before the first byte. The gateway passes unknown
//   members through, so a k6 script shapes the same call made directly and through the gateway.
// - `/mcp/fast`, `/mcp/slow` (every answer `slowMs` late), `/mcp/hang` (never answers): tools `echo` and `sleep`.
// - `GET /stats`: calls open, done and cut by the client, for the provider and for MCP; on the HTTPS port, the TCP
//   connections, the TLS handshakes (full or resumed) and the requests they carried, which tell whether a client reuses
//   its connections; `POST /stats/reset`.
import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type Server as HttpsServer, createServer as createTlsServer } from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';

/** How the fake provider answers a call. */
export interface Shape {
  readonly chunks: number;
  readonly gapMs: number;
  readonly ttfbMs: number;
}

export const DEFAULT_SHAPE: Shape = { chunks: 20, gapMs: 0, ttfbMs: 0 };
const LIMITS: Shape = { chunks: 10_000, gapMs: 60_000, ttfbMs: 60_000 };

/** The input tokens every call reports, so that the gateway prices each one. */
export const INPUT_TOKENS = 100;
const DELTA = 'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do ';

/** A JSON value as an object: itself, or empty for anything else (absent, null, a scalar, an array's index access). */
const obj = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

const bounded = (value: unknown, fallback: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;

/** The shape asked by a request body (`ostrom_fake`), each field bounded, the default for anything else. */
export function shapeOf(body: unknown): Shape {
  const fields = obj(obj(body)['ostrom_fake']);
  return {
    chunks: bounded(fields['chunks'], DEFAULT_SHAPE.chunks, LIMITS.chunks),
    gapMs: bounded(fields['gapMs'], DEFAULT_SHAPE.gapMs, LIMITS.gapMs),
    ttfbMs: bounded(fields['ttfbMs'], DEFAULT_SHAPE.ttfbMs, LIMITS.ttfbMs),
  };
}

const sse = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** The server-sent events of a streamed answer: the head, `chunks` text deltas, then the tail with the usage. */
export function streamFrames(model: string, chunks: number): { head: string; delta: string; tail: string } {
  const message = { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: INPUT_TOKENS, output_tokens: 1 } };
  return {
    head: sse('message_start', { message }) + sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    delta: sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: DELTA } }),
    tail:
      sse('content_block_stop', { index: 0 }) +
      sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: chunks } }) +
      sse('message_stop', {}),
  };
}

/** A whole (not streamed) answer of `chunks` deltas. */
export function message(model: string, chunks: number): Record<string, unknown> {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: DELTA.repeat(chunks) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: INPUT_TOKENS, output_tokens: chunks },
  };
}

/** What each side saw: calls in progress, calls ever made, finished, and cut by the client before the end. */
export interface Counts {
  open: number;
  total: number;
  completed: number;
  aborted: number;
}

const zero = (): Counts => ({ open: 0, total: 0, completed: 0, aborted: 0 });

/** What the HTTPS port saw: TCP connections, TLS handshakes (of which resumed sessions), and requests. */
export interface TlsCounts {
  connections: number;
  handshakes: number;
  resumed: number;
  requests: number;
}

const zeroTls = (): TlsCounts => ({ connections: 0, handshakes: 0, resumed: 0, requests: 0 });

/** The protocol versions the fake MCP servers speak (the relay's, newest first). */
export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const MCP_TOOLS = [
  { name: 'echo', description: 'Returns its text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'sleep', description: 'Answers after ms milliseconds.', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } },
];
const MAX_SLEEP_MS = 60_000;

/** One call being answered: its timers die with it, and it counts once as done or as cut. */
class Exchange {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private ended = false;
  private readonly res: ServerResponse;
  private readonly counts: Counts;

  constructor(res: ServerResponse, counts: Counts) {
    this.res = res;
    this.counts = counts;
    counts.open++;
    counts.total++;
    res.on('close', () => this.end(false));
  }

  /** Runs `then` after `ms`, unless the call ends before ([end] clears the timers). */
  after(ms: number, then: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      then();
    }, ms);
    this.timers.add(timer);
  }

  /** Ends the answer with `body`; `status` and `headers` only when nothing was written yet (else: the end of a stream). */
  finish(status: number, headers: Record<string, string>, body: string): void {
    if (!this.res.headersSent) this.res.writeHead(status, headers);
    this.res.end(body);
    this.end(true);
  }

  write(chunk: string): void {
    this.res.write(chunk);
  }

  end(completed: boolean): void {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.counts.open--;
    if (completed) this.counts.completed++;
    else this.counts.aborted++;
  }
}

const JSON_TYPE = { 'content-type': 'application/json' };

/** The fake provider and the fake MCP servers, on one plain HTTP port and, given a key and a certificate, one HTTPS port. */
export class FakeUpstreams {
  // Replaced, not zeroed, by [reset]: a call still open keeps counting in the counts it started in.
  provider: Counts = zero();
  mcp: Counts = zero();
  tls: TlsCounts = zeroTls();
  private readonly servers: (Server | HttpsServer)[] = [];
  private readonly slowMs: number;

  constructor(slowMs = 1_000) {
    this.slowMs = slowMs;
  }

  /** Listens on `port` (HTTP) and, with `tls`, on `tlsPort` (HTTPS); returns the URLs. */
  async start(port = 0, tls?: { key: string; cert: string; port?: number }, host = '127.0.0.1'): Promise<{ http: string; https?: string }> {
    // A client gone in the middle of its request body rejects the read: the answer is dropped, the fakes go on.
    const handler = (req: IncomingMessage, res: ServerResponse) => void this.handle(req, res).catch(() => res.destroy());
    const plain = await this.listen(createServer(handler), port, host);
    if (!tls) return { http: `http://${host}:${plain}` };
    const server = createTlsServer({ key: tls.key, cert: tls.cert }, (req: IncomingMessage, res: ServerResponse) => {
      this.tls.requests++;
      handler(req, res);
    });
    server.on('connection', () => this.tls.connections++);
    server.on('secureConnection', (socket: TLSSocket) => {
      this.tls.handshakes++;
      if (socket.isSessionReused()) this.tls.resumed++;
    });
    const secure = await this.listen(server, tls.port ?? 0, host);
    return { http: `http://${host}:${plain}`, https: `https://${host}:${secure}` };
  }

  async stop(): Promise<void> {
    const servers = this.servers.splice(0);
    await Promise.all(
      servers.map((s) => {
        s.closeAllConnections();
        return new Promise<void>((resolve) => s.close(() => resolve()));
      }),
    );
  }

  reset(): void {
    this.provider = zero();
    this.mcp = zero();
    this.tls = zeroTls();
  }

  private async listen(server: Server | HttpsServer, port: number, host: string): Promise<number> {
    this.servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    return (server.address() as AddressInfo).port;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const path = String(req.url).split('?')[0] as string;
    const method = String(req.method);
    if (method === 'GET' && (path === '/health' || path === '/stats')) {
      res.writeHead(200, JSON_TYPE);
      res.end(path === '/health' ? '{"ok":true}' : JSON.stringify({ provider: this.provider, mcp: this.mcp, tls: this.tls }));
      return;
    }
    if (method === 'POST' && path === '/stats/reset') {
      this.reset();
      res.writeHead(204);
      res.end();
      return;
    }
    let body: unknown;
    try {
      body = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      res.writeHead(400, JSON_TYPE);
      res.end('{"error":"not JSON"}');
      return;
    }
    if (method === 'POST' && path === '/v1/messages') this.messages(body, res);
    else if (path.startsWith('/mcp/') && ['fast', 'slow', 'hang'].includes(path.slice('/mcp/'.length))) this.mcpCall(method, path.slice('/mcp/'.length), body, res);
    else {
      res.writeHead(404, JSON_TYPE);
      res.end('{"error":"not found"}');
    }
  }

  private messages(body: unknown, res: ServerResponse): void {
    const call = new Exchange(res, this.provider);
    const fields = obj(body);
    const model = typeof fields['model'] === 'string' ? fields['model'] : 'claude-opus-5';
    const shape = shapeOf(body);
    if (fields['stream'] !== true) {
      call.after(shape.ttfbMs + shape.chunks * shape.gapMs, () => call.finish(200, JSON_TYPE, JSON.stringify(message(model, shape.chunks))));
      return;
    }
    const frames = streamFrames(model, shape.chunks);
    call.after(shape.ttfbMs, () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      call.write(frames.head);
      if (shape.gapMs === 0) {
        // A loop, not a recursion: 10 000 gapless chunks would overflow the stack.
        for (let left = shape.chunks; left > 0; left--) call.write(frames.delta);
        return call.finish(200, {}, frames.tail);
      }
      const next = (left: number): void => {
        if (left === 0) return call.finish(200, {}, frames.tail);
        call.write(frames.delta);
        call.after(shape.gapMs, () => next(left - 1));
      };
      next(shape.chunks);
    });
  }

  private mcpCall(method: string, mode: string, body: unknown, res: ServerResponse): void {
    const call = new Exchange(res, this.mcp);
    if (mode === 'hang') return;
    const answer = (status: number, out: unknown, headers: Record<string, string> = JSON_TYPE) =>
      call.after(mode === 'slow' ? this.slowMs : 0, () => call.finish(status, headers, out === undefined ? '' : JSON.stringify(out)));
    if (method === 'DELETE') return answer(204, undefined, {});
    // No SSE stream on GET: 405, as Streamable HTTP says, so a client never takes the server for a broken one.
    if (method === 'GET') return answer(405, { error: 'no SSE stream' }, { ...JSON_TYPE, allow: 'POST, DELETE' });
    const rpc = obj(body);
    const params = obj(rpc['params']);
    const id = rpc['id'];
    if (method !== 'POST' || rpc['jsonrpc'] !== '2.0') return answer(400, { error: 'a JSON-RPC 2.0 POST' });
    if (id === undefined) return answer(202, undefined, {});
    const result = (value: unknown, headers: Record<string, string> = JSON_TYPE) => answer(200, { jsonrpc: '2.0', id, result: value }, headers);
    switch (rpc['method']) {
      case 'initialize': {
        const asked = String(params['protocolVersion']);
        const version = MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[1];
        const info = { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: `fake-${mode}`, version: '1.0.0' } };
        return result(info, { ...JSON_TYPE, 'mcp-session-id': randomUUID() });
      }
      case 'tools/list':
        return result({ tools: MCP_TOOLS });
      case 'tools/call': {
        const args = obj(params['arguments']);
        const text = typeof args['text'] === 'string' ? args['text'] : 'ok';
        if (params['name'] === 'echo') return result({ content: [{ type: 'text', text }], isError: false });
        if (params['name'] === 'sleep') {
          const ms = bounded(args['ms'], 0, MAX_SLEEP_MS);
          return call.after(ms, () => result({ content: [{ type: 'text', text: `slept ${ms} ms` }], isError: false }));
        }
        return answer(200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool.' } });
      }
      default:
        return answer(200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found.' } });
    }
  }
}
