// A local stand-in for GitHub, so that the full-stack scenarios never reach the real one (and never need a real
// account). The server and the CLI point at it through OSTROM_GITHUB_API_URL and OSTROM_GITHUB_WEB_URL.
// It serves what Ostrom's journeys use: the user behind a token, the OAuth device flow, pull requests, compare,
// check runs, and signed webhooks sent to the Ostrom server. Every request is recorded for the scenario to assert on.
import { createHmac } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeUser {
  readonly login: string;
  readonly id: number;
}

export interface FakePull {
  readonly number: number;
  readonly headSha: string;
  readonly baseRef: string;
  readonly headRef: string;
}

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly authorization: string;
}

export interface CheckRun {
  readonly id: number;
  readonly repo: string;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
}

interface DeviceCode {
  readonly login: string;
  polls: number;
}

/** In-memory GitHub. `tokens` maps an access token to its user; `approveAfter` = device-flow polls before success. */
export class FakeGitHub {
  readonly requests: Recorded[] = [];
  readonly checkRuns: CheckRun[] = [];
  private readonly tokens = new Map<string, FakeUser>();
  private readonly pulls = new Map<string, FakePull>();
  private readonly compares = new Map<string, readonly string[]>();
  private readonly devices = new Map<string, DeviceCode>();
  private server: Server | undefined;
  private nextId = 1;
  url = '';

  readonly approveAfter: number;

  constructor(approveAfter = 1) {
    this.approveAfter = approveAfter;
  }

  /** Registers a user; returns the token that identifies them. */
  user(login: string, token = `gho_${login}`): string {
    this.tokens.set(token, { login, id: 1000 + this.tokens.size });
    return token;
  }

  /** The next device flow will be approved by this login. */
  deviceLogin(login: string): string {
    const code = `dev_${this.nextId++}`;
    this.devices.set(code, { login, polls: 0 });
    return code;
  }

  pull(repo: string, pr: FakePull): void {
    this.pulls.set(`${repo}#${pr.number}`, pr);
  }

  compare(repo: string, base: string, head: string, shas: readonly string[]): void {
    this.compares.set(`${repo}:${base}...${head}`, shas);
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
    this.server = undefined;
  }

  /** Sends a webhook signed like GitHub (X-Hub-Signature-256) to `target`; returns the HTTP status. */
  async webhook(target: string, secret: string, event: string, payload: unknown): Promise<number> {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': `d-${this.nextId++}`, 'x-hub-signature-256': signature },
      body,
    });
    return r.status;
  }

  private who(req: IncomingMessage): FakeUser | undefined {
    const token = (req.headers.authorization ?? '').replace(/^(token|bearer)\s+/i, '');
    return this.tokens.get(token);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const type = req.headers['content-type'] ?? '';
    let body: unknown = raw;
    if (type.includes('json') && raw) body = JSON.parse(raw);
    else if (type.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw));
    const path = String(req.url).split('?')[0] as string;
    const method = String(req.method);
    this.requests.push({ method, path, body, authorization: req.headers.authorization ?? '' });
    const [status, out] = this.route(method, path, body, req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  }

  private route(method: string, path: string, body: unknown, req: IncomingMessage): [number, unknown] {
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (method === 'POST' && path === '/login/device/code') {
      const [code, d] = [...this.devices.entries()].find(([, v]) => v.polls === 0) ?? [];
      if (!code || !d) return [404, { message: 'no device login prepared (FakeGitHub.deviceLogin)' }];
      return [200, { device_code: code, user_code: 'ABCD-1234', verification_uri: `${this.url}/login/device`, expires_in: 900, interval: 0 }];
    }
    if (method === 'POST' && path === '/login/oauth/access_token') {
      const d = this.devices.get(String(fields['device_code']));
      if (!d) return [200, { error: 'expired_token' }];
      d.polls += 1;
      if (d.polls < this.approveAfter) return [200, { error: 'authorization_pending' }];
      return [200, { access_token: this.user(d.login), token_type: 'bearer', scope: 'read:user' }];
    }
    const user = this.who(req);
    if (!user) return [401, { message: 'Bad credentials' }];
    if (method === 'GET' && path === '/user') return [200, { login: user.login, id: user.id, type: 'User' }];
    const repoPath = /^\/repos\/([^/]+\/[^/]+)\/(.+)$/.exec(path);
    if (!repoPath) return [404, { message: 'Not Found' }];
    const repo = repoPath[1] as string;
    const rest = repoPath[2] as string;
    const pull = /^pulls\/(\d+)$/.exec(rest);
    if (method === 'GET' && pull) {
      const p = this.pulls.get(`${repo}#${pull[1]}`);
      return p ? [200, { number: p.number, head: { sha: p.headSha, ref: p.headRef }, base: { ref: p.baseRef } }] : [404, { message: 'Not Found' }];
    }
    const cmp = /^compare\/(.+)$/.exec(rest);
    if (method === 'GET' && cmp) {
      const shas = this.compares.get(`${repo}:${cmp[1]}`);
      return shas ? [200, { commits: shas.map((sha) => ({ sha })), total_commits: shas.length }] : [404, { message: 'Not Found' }];
    }
    if (method === 'POST' && rest === 'check-runs') {
      const run: CheckRun = { id: this.nextId++, repo, name: String(fields['name']), headSha: String(fields['head_sha']), status: String(fields['status'] ?? 'queued'), conclusion: (fields['conclusion'] as string | undefined) ?? null };
      this.checkRuns.push(run);
      return [201, run];
    }
    const patch = /^check-runs\/(\d+)$/.exec(rest);
    if (method === 'PATCH' && patch) {
      const run = this.checkRuns.find((r) => r.id === Number(patch[1]) && r.repo === repo);
      if (!run) return [404, { message: 'Not Found' }];
      if (typeof fields['status'] === 'string') run.status = fields['status'];
      if (typeof fields['conclusion'] === 'string') run.conclusion = fields['conclusion'];
      return [200, run];
    }
    return [404, { message: 'Not Found' }];
  }
}
