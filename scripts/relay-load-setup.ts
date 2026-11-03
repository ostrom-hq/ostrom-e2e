// SPDX-License-Identifier: Apache-2.0
// Prepares the load tests of the inference gateway and of the MCP relay (load/inference.js, streams.js, cut.js,
// mcp.js) on the running server, through its own routes: a member (relay-a, owner of a new organization) with a
// personal token holding `inference:use`, `mcp:use` and `usage:read`, and four HTTP MCP servers of the organization,
// assigned to everyone, on the fake upstreams: `fast`, `slow` and `hang` (src/fake-upstreams.ts), and `down` (an
// address nothing listens on). Then one model call and one tool list through the server prove the path.
// Writes `inference=true|false`, `mcp=true|false` and `reason` to $GITHUB_OUTPUT, the token to $GITHUB_ENV (masked).
// Never fails the job: what is not ready is skipped with the reason.
// Usage (CI): OSTROM_E2E_SERVER_URL=… OSTROM_E2E_MAIL_DIR=… OSTROM_LOAD_FAKE_MCP_URL=https://… \
//   OSTROM_LOAD_FAKE_MCP_DOWN_URL=https://… node scripts/relay-load-setup.ts
import { appendFileSync } from 'node:fs';
import { SERVER_URL } from '../scenarios/env.ts';
import { call, email, orgOf, orgsUnavailable, signIn } from '../scenarios/org.ts';

const MCP_URL = (process.env['OSTROM_LOAD_FAKE_MCP_URL'] ?? '').replace(/\/$/, '');
const DOWN_URL = process.env['OSTROM_LOAD_FAKE_MCP_DOWN_URL'] ?? '';
const MODEL = process.env['OSTROM_LOAD_MODEL'] ?? 'claude-opus-5';
const out = (file: string | undefined, line: string) => (file ? appendFileSync(file, `${line}\n`) : console.log(line));

interface Ready {
  inference: boolean;
  mcp: boolean;
  reasons: string[];
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

async function inferenceWorks(token: string): Promise<string> {
  const r = await fetch(`${SERVER_URL.replace(/\/$/, '')}/api/v1/inference/v1/messages`, {
    method: 'POST',
    headers: { ...bearer(token), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }], ostrom_fake: { chunks: 1 } }),
  });
  const text = await r.text();
  return r.status === 200 && text.includes('"output_tokens"') ? '' : `inference → ${r.status} ${text.slice(0, 200)}`;
}

async function mcpWorks(token: string, owner: Parameters<typeof call>[0]): Promise<string> {
  if (MCP_URL === '' || DOWN_URL === '') return 'no fake MCP URL (OSTROM_LOAD_FAKE_MCP_URL, OSTROM_LOAD_FAKE_MCP_DOWN_URL)';
  for (const [name, url] of [['fast', `${MCP_URL}/mcp/fast`], ['slow', `${MCP_URL}/mcp/slow`], ['hang', `${MCP_URL}/mcp/hang`], ['down', DOWN_URL]] as const) {
    const created = await call(owner, 'POST', '/api/v1/mcp/servers', { name, url, transport: 'http', scope: 'shared' });
    if (created.status !== 201) return `mcp server ${name} → ${created.status} ${JSON.stringify(created.body)}`;
    const assigned = await call(owner, 'PUT', `/api/v1/mcp/servers/${name}/assignments/all`, {});
    if (assigned.status !== 200) return `mcp assignment ${name} → ${assigned.status} ${JSON.stringify(assigned.body)}`;
  }
  const r = await fetch(`${SERVER_URL.replace(/\/$/, '')}/api/v1/mcp/fast`, {
    method: 'POST',
    headers: { ...bearer(token), accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await r.text();
  // The relay reaching the fake over TLS proves the bench's CA is trusted by the server image.
  return r.status === 200 && text.includes('"echo"') ? '' : `mcp tools/list → ${r.status} ${text.slice(0, 200)}`;
}

async function setup(): Promise<Ready> {
  const ready: Ready = { inference: false, mcp: false, reasons: [] };
  if (SERVER_URL === '') return { ...ready, reasons: ['no server'] };
  const orgs = await orgsUnavailable();
  if (orgs) return { ...ready, reasons: [orgs] };
  const owner = await signIn(email('relay-a'));
  await orgOf(owner);
  const token = await call(owner.caller, 'POST', '/api/v1/tokens', { name: 'k6 relay', scopes: ['inference:use', 'mcp:use', 'usage:read'], expiresInDays: 1 });
  const secret = token.body?.['secret'];
  if (token.status !== 201 || typeof secret !== 'string') return { ...ready, reasons: [`token → ${token.status} ${JSON.stringify(token.body)}`] };
  console.log(`::add-mask::${secret}`);
  out(process.env['GITHUB_ENV'], `OSTROM_LOAD_RELAY_TOKEN=${secret}`);
  const inference = await inferenceWorks(secret);
  const mcp = await mcpWorks(secret, owner.caller);
  return { inference: inference === '', mcp: mcp === '', reasons: [inference, mcp].filter((r) => r !== '') };
}

function report(ready: Ready): void {
  const reason = ready.reasons.join('; ').replaceAll('\n', ' ').slice(0, 500);
  out(process.env['GITHUB_OUTPUT'], `inference=${ready.inference}`);
  out(process.env['GITHUB_OUTPUT'], `mcp=${ready.mcp}`);
  out(process.env['GITHUB_OUTPUT'], `reason=${reason}`);
  if (reason) console.log(`::notice title=relay load tests::${reason}`);
}

// A rejection outside `setup`'s awaits (a request of a helper left running) still ends in a reason, never in a failed
// step (run 41549238361: "fetch failed, other side closed", the server pod behind the port-forward OOMKilled).
let reported = false;
const fail = (error: unknown) => {
  if (!reported) report({ inference: false, mcp: false, reasons: [`setup failed: ${String(error)}`] });
  reported = true;
  process.exit(0);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

let ready: Ready;
try {
  ready = await setup();
} catch (error) {
  ready = { inference: false, mcp: false, reasons: [`setup failed: ${String(error)}`] };
}
reported = true;
report(ready);
