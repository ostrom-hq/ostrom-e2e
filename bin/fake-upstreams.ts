// SPDX-License-Identifier: Apache-2.0
// Runs the fake provider and the fake MCP servers (src/fake-upstreams.ts) for the chart load pass, in a pod of the kind
// cluster: HTTP on FAKE_PORT (8080), HTTPS on FAKE_TLS_PORT (8443) when FAKE_TLS_KEY and FAKE_TLS_CERT name the files
// of a certificate the server trusts, `/mcp/slow` FAKE_MCP_SLOW_MS (1000) late. Stops on SIGTERM.
// Usage: node bin/fake-upstreams.ts
import { readFileSync } from 'node:fs';
import { FakeUpstreams } from '../src/fake-upstreams.ts';

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const keyFile = process.env['FAKE_TLS_KEY'];
const certFile = process.env['FAKE_TLS_CERT'];
const tls = keyFile && certFile ? { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8'), port: Number(env('FAKE_TLS_PORT', '8443')) } : undefined;
const fakes = new FakeUpstreams(Number(env('FAKE_MCP_SLOW_MS', '1000')));
const urls = await fakes.start(Number(env('FAKE_PORT', '8080')), tls, env('FAKE_HOST', '0.0.0.0'));
console.log(`fake upstreams: ${JSON.stringify(urls)}`);
process.on('SIGTERM', () => void fakes.stop().then(() => process.exit(0)));
