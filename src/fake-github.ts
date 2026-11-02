// SPDX-License-Identifier: Apache-2.0
// A local stand-in for GitHub, so that the full-stack scenarios never reach the real one (and never need a real
// account). The server and the CLI point at it through OSTROM_GITHUB_API_URL and OSTROM_GITHUB_WEB_URL.
// It serves what Ostrom's journeys use: the user behind a token, the OAuth device flow, the GitHub App's installations
// (the App's own JWT, installation tokens, the web-flow code of the install's return and `GET /user/installations`),
// pull requests, compare, check runs, and signed webhooks sent to the Ostrom server. Every request is recorded for the
// scenario to assert on.
import { createHmac } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeUser {
  readonly login: string;
  readonly id: number;
  readonly email?: string;
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

/** An installation of the App on `account`, reachable by the logins that administer it. */
export interface FakeInstallation {
  readonly id: number;
  readonly account: string;
  readonly admins: readonly string[];
}

/** The App's OAuth client: a code is only exchanged with this id and secret. */
export interface FakeOAuthClient {
  readonly id: string;
  readonly secret: string;
}

/** In-memory GitHub. `tokens` maps an access token to its user; `approveAfter` = device-flow polls before success. */
export class FakeGitHub {
  readonly requests: Recorded[] = [];
  readonly checkRuns: CheckRun[] = [];
  private readonly tokens = new Map<string, FakeUser>();
  private readonly ids = new Map<string, number>();
  private readonly pulls = new Map<string, FakePull>();
  private readonly compares = new Map<string, readonly string[]>();
  private readonly devices = new Map<string, DeviceCode>();
  private readonly codes = new Map<string, string>();
  private readonly installations = new Map<number, FakeInstallation>();
  private readonly webCodes = new Map<string, string>();
  private server: Server | undefined;
  private nextId = 1;
  url = '';

  readonly approveAfter: number;
  readonly oauth: FakeOAuthClient;

  constructor(approveAfter = 1, oauth: FakeOAuthClient = { id: 'Iv1.fake', secret: 'fake-client-secret' }) {
    this.approveAfter = approveAfter;
    this.oauth = oauth;
  }

  /** Registers a user; returns the token that identifies them. */
  user(login: string, token = `gho_${login}`): string {
    const id = this.ids.get(login) ?? 1000 + this.ids.size;
    this.ids.set(login, id);
    this.tokens.set(token, { login, id });
    return token;
  }

  /**
   * The web OAuth flow (`/login/oauth/authorize` → callback): returns the one-time `code` GitHub would hand back to
   * the redirect URI for `login`, whose verified primary address is `email`.
   */
  oauthCode(login: string, email: string): string {
    const code = `code_${this.nextId++}`;
    this.codes.set(code, login);
    const id = this.ids.get(login) ?? 1000 + this.ids.size;
    this.ids.set(login, id);
    this.tokens.set(`gho_${login}`, { login, id, email });
    return code;
  }

  /** The next device flow will be approved by this login; a prepared flow nobody started is dropped. */
  deviceLogin(login: string): string {
    for (const [code, d] of this.devices) if (d.polls === 0) this.devices.delete(code);
    const code = `dev_${this.nextId++}`;
    this.devices.set(code, { login, polls: 0 });
    return code;
  }

  /** Installs the App on `account`; `admins` are the logins whose `/user/installations` lists it. */
  installation(id: number, account: string, ...admins: string[]): void {
    this.installations.set(id, { id, account, admins });
  }

  /** The code GitHub appends to the install's return once `login` authorized the App: exchanged once. */
  webCode(login: string): string {
    const code = `web_${this.nextId++}`;
    this.webCodes.set(code, login);
    return code;
  }

  pull(repo: string, pr: FakePull): void {
    this.pulls.set(`${repo}#${pr.number}`, pr);
  }

  compare(repo: string, base: string, head: string, shas: readonly string[]): void {
    this.compares.set(`${repo}:${base}...${head}`, shas);
  }

  /** Listens on `port` (a free one by default; a fixed one when the server was started pointing at it). */
  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(port, '127.0.0.1', resolve));
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
    let status: number;
    let out: unknown;
    const [rawPath, search] = String(req.url).split('?') as [string, string | undefined];
    const path = decodeURIComponent(rawPath);
    const query = new URLSearchParams(search ?? '');
    const method = String(req.method);
    try {
      if (type.includes('json') && raw) body = JSON.parse(raw);
      else if (type.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw));
      [status, out] = this.route(method, path, body, req, query);
    } catch (e) {
      [status, out] = [400, { message: `Problems parsing JSON: ${(e as Error).message}` }];
    }
    this.requests.push({ method, path, body, authorization: req.headers.authorization ?? '' });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  }

  private route(method: string, path: string, body: unknown, req: IncomingMessage, query: URLSearchParams): [number, unknown] {
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (method === 'POST' && path === '/login/device/code') {
      const [code, d] = [...this.devices.entries()].find(([, v]) => v.polls === 0) ?? [];
      if (!code || !d) return [404, { message: 'no device login prepared (FakeGitHub.deviceLogin)' }];
      return [200, { device_code: code, user_code: 'ABCD-1234', verification_uri: `${this.url}/login/device`, expires_in: 900, interval: 0 }];
    }
    if (method === 'POST' && path === '/login/oauth/access_token' && fields['code'] !== undefined) {
      // A code of the install's return (`webCode`) goes to the App's client; a sign-in code (`oauthCode`) is good once,
      // like GitHub's; anything else, or a code already used, is `bad_verification_code`.
      if (this.webCodes.has(String(fields['code']))) return this.exchange(fields);
      const login = this.codes.get(String(fields['code']));
      this.codes.delete(String(fields['code']));
      return login ? [200, { access_token: `gho_${login}`, token_type: 'bearer', scope: 'read:user,user:email' }] : [200, { error: 'bad_verification_code' }];
    }
    if (method === 'POST' && path === '/login/oauth/access_token') {
      const d = this.devices.get(String(fields['device_code']));
      if (!d) return [200, { error: 'expired_token' }];
      d.polls += 1;
      if (d.polls < this.approveAfter) return [200, { error: 'authorization_pending' }];
      return [200, { access_token: this.user(d.login), token_type: 'bearer', scope: 'read:user' }];
    }
    const app = /^\/app\/installations\/(\d+)(\/access_tokens)?$/.exec(path);
    if (app) return this.app(method, Number(app[1]), app[2] !== undefined, req);
    const user = this.who(req);
    if (!user) return [401, { message: 'Bad credentials' }];
    if (method === 'GET' && path === '/user') return [200, { login: user.login, id: user.id, type: 'User' }];
    if (method === 'GET' && path === '/user/emails') return [200, user.email ? [{ email: user.email, primary: true, verified: true }] : []];
    if (method === 'GET' && path === '/user/installations') return this.reachable(user, query);
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

  /** The web flow: a code of `webCode`, once, with the App's OAuth client. GitHub answers 200 with an error. */
  private exchange(fields: Record<string, unknown>): [number, unknown] {
    if (fields['client_id'] !== this.oauth.id || fields['client_secret'] !== this.oauth.secret) {
      return [200, { error: 'incorrect_client_credentials' }];
    }
    const code = String(fields['code']);
    const login = this.webCodes.get(code) as string; // `handle` only sends a known code here
    this.webCodes.delete(code);
    return [200, { access_token: this.user(login, `ghu_${login}_${this.nextId++}`), token_type: 'bearer', scope: '' }];
  }

  /** The App's own calls, with its JWT: an installation, and a token to act on its repositories. */
  private app(method: string, id: number, wantsToken: boolean, req: IncomingMessage): [number, unknown] {
    if (!/^bearer ey/i.test(req.headers.authorization ?? '')) return [401, { message: 'A JSON web token could not be decoded' }];
    const inst = this.installations.get(id);
    if (!inst) return [404, { message: 'Not Found' }];
    if (!wantsToken) return method === 'GET' ? [200, { id, account: { login: inst.account } }] : [404, { message: 'Not Found' }];
    if (method !== 'POST') return [404, { message: 'Not Found' }];
    const expires = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');
    return [201, { token: this.user(`${inst.account}[bot]`, `ghs_${id}_${this.nextId++}`), expires_at: expires }];
  }

  /** `GET /user/installations`: the installations `user` administers, paginated like GitHub. */
  private reachable(user: FakeUser, query: URLSearchParams): [number, unknown] {
    const mine = [...this.installations.values()].filter((i) => i.admins.includes(user.login));
    const perPage = Math.min(Number(query.get('per_page') ?? 30), 100);
    const page = Number(query.get('page') ?? 1);
    const slice = mine.slice((page - 1) * perPage, page * perPage);
    return [200, { total_count: mine.length, installations: slice.map((i) => ({ id: i.id, account: { login: i.account } })) }];
  }
}
