// SPDX-License-Identifier: Apache-2.0
// A fake of Expo's push service (`POST /--/api/v2/push/send`), which hands the app's notifications to APNs and FCM: the
// server's OSTROM_EXPO_PUSH_URL points here (ostrom-server#228), so a scenario reads which phone was told of which
// request for a yes, and which was not, without a real phone nor a real key. It answers as Expo does, a ticket per
// message (`{data: [{status: "ok", id}]}`), or 503 for the requests it is told to refuse (a provider that fails, which
// the server logs and tries again). It records the messages it accepted, never a refused one.
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A message Expo accepted: the device's push token, its texts, its data, and the access token sent with it. */
export interface PushMessage {
  readonly to: string | undefined;
  readonly title: string | undefined;
  readonly body: string | undefined;
  /** The Android notification channel the message names (the app's `requests`). */
  readonly channelId: string | undefined;
  readonly data: Record<string, unknown>;
  /** The `Authorization` the server sent: its Expo access token (OSTROM_EXPO_ACCESS_TOKEN), when it has one. */
  readonly authorization: string | undefined;
}

export const PUSH_PATH = '/--/api/v2/push/send';

export class FakeExpo {
  /** The accepted messages, in order. */
  readonly messages: PushMessage[] = [];
  /** How many of the next requests are answered 503 (Expo down). */
  refuseNext = 0;
  /** The requests answered 503. */
  refused = 0;
  /** The requests to the push path, accepted or refused. */
  requests = 0;
  private readonly waiters: { matches: (m: PushMessage) => boolean; resolve: (m: PushMessage) => void }[] = [];
  private server: Server | undefined;
  private port = 0;

  /** `http://127.0.0.1:<port>/--/api/v2/push/send`, once started. */
  get url(): string {
    return `http://127.0.0.1:${this.port}${PUSH_PATH}`;
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

  /** The first accepted message that [matches], already received or to come within [timeoutMs]. */
  waitFor(matches: (m: PushMessage) => boolean, timeoutMs: number): Promise<PushMessage> {
    const seen = this.messages.find(matches);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve: (m: PushMessage) => (clearTimeout(timer), resolve(m)) };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`no push matching after ${timeoutMs} ms (${this.messages.length} received)`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY) return send(res, 413, { errors: [{ code: 'PUSH_TOO_MANY_BYTES' }] });
      chunks.push(chunk);
    }
    if (req.url !== PUSH_PATH) return send(res, 404, { errors: [{ code: 'NOT_FOUND' }] });
    if (req.method !== 'POST') return send(res, 405, { errors: [{ code: 'METHOD_NOT_ALLOWED' }] });
    this.requests++;
    if (this.refuseNext > 0) {
      this.refuseNext--;
      this.refused++;
      return send(res, 503, { errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'fake outage' }] });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(res, 400, { errors: [{ code: 'VALIDATION_ERROR' }] });
    }
    const items = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
    const text = (item: Record<string, unknown>, key: string) => (typeof item[key] === 'string' ? (item[key] as string) : undefined);
    const tickets = items.map((item) => {
      const data = typeof item['data'] === 'object' && item['data'] !== null ? (item['data'] as Record<string, unknown>) : {};
      const m: PushMessage = { to: text(item, 'to'), title: text(item, 'title'), body: text(item, 'body'), channelId: text(item, 'channelId'), data, authorization: req.headers.authorization };
      this.messages.push(m);
      for (const w of this.waiters.filter((x) => x.matches(m))) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(m);
      }
      return { status: 'ok', id: `ticket-${this.messages.length}` };
    });
    return send(res, 200, { data: tickets });
  }
}

/** Expo takes at most 100 messages of a few hundred bytes a request: anything past 64 KiB is not the server's. */
const MAX_BODY = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
