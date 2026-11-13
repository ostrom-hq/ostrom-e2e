// SPDX-License-Identifier: Apache-2.0
// E2E-SWEEP : isolation between organizations, generated from the contract (second security audit, consigne du 02/11).
// Every route the server serves (ostrom-core's served-routes.txt, what scripts/served-routes.py reads in the server
// under test, and every operation the contract marks `served`) gets a case from its OpenAPI operation (src/sweep.ts). A
// member of organization B calls each one on A's resources, A's real ids and `Ostrom-Org: A`, and again with B's own
// organization named; each answer is set beside the one a missing resource gets. Five kinds of caller: browser session,
// personal token, CLI token, the elevated `osg_` token of `ostrom login --admin`, service key. A served route without a
// case fails E2E-SWEEP-001, so a new route cannot be forgotten. A leak not in KNOWN fails its caller's scenario; a
// known leak that stops happening too.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { type Caller, headersOf } from '../src/isolation.ts';
import { type Answer, type Case, type CaseClass, type Leak, fill, judge, leakKey, mergeServed, mimic, operations, parseServed, plan, reconcile, sample, servedInContract } from '../src/sweep.ts';
import { SERVER_URL } from './env.ts';
import { receiptIdIn } from './lib.ts';
import { type Org, type Person, address, call, email, invite, orgOf, orgsUnavailable, profileOf, signIn, url } from './org.ts';

const SERVED_FILE = process.env['OSTROM_E2E_SERVED_ROUTES'] ?? '';
const OPENAPI_FILE = process.env['OSTROM_E2E_OPENAPI'] ?? '';
const T = 900_000;

/**
 * The kind of resource a path parameter names, by its prefix (earlier parameters written `{}`). A new route whose
 * parameter is not here has no case: E2E-SWEEP-001 fails and names the prefix to add.
 */
const PARAM_KINDS: Record<string, string> = {
  '/a/{id}': 'artifact',
  '/a/{}/{ticket}': 'artifactTicket',
  '/a/{}/{}/{path}': 'filePath',
  '/l/{slug}': 'artifactLink',
  '/l/{}/{path}': 'filePath',
  '/api/v1/accounts/{id}': 'account',
  '/api/v1/approvals/{id}': 'approval',
  '/api/v1/artifacts/{id}': 'artifact',
  '/api/v1/artifacts/{}/members/{memberId}': 'member',
  '/api/v1/artifacts/{}/versions/{number}': 'artifactVersion',
  '/api/v1/auth/sessions/{id}': 'authSession',
  '/api/v1/auth/{provider}': 'provider',
  '/api/v1/automations/{id}': 'automation',
  '/api/v1/cloud/sessions/{id}': 'cloudSession',
  '/api/v1/confirmations/{id}': 'confirmation',
  '/api/v1/devices/{id}': 'device',
  '/api/v1/gates/{id}': 'gate',
  '/api/v1/github/link/device/{id}': 'githubDeviceLink',
  '/api/v1/github/links/{memberId}': 'member',
  '/api/v1/groups/{id}': 'group',
  '/api/v1/groups/{}/members/{login}': 'login',
  '/api/v1/launches/{launchId}': 'launch',
  '/api/v1/mcp/servers/{name}': 'mcpServer',
  '/api/v1/mcp/servers/{}/assignments/{member}': 'member',
  '/api/v1/mcp/servers/{}/policies/{policyId}': 'mcpPolicy',
  '/api/v1/mcp/{server}': 'mcpServer',
  '/api/v1/orgs/{org}': 'org',
  '/api/v1/orgs/{orgId}': 'org',
  '/api/v1/orgs/{}/invitations/{id}': 'invitation',
  '/api/v1/orgs/{}/members/{login}': 'login',
  '/api/v1/packages/{digest}': 'package',
  '/api/v1/receipts/{id}': 'receipt',
  '/api/v1/push-devices/{id}': 'pushDevice',
  '/api/v1/rules/{id}': 'rule',
  '/api/v1/runners/{id}': 'runner',
  '/api/v1/runs/{id}': 'run',
  '/api/v1/secrets/{name}': 'secret',
  '/api/v1/service-keys/{id}': 'serviceKey',
  '/api/v1/sessions/{id}': 'session',
  '/api/v1/todos/session/items/{item}': 'todoItem',
  '/api/v1/todos/stop-hook/members/{memberId}': 'member',
  '/api/v1/tokens/{id}': 'token',
  '/api/v1/waits/{id}': 'wait',
  '/api/v1/workflows/{id}': 'workflow',
};

/** Values that are not A's: the same in both calls (a provider name, a file of the artifact, its first version). */
const FIXED: Record<string, string> = { provider: 'github', filePath: 'index.md', artifactVersion: '1' };
/** Secrets B never holds (an artifact's ticket, its public link): a missing one in both calls. */
const CAPABILITIES = new Set(['artifactTicket', 'artifactLink']);

/**
 * Routes not called, and why: each acts on the caller's own credential or account and takes nothing of another
 * organization, or takes a secret only its holder has. Calling them would end or change the sweep's own caller.
 */
const SKIPPED: Record<string, string> = {
  'POST /api/v1/auth/logout': "ends the caller's own session or token; nothing of another organization in it",
  'POST /api/v1/auth/logout/everywhere': "ends every session and token of the caller; nothing of another organization in it",
  'POST /api/v1/auth/links': 'a sign-in link for the caller itself',
  'POST /api/v1/auth/mobile/unlock': "unlocks the caller's own phone token",
  'POST /api/v1/auth/device/answer': 'answers a device login by its one-time code, which only the person at the terminal holds (E2E-AUTH-003)',
  'POST /api/v1/auth/{}/link': "links a sign-in provider to the caller's own account",
  'POST /api/v1/tokens': 'a token for the caller itself (the personal token of this sweep is made by it)',
  'PUT /api/v1/me/notifications': "the caller's own notification preferences",
  'POST /api/v1/orgs': "a new organization for the caller: a second membership would change every later call's organization",
  'POST /api/v1/invitations/accept': 'takes an invitation by its mailed token, which only the invited person holds (E2E-ORG)',
};

/** Leaks already written to the JOURNAL for their module's owner (key `caller | route | variant` → where). */
const KNOWN: Record<string, string> = {};

type Values = Record<string, string>;

/**
 * Query strings and bodies that name A's resources (`sessionId`, rule ids…), and bodies a sample cannot make right
 * (the organization's slug to confirm a deletion, a member's login to transfer to). `refers`: the request names A's
 * resources outside its path, so it is also sent in B's own organization, A's values against missing ones.
 */
const REQUESTS: Record<string, { refers?: boolean; make: (v: Values) => { query?: string; body?: unknown } }> = {
  listChecks: { refers: true, make: (v) => ({ query: `sessionId=${enc(v['session'])}` }) },
  listNotifications: { refers: true, make: (v) => ({ query: `sessionId=${enc(v['session'])}` }) },
  listWaits: { refers: true, make: (v) => ({ query: `sessionId=${enc(v['session'])}` }) },
  wakeWaits: { refers: true, make: (v) => ({ query: `session=${enc(v['session'])}`, body: { waitMillis: 0 } }) },
  listReceipts: { refers: true, make: (v) => ({ query: `subjectKind=session&subjectId=${enc(v['session'])}` }) },
  listDecisions: { refers: true, make: (v) => ({ query: `subjectKind=rule&subjectId=${enc(v['rule'])}` }) },
  getUsage: { refers: true, make: (v) => ({ query: `member=${enc(v['login'])}` }) },
  bulkUpdateRules: { refers: true, make: (v) => ({ body: { ids: [v['rule']], status: 'rejected' } }) },
  reportCheck: { refers: true, make: (v) => ({ body: { sessionId: v['session'], digest: v['package'], nodeId: 'tests', scriptId: 's-tests', exit: 0, outcome: 'passed' } }) },
  sendNotification: { refers: true, make: (v) => ({ body: { sessionId: v['session'], digest: v['package'], nodeId: 'notify', notifyId: 'notify' } }) },
  cloudRunnerHeartbeat: { refers: true, make: (v) => ({ body: { sessionId: v['cloudSession'], epoch: 1 } }) },
  openRunnerLaunch: { refers: true, make: (v) => ({ body: { sessionId: v['cloudSession'], epoch: 1 } }) },
  fetchRunnerGithubToken: { refers: true, make: (v) => ({ body: { sessionId: v['cloudSession'], epoch: 1 } }) },
  setCloudSessionGithubAccess: { make: () => ({ body: { access: 'shared' } }) },
  reportRunnerCheck: { refers: true, make: (v) => ({ body: { sessionId: v['cloudSession'], epoch: 1, check: { name: 'tests', outcome: 'passed' } } }) },
  // The session todo (todos.v1): every route names its session, in the query or the body.
  getSessionTodo: { refers: true, make: (v) => ({ query: `sessionId=${enc(v['session'])}` }) },
  readTodoContext: { refers: true, make: (v) => ({ query: `sessionId=${enc(v['session'])}` }) },
  createSessionTodo: { refers: true, make: (v) => ({ body: { sessionId: v['session'], reference: 'Sweep intruder plan', items: [todoItem('intruder')] } }) },
  addTodoItem: { refers: true, make: (v) => ({ body: { sessionId: v['session'], item: todoItem('intruder'), reason: 'Sweep intruder' } }) },
  startTodoItem: { refers: true, make: (v) => ({ body: { sessionId: v['session'] } }) },
  noteTodoItem: { refers: true, make: (v) => ({ body: { sessionId: v['session'], text: 'Sweep intruder note' } }) },
  completeTodoItem: { refers: true, make: (v) => ({ body: { sessionId: v['session'], checks: [{ index: 0, passed: true, observed: 'Sweep intruder' }] } }) },
  linkTodoItem: { refers: true, make: (v) => ({ body: { sessionId: v['session'], kind: 'pr', ref: 'https://github.com/acme/sweep/pull/1' } }) },
  requestTodoDrop: { refers: true, make: (v) => ({ body: { sessionId: v['session'], reason: 'Sweep intruder' } }) },
  stopTodoSession: { refers: true, make: (v) => ({ body: { sessionId: v['session'], phase: 'begin' } }) },
  recordTodoHookError: { refers: true, make: (v) => ({ body: { sessionId: v['session'], text: 'Sweep intruder' } }) },
  setMemberTodoStopHook: { make: () => ({ body: { enabled: false } }) },
  getArtifactFile: { make: () => ({ query: 'path=index.md' }) },
  transferOrg: { make: (v) => ({ body: { login: v['login'] } }) },
  deleteOrg: { make: (v) => ({ body: { confirm: v['slug'] } }) },
  inviteOrgMembers: { make: () => ({ body: { invites: [{ email: email('sweep-intruder'), role: 'admin' }] } }) },
  answerApproval: { make: () => ({ body: { answer: 'approve', shownDigest: 'sha256:00' } }) },
  pauseGroupMember: { make: () => ({ body: { until: '2099-01-01T00:00:00Z' } }) },
};

const enc = (v: string | undefined) => encodeURIComponent(v ?? '');

/** An item of a session todo: a complete description and one typed check (todos.v1). */
const todoItem = (id: string) => ({
  id,
  name: `Sweep item ${id}`,
  description: `Sweep item ${id}: what, where, why and what is out of scope, enough for a new agent to do it alone.`,
  doneWhen: { text: 'Its pull request is merged', checks: [{ type: 'pr_merged', repo: 'acme/sweep' }] },
});

// ---------------------------------------------------------------------------------------------------------------------
// The contract

interface Contract {
  readonly doc: unknown;
  readonly cases: Case[];
  readonly uncovered: string[];
}

/** Why the contract cannot be read, or ''; in the CI it is always given (a missing file fails E2E-SWEEP-001). */
const CONTRACT_MISSING = SERVED_FILE === '' || OPENAPI_FILE === '' ? 'no OSTROM_E2E_SERVED_ROUTES or OSTROM_E2E_OPENAPI' : '';

function contract(): Contract {
  const doc: unknown = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8'));
  // The served list and the scan of the server, then every operation the contract marks served (a route the scan missed).
  const served = mergeServed(parseServed(readFileSync(SERVED_FILE, 'utf8')), servedInContract(doc));
  return { doc, ...plan(served, operations(doc), PARAM_KINDS, SKIPPED) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Organization A and everything it can make

interface World {
  readonly a: Person;
  readonly org: Org;
  /** A's resources, by kind. */
  readonly values: Values;
  /** A missing resource of each kind, of the same shape as A's. */
  readonly missing: Values;
  /** What would betray A in an answer, by name. */
  readonly markers: Record<string, string>;
  /** The kinds A could not make, and why. */
  readonly notMade: string[];
}

type Res = Awaited<ReturnType<typeof call>>;
const text = (r: Res) => `${r.status} ${JSON.stringify(r.body ?? '').slice(0, 200)}`;
const field = (body: unknown, ...path: string[]): string | undefined => {
  const v = path.reduce<unknown>((at, k) => (at as Record<string, unknown> | undefined)?.[k], body);
  return typeof v === 'string' && v !== '' ? v : undefined;
};
const itemsOf = (body: unknown): Record<string, unknown>[] => {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const list = (body as Record<string, unknown> | undefined)?.['items'];
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
};
const made = (r: Res, ...paths: string[][]): string => {
  if (r.status >= 300) throw new Error(text(r));
  for (const p of paths) {
    const v = field(r.body, ...p);
    if (v) return v;
  }
  throw new Error(`no id in ${text(r)}`);
};

/** A device login approved by `approver` (`POST /api/v1/auth/device`, the browser's yes, the poll): the token, or why not. */
async function deviceToken(approver: Caller, start: unknown): Promise<{ token?: string; why?: string }> {
  const from = address();
  const started = await call({ from }, 'POST', '/api/v1/auth/device', start);
  if (started.status !== 200) return { why: `POST /api/v1/auth/device → ${text(started)}` };
  const deviceCode = field(started.body, 'deviceCode');
  const userCode = field(started.body, 'userCode');
  const interval = Number(started.body['interval'] ?? 1);
  const answered = await call(approver, 'POST', '/api/v1/auth/device/answer', { userCode, approve: true });
  if (answered.status >= 300) return { why: `POST /api/v1/auth/device/answer → ${text(answered)}` };
  for (let i = 0; i < 10; i++) {
    await sleep(interval * 1000 + 300);
    const polled = await call({ from }, 'POST', '/api/v1/auth/device/token', { deviceCode });
    const token = field(polled.body, 'token');
    if (polled.status === 200 && token) return { token };
    if (polled.status !== 428 && !(polled.status === 400 && JSON.stringify(polled.body).includes('slow_down'))) return { why: `POST /api/v1/auth/device/token → ${text(polled)}` };
  }
  return { why: 'the device poll never gave a token' };
}

let worldOnce: Promise<World> | undefined;
const world = () => (worldOnce ??= makeWorld());

async function makeWorld(): Promise<World> {
  const { doc } = contract();
  const tag = randomUUID().slice(0, 8);
  const a = await signIn(email('sweep-a'));
  const org = await orgOf(a);
  const c: Caller = { ...a.caller, org: org.id };
  const login = (await profileOf(a.caller)).login;
  const values: Values = { org: org.id, slug: org.slug, login };
  const notMade: string[] = [];
  const guest = email(`sweep-guest-${tag}`);
  const make = async (kind: string, f: () => Promise<string>) => {
    try {
      values[kind] = await f();
    } catch (e) {
      notMade.push(`${kind}: ${String((e as Error).message ?? e).slice(0, 220)}`);
    }
  };
  /** A's POST of `body`, or of the contract's sample when A's own body is refused. */
  const post = async (path: string, body: unknown, opId: string, ...ids: string[][]) => {
    const first = await call(c, 'POST', path, body);
    if (first.status < 300) return made(first, ...ids);
    const op = operations(doc).find((o) => o.id === opId);
    const second = op?.body !== undefined ? await call(c, 'POST', path, sample(doc, op.body)) : first;
    if (second.status < 300) return made(second, ...ids);
    throw new Error(`POST ${path} → ${text(first)}`);
  };

  await make('invitation', async () => {
    const r = await invite(a, org.id, [guest]);
    if (r.status >= 300) throw new Error(`invite → ${text(r)}`);
    const id = field(itemsOf((await call(c, 'GET', `/api/v1/orgs/${org.id}/invitations`)).body)[0], 'id');
    if (!id) throw new Error('no invitation listed');
    return id;
  });
  await make('member', async () => {
    const mine = itemsOf((await call(c, 'GET', `/api/v1/orgs/${org.id}/members`)).body)[0];
    const id = field(mine, 'id') ?? field(mine, 'memberId');
    if (!id) throw new Error(`no member id in ${JSON.stringify(mine)}`);
    return id;
  });
  await make('authSession', async () => {
    const id = field(itemsOf((await call(c, 'GET', '/api/v1/auth/sessions')).body)[0], 'id');
    if (!id) throw new Error('no session listed');
    return id;
  });
  await make('token', () => post('/api/v1/tokens', { name: `sweep a ${tag}`, scopes: ['profile:read'], expiresInDays: 1 }, 'createToken', ['token', 'id'], ['id']));
  await make('serviceKey', () => post('/api/v1/service-keys', { name: `sweep a ${tag}`, scopes: SERVICE_KEY_SCOPES }, 'createServiceKey', ['id']));
  await make('device', async () => {
    const got = await deviceToken(c, { clientName: `sweep a ${tag}` });
    if (!got.token) throw new Error(got.why);
    const id = field(itemsOf((await call(c, 'GET', '/api/v1/devices')).body)[0], 'id');
    if (!id) throw new Error('no device listed');
    return id;
  });
  // A's phone for push (ostrom-server#196): the console's browser session holds notifications:write.
  await make('pushDevice', () => post('/api/v1/push-devices', { pushToken: `ExponentPushToken[sweep-${tag}]`, provider: 'expo', platform: 'ios' }, 'registerPushDevice', ['id']));
  const workflowId = `sweep-${tag}`;
  await make('workflow', () =>
    post(
      '/api/v1/workflows',
      {
        id: workflowId, name: `Sweep ${tag}`, domain: 'delivery', status: 'accepted', foundAt: new Date().toISOString(),
        nodes: [{ id: 'push-main', kind: 'gate', label: 'Push to main', approvers: [login], actions: [{ class: 'push-main', label: 'Push to main', patterns: [], repos: ['acme/sweep'] }] }],
        edges: [],
      },
      'createWorkflow',
      ['id'],
    ),
  );
  // A run of that workflow (its gate node waits for A's yes once the engine plays it).
  await make('run', () => post(`/api/v1/workflows/${enc(values['workflow'] ?? workflowId)}/runs`, { inputs: {} }, 'startWorkflowRun', ['id']));
  await make('package', async () => {
    const r = await call(c, 'GET', '/api/v1/packages/current');
    const digest = field(r.body, 'digest') ?? field(r.body, 'package', 'digest');
    if (!digest) throw new Error(text(r));
    return digest;
  });
  let agent: Caller | undefined;
  await make('session', async () => {
    const launch = await call(c, 'POST', '/api/v1/launches', { agent: 'claude', repo: 'acme/sweep' });
    if (launch.status >= 300) throw new Error(`launch → ${text(launch)}`);
    agent = { token: String(launch.body['agentToken']), org: org.id, from: address() };
    values['launch'] = String(launch.body['launchId']);
    const id = randomUUID();
    const opened = await call(agent, 'POST', '/api/v1/sessions', { id, launchId: launch.body['launchId'], repo: 'acme/sweep', agent: 'claude', ...(values['package'] ? { packageDigest: values['package'] } : {}) });
    if (opened.status >= 300) throw new Error(`session → ${text(opened)}`);
    return field(opened.body, 'id') ?? id;
  });
  // A's todo on that session, made by A in the console (its person): the item the item routes name.
  await make('todoItem', async () => {
    if (!values['session']) throw new Error('no session');
    const r = await call(c, 'POST', '/api/v1/todos/session', { sessionId: values['session'], reference: `Sweep plan ${tag}`, items: [todoItem('sweep-item')] });
    if (r.status >= 300) throw new Error(`todo → ${text(r)}`);
    return 'sweep-item';
  });
  // A governance write waits for a confirmation in the console (ostrom-server#146): A's pending one, by its id.
  await make('confirmation', () => post('/api/v1/rules/bulk', {}, 'bulkUpdateRules', ['confirmationId']));
  const sha = 'a'.repeat(8) + tag.replace(/[^0-9a-f]/g, '0').padEnd(32, '0');
  await make('gate', async () => {
    if (!agent) throw new Error('no session');
    const r = await call(agent, 'POST', '/api/v1/gates', { sessionId: values['session'], repo: 'acme/sweep', class: 'git.push', tool: 'Bash', command: 'git push origin main', push: { remote: 'origin', refs: [{ ref: 'refs/heads/main', sha }] } });
    return made(r, ['gate', 'id'], ['id']);
  });
  await make('approval', async () => {
    const id = field(itemsOf((await call(c, 'GET', '/api/v1/approvals?mine=true&status=pending&limit=50')).body)[0], 'id');
    if (!id) throw new Error('no pending approval for A');
    return id;
  });
  await make('receipt', async () => {
    if (!agent || !values['session']) throw new Error('no session');
    const ended = await call(agent, 'POST', `/api/v1/sessions/${values['session']}/end`, { exitCode: 0 });
    if (ended.status >= 300) throw new Error(`end → ${text(ended)}`);
    const signed = await call(agent, 'POST', `/api/v1/sessions/${values['session']}/workflow-receipt`, { digest: values['package'], agent: 'claude' });
    const id = receiptIdIn(signed.body) ?? field(itemsOf((await call(c, 'GET', '/api/v1/receipts')).body)[0], 'id');
    if (!id) throw new Error(`no receipt: ${text(signed)}`);
    return id;
  });
  await make('group', () => post('/api/v1/groups', { name: `Sweep ${tag}`, members: [login] }, 'createGroup', ['id']));
  await make('rule', () => post('/api/v1/rules', { statement: `Sweep rule ${tag}`, group: 'git' }, 'createRule', ['id']));
  await make('automation', () => post('/api/v1/automations', { name: `sweep ${tag}`, trigger: { kind: 'cron', cron: '0 21 * * *', timezone: 'Europe/Paris' }, action: { prompt: `Sweep ${tag} {{run.date}}` } }, 'createAutomation', ['id']));
  await make('wait', () => post('/api/v1/waits', { question: `Sweep question ${tag}` }, 'createWait', ['id']));
  await make('mcpServer', () => post('/api/v1/mcp/servers', { name: `sweep-${tag}`, url: 'https://mcp.example.test/mcp', transport: 'http', tools: ['search'] }, 'createMcpServer', ['name']));
  await make('mcpPolicy', async () => {
    if (!values['mcpServer']) throw new Error('no MCP server');
    return post(`/api/v1/mcp/servers/${values['mcpServer']}/policies`, { tool: 'search', conditions: [], effect: 'DENY', message: `sweep ${tag}` }, 'createMcpArgumentPolicy', ['id']);
  });
  await make('secret', () => post('/api/v1/secrets', { name: `SWEEP_${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`, value: `sweep-value-${tag}` }, 'createSecret', ['name']));
  await make('runner', () => post('/api/v1/runners', { name: `sweep-${tag}`, labels: [] }, 'registerRunner', ['id'], ['runner', 'id']));
  await make('cloudSession', () => post('/api/v1/cloud/sessions', { agent: 'claude', repo: 'https://github.com/acme/sweep' }, 'createCloudSession', ['id']));
  await make('artifact', () => post('/api/v1/artifacts', { title: `Sweep artifact ${tag}`, access: 'team', files: [{ path: 'index.md', content: `# sweep ${tag}` }] }, 'publishArtifact', ['id'], ['artifact', 'id']));
  await make('account', () =>
    post(
      '/api/v1/accounts',
      { provider: 'claude', label: `Sweep ${tag}`, providerAccountId: `acct-sweep-${tag}`, accessToken: `sk-ant-oat01-sweep-${randomUUID()}`, refreshToken: `rt-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      'enrollSharedAccount',
      ['id'],
    ),
  );

  const missing: Values = {};
  for (const kind of new Set([...Object.values(PARAM_KINDS), 'slug', 'login', 'session', 'package', 'rule', 'cloudSession'])) {
    if (FIXED[kind] !== undefined) continue;
    missing[kind] = mimic(values[kind] ?? (kind === 'package' ? 'a'.repeat(64) : randomUUID()));
  }
  const markers: Record<string, string> = { "A's tag": tag, "A's e-mail": a.email, "A's guest": guest, "A's org name": org.name };
  for (const [kind, value] of Object.entries(values)) markers[`A's ${kind}`] = value;
  return { a, org, values, missing, markers, notMade };
}

// ---------------------------------------------------------------------------------------------------------------------
// Calling

/** One request: 429 waits its `Retry-After` (five times at most); a stream is read 3 s; no answer within 15 s is 0. */
async function ask(caller: Caller, method: string, path: string, body?: unknown): Promise<Answer> {
  for (let attempt = 0; ; attempt++) {
    const json = body !== undefined;
    const signal = AbortSignal.timeout(15_000);
    try {
      const r = await fetch(url(path), { method, headers: headersOf(caller, method, json), redirect: 'manual', signal, ...(json ? { body: JSON.stringify(body) } : {}) });
      if (r.status === 429 && attempt < 5) {
        await r.body?.cancel();
        await sleep(Math.min(30, Number(r.headers.get('retry-after')) || 2) * 1000);
        continue;
      }
      return { status: r.status, text: await readSome(r, 3_000) };
    } catch (e) {
      return { status: 0, text: `no answer: ${String((e as Error).message ?? e)}` };
    }
  }
}

async function readSome(r: Response, ms: number): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const end = Date.now() + ms;
  let out = '';
  try {
    while (out.length < 65_536) {
      const left = end - Date.now();
      if (left <= 0) break;
      const chunk = await Promise.race([reader.read(), sleep(left).then(() => undefined)]);
      if (!chunk || chunk.done) break;
      out += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    // the stream was cut: what was read is the answer
  }
  await reader.cancel().catch(() => undefined);
  return out;
}

interface Intruder {
  readonly name: string;
  readonly caller: Caller;
  readonly org: Org;
}

interface Swept {
  readonly leaks: Leak[];
  readonly calls: number;
  readonly answered: number;
}

/** GET first, then the writes, deletions last: a refused deletion leaves A's resources for the next callers. */
const ORDER: Record<string, number> = { GET: 0, POST: 1, PUT: 1, PATCH: 1, DELETE: 2 };

async function sweep(intruder: Intruder, cases: readonly Case[], w: World): Promise<Swept> {
  const leaks: Leak[] = [];
  let calls = 0;
  let answered = 0;
  const ordered = [...cases].filter((c) => c.kind !== 'skipped').sort((x, y) => (ORDER[x.op.method] ?? 1) - (ORDER[y.op.method] ?? 1));
  const valuesOf = (c: Case, which: 'a' | 'missing'): { path: Values; request: Values } => {
    const request: Values = {};
    for (const kind of Object.keys(w.missing)) {
      const real = which === 'a' && !CAPABILITIES.has(kind) ? w.values[kind] : undefined;
      request[kind] = real ?? (w.missing[kind] as string);
    }
    Object.assign(request, FIXED);
    const path: Values = {};
    for (const [param, kind] of Object.entries(c.kinds)) path[param] = request[kind] as string;
    return { path, request };
  };
  const send = async (c: Case, header: string | undefined, which: 'a' | 'missing') => {
    const { path, request } = valuesOf(c, which);
    const extra = REQUESTS[c.op.id]?.make(request);
    const body = extra?.body ?? (c.op.body !== undefined && c.op.method !== 'GET' ? sample(contractDoc(), c.op.body) : undefined);
    const target = fill(c.op.path, path) + (extra?.query ? `?${extra.query}` : '');
    const caller: Caller = { ...intruder.caller, ...(header ? { org: header } : {}) };
    calls++;
    const answer = await ask(caller, c.op.method, target, body);
    if (answer.status > 0 && answer.status < 400) answered++;
    const sent = [...Object.values(path), ...(header ? [header] : []), ...(extra?.query ? [extra.query] : []), ...(body !== undefined ? [JSON.stringify(body)] : [])];
    return { answer, sent };
  };
  const check = async (c: Case, variant: string, kind: CaseClass, header: string | undefined, missingHeader: string | undefined, compare: boolean) => {
    const a = await send(c, header, 'a');
    const missing = compare ? await send(c, missingHeader, 'missing') : undefined;
    const reasons = a.answer.status === 0 || (missing && missing.answer.status === 0) ? [`no answer within 15 s`] : judge(kind, a, missing, w.markers);
    if (reasons.length) leaks.push({ caller: intruder.name, route: c.label, variant, status: a.answer.status, reasons, body: a.answer.text.slice(0, 300) });
  };
  const A = w.org.id;
  const B = intruder.org.id;
  for (const c of ordered) {
    const refers = REQUESTS[c.op.id]?.refers === true;
    if (c.kind === 'public') {
      await check(c, 'Ostrom-Org: A', c.op.params.length > 0 ? 'org' : 'own', A, A, c.op.params.length > 0);
    } else if (c.kind === 'strict') {
      await check(c, c.op.orgScoped ? 'Ostrom-Org: A' : 'A in the path', 'strict', c.op.orgScoped ? A : undefined, c.op.orgScoped ? A : undefined, true);
      if (c.op.orgScoped) await check(c, 'Ostrom-Org: B', 'strict', B, B, true);
    } else if (c.kind === 'org') {
      await check(c, 'Ostrom-Org: A', 'org', A, w.missing['org'], true);
      if (refers) await check(c, 'Ostrom-Org: B, A named in the request', 'refs', B, B, true);
      else if (c.op.method === 'GET') await check(c, 'Ostrom-Org: B', 'own', B, undefined, false);
    } else {
      await check(c, 'own account', 'own', A, undefined, false);
    }
  }
  return { leaks, calls, answered };
}

let docOnce: unknown;
const contractDoc = () => (docOnce ??= contract().doc);

// ---------------------------------------------------------------------------------------------------------------------
// The intruders: five credentials of organization B

/** The only scopes a service key may hold since ostrom-server#158: the CI's report and rule reads. */
const SERVICE_KEY_SCOPES = ['sessions:write', 'rules:read'];

const scopesOf = async (caller: Caller): Promise<string[]> => {
  const r = await call(caller, 'GET', '/api/v1/tokens/scopes');
  const list = (r.body?.['scopes'] as { scope?: string }[] | undefined) ?? [];
  return list
    .map((s) => s.scope ?? '')
    .filter((s) => s !== '' && !s.includes('*') && s !== 'gates:answer' && s !== 'agent:session')
    .slice(0, 32);
};

let bOnce: Promise<{ person: Person; org: Org; caller: Caller }> | undefined;
const sideB = () =>
  (bOnce ??= (async () => {
    const person = await signIn(email('sweep-b'));
    const org = await orgOf(person);
    return { person, org, caller: { ...person.caller, org: org.id } };
  })());

const INTRUDERS: Record<string, () => Promise<Intruder | string>> = {
  'browser session': async () => {
    const b = await sideB();
    return { name: 'browser session', caller: b.person.caller, org: b.org };
  },
  'personal token': async () => {
    const b = await sideB();
    const r = await call(b.caller, 'POST', '/api/v1/tokens', { name: 'sweep b', scopes: await scopesOf(b.caller), expiresInDays: 1 });
    const secret = field(r.body, 'secret');
    if (!secret) throw new Error(`POST /api/v1/tokens → ${text(r)}`);
    return { name: 'personal token', caller: { token: secret, from: address() }, org: b.org };
  },
  'CLI token': async () => {
    const b = await sideB();
    const got = await deviceToken(b.caller, { clientName: 'sweep b' });
    if (!got.token) throw new Error(got.why);
    return { name: 'CLI token', caller: { token: got.token, from: address() }, org: b.org };
  },
  'admin token (osg_)': async () => {
    const b = await sideB();
    // `ostrom login --admin` since ostrom-server#137 (5949f7c1): the device login asks for the three governance scopes,
    // B's owner approves it acting in B, and the token is an elevated `osg_` bound to B.
    const got = await deviceToken(b.caller, { clientName: 'sweep b admin', scopes: ['policy:write', 'harness:write', 'gates:policy'] });
    if (!got.token) throw new Error(`ostrom login --admin: ${got.why}`);
    if (!got.token.startsWith('osg_')) throw new Error(`ostrom login --admin gave a ${got.token.slice(0, 4)}… token, not osg_ (a server before ostrom-server#137?)`);
    return { name: 'admin token (osg_)', caller: { token: got.token, from: address() }, org: b.org };
  },
  'service key': async () => {
    const b = await sideB();
    const r = await call(b.caller, 'POST', '/api/v1/service-keys', { name: 'sweep b', scopes: SERVICE_KEY_SCOPES });
    const secret = field(r.body, 'secret');
    if (!secret) throw new Error(`POST /api/v1/service-keys → ${text(r)}`);
    return { name: 'service key', caller: { token: secret, from: address() }, org: b.org };
  },
};

const ORGS = SERVER_URL === '' ? 'no server' : await orgsUnavailable();
const named = (title: string, why: string) => (why ? `${title} (skipped: ${why})` : title);
const format = (l: Leak) => `${leakKey(l)} → ${l.status}: ${l.reasons.join('; ')} — ${l.body}`;

describe('E2E-SWEEP: isolation between organizations, generated from the contract', () => {
  it.skipIf(CONTRACT_MISSING !== '' && process.env['CI'] === undefined)(named('E2E-SWEEP-001 every served route has a case', CONTRACT_MISSING && process.env['CI'] === undefined ? CONTRACT_MISSING : ''), () => {
    expect(CONTRACT_MISSING, 'the CI gives the contract of ostrom-core and the routes of the server under test').toBe('');
    const { cases, uncovered } = contract();
    const by = (k: CaseClass) => cases.filter((c) => c.kind === k).length;
    console.info(`E2E-SWEEP-001: ${cases.length} cases (${by('strict')} on A's ids, ${by('org')} in an organization, ${by('own')} on the caller's account, ${by('public')} public, ${by('skipped')} not called)`);
    expect(uncovered).toEqual([]);
    expect(cases.length).toBeGreaterThan(150);
  });

  const SWEEP_MISSING = CONTRACT_MISSING || ORGS;
  for (const [n, name] of Object.keys(INTRUDERS).entries()) {
    it.skipIf(SWEEP_MISSING !== '')(named(`E2E-SWEEP-00${n + 2} a ${name} of B gets nothing of A, on every served route`, SWEEP_MISSING), async (ctx) => {
      const { cases } = contract();
      const w = await world();
      const intruder = await (INTRUDERS[name] as () => Promise<Intruder | string>)();
      if (typeof intruder === 'string') {
        console.info(`E2E-SWEEP ${name}: ${intruder}`);
        ctx.skip();
        return;
      }
      const swept = await sweep(intruder, cases, w);
      const { unexpected, fixed } = reconcile(
        swept.leaks,
        Object.fromEntries(Object.entries(KNOWN).filter(([k]) => k.startsWith(`${name} | `))),
      );
      console.info(
        `E2E-SWEEP ${name}: ${swept.calls} calls, ${swept.answered} below 400; A could not make: ${w.notMade.join(' · ') || 'nothing'}; ` +
          `leaks: ${swept.leaks.length} (${swept.leaks.length - unexpected.length} known)`,
      );
      for (const l of swept.leaks) console.info(`  ${format(l)}`);
      // A caller refused everywhere would prove nothing: it must be served somewhere (its own organization's routes).
      expect(swept.answered, `${name} was never served`).toBeGreaterThan(0);
      expect(unexpected.map(format)).toEqual([]);
      expect(fixed, 'known leaks that no longer happen: take them out of KNOWN').toEqual([]);
    }, T);
  }
});
