// SPDX-License-Identifier: Apache-2.0
// Shared helpers of the load tests of the inference gateway and of the MCP relay (load/inference.js, streams.js,
// cut.js, mcp.js). The calls go to the fake upstreams of src/fake-upstreams.ts: directly (OSTROM_LOAD_FAKE_URL, the
// baseline) or through the server (OSTROM_URL), with a token of a member that holds `inference:use`, `mcp:use` and
// `usage:read` (OSTROM_LOAD_RELAY_TOKEN). scripts/relay-load-setup.ts makes the token and the MCP servers before k6.
import exec from 'k6/execution';
import http from 'k6/http';
import { BASE } from './lib.js';

export const FAKE = (__ENV.OSTROM_LOAD_FAKE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
export const TOKEN = __ENV.OSTROM_LOAD_RELAY_TOKEN || '';
export const MODEL = __ENV.OSTROM_LOAD_MODEL || 'claude-opus-5';
export const GATEWAY = `${BASE}/api/v1/inference/v1/messages`;

/** Stops the run at once, with the reason, when the member's token is missing (else: 401s and vague thresholds). */
export function requireRelayToken(why) {
  if (!TOKEN) exec.test.abort(`${why} needs OSTROM_LOAD_RELAY_TOKEN (scripts/relay-load-setup.ts)`);
}

/**
 * One Anthropic Messages call, `direct` to the fake provider or through the gateway, shaped by `shape` (`chunks`,
 * `gapMs`, `ttfbMs`: src/fake-upstreams.ts). `params` adds k6 request parameters (a timeout).
 */
export function infer(direct, stream, shape, tag, params = {}) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    stream,
    messages: [{ role: 'user', content: 'Say hi.' }],
    ostrom_fake: shape,
  });
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (direct) headers['x-api-key'] = 'fake';
  else headers.authorization = `Bearer ${TOKEN}`;
  return http.post(direct ? `${FAKE}/v1/messages` : GATEWAY, body, Object.assign({ headers, tags: { name: tag } }, params));
}

/** Whether an answer is whole: a stream ends with `message_stop`, a message carries its usage. */
export function whole(r, stream) {
  if (r.status !== 200 || typeof r.body !== 'string') return false;
  return stream ? r.body.trimEnd().endsWith('data: {"type":"message_stop"}') : r.body.includes('"output_tokens"');
}

/** The fake upstreams' counts (`provider` and `mcp`: open, total, completed, aborted). */
export function fakeStats() {
  const r = http.get(`${FAKE}/stats`, { tags: { name: 'fake-stats' } });
  return r.status === 200 ? r.json() : null;
}

export function resetFake() {
  http.post(`${FAKE}/stats/reset`, null, { tags: { name: 'fake-stats' } });
}

/** A tool call through the relay (Streamable HTTP, one JSON-RPC request), on the MCP server named `server`. */
export function callTool(server, tool, args, tag, params = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` };
  return http.post(`${BASE}/api/v1/mcp/${encodeURIComponent(server)}`, body, Object.assign({ headers, tags: { name: tag } }, params));
}

/** The JSON-RPC result of a relayed call, or null when the answer is not one. */
export function rpcResult(r) {
  if (r.status !== 200) return null;
  try {
    return r.json('result') || null;
  } catch (_) {
    return null;
  }
}
