// SPDX-License-Identifier: Apache-2.0
// A fake OAuth token endpoint of a provider (Claude, Codex), for the shared accounts' refresh: the server's
// OSTROM_SHARING_CLAUDE_TOKEN_URL and OSTROM_SHARING_CODEX_TOKEN_URL point here (ostrom-server#96). It answers a
// refresh the way the providers do (RFC 6749 § 5.1 and § 5.2): 200 with a new pair, or 400 `invalid_grant` for a
// refresh token it was told to refuse. Every refresh token it is sent is recorded, never a token of a real provider.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the endpoint was sent: one entry per request, in order. */
export interface Refresh {
  readonly grantType: string | undefined;
  readonly refreshToken: string | undefined;
  readonly clientId: string | undefined;
}

export class FakeTokens {
  /** The refresh tokens answered with 400 `invalid_grant` (the provider forgot them). */
  readonly refused = new Set<string>();
  readonly refreshes: Refresh[] = [];
  private server: Server | undefined;
  private port = 0;

  /** `http://127.0.0.1:<port>/v1/oauth/token`, once started. */
  get url(): string {
    return `http://127.0.0.1:${this.port}/v1/oauth/token`;
  }

  /** Listens on [port] (0 for any free one); once only, until it is stopped. */
  async start(port = 0): Promise<this> {
    if (this.server) throw new Error(`already listening on ${this.url}`);
    const server = createServer((req, res) => {
      // a request cut off mid-body (the server's container stopped) is answered by nobody, never an unhandled rejection
      this.answer(req, res).catch(() => res.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, { error: 'invalid_request' });
      chunks.push(chunk);
    }
    // decoded once whole: a character split across two chunks stays one
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.method !== 'POST') return send(res, 405, { error: 'invalid_request' });
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = Object.fromEntries(new URLSearchParams(raw));
    }
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : undefined);
    const refresh: Refresh = { grantType: text('grant_type'), refreshToken: text('refresh_token'), clientId: text('client_id') };
    this.refreshes.push(refresh);
    if (refresh.grantType !== 'refresh_token' || refresh.refreshToken === undefined) return send(res, 400, { error: 'invalid_request' });
    if (this.refused.has(refresh.refreshToken)) return send(res, 400, { error: 'invalid_grant' });
    const n = this.refreshes.length;
    return send(res, 200, { access_token: `fake-access-${n}`, refresh_token: `fake-refresh-${n}`, expires_in: 28_800, token_type: 'Bearer' });
  }
}

/** A refresh request is a few hundred bytes: anything past 64 KiB is not one. */
const MAX_BODY = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
