// SPDX-License-Identifier: Apache-2.0
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeExpo } from '../src/fake-expo.ts';

let expo: FakeExpo | undefined;
afterEach(async () => {
  await expo?.stop();
  expo = undefined;
});

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

const message = (to: string, approvalId = 'a-1') => ({ to, title: 'ana asks for your yes', body: 'Push to main · acme/app', sound: 'default', data: { kind: 'approval', approvalId } });

describe('FakeExpo', () => {
  it("accepts a batch of messages with a ticket each, as Expo's push service does, and records them in order", async () => {
    expo = await new FakeExpo().start();
    expect(expo.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/--\/api\/v2\/push\/send$/);
    const r = await post(expo.url, JSON.stringify([message('ExponentPushToken[a]'), message('ExponentPushToken[b]', 'a-2')]), { authorization: 'Bearer expo-token' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { data: { status: string; id: string }[] };
    expect(body.data.map((t) => t.status)).toEqual(['ok', 'ok']);
    expect(new Set(body.data.map((t) => t.id)).size).toBe(2);
    expect(expo.messages.map((m) => [m.to, m.data['approvalId']])).toEqual([['ExponentPushToken[a]', 'a-1'], ['ExponentPushToken[b]', 'a-2']]);
    expect(expo.messages[0]).toMatchObject({ title: 'ana asks for your yes', body: 'Push to main · acme/app', authorization: 'Bearer expo-token' });
    expect(expo.requests).toBe(1);
  });

  it('reads a single message object too, and a message without data or text', async () => {
    expo = await new FakeExpo().start();
    expect((await post(expo.url, JSON.stringify({ to: 'ExponentPushToken[c]' }))).status).toBe(200);
    expect(expo.messages).toEqual([{ to: 'ExponentPushToken[c]', title: undefined, body: undefined, data: {}, authorization: undefined }]);
  });

  it('refuses the next requests it is told to, with a 503 that records nothing, then accepts again', async () => {
    expo = await new FakeExpo().start();
    expo.refuseNext = 1;
    const refused = await post(expo.url, JSON.stringify([message('ExponentPushToken[a]')]));
    expect(refused.status).toBe(503);
    expect(expo.messages).toEqual([]);
    expect(expo.refused).toBe(1);
    expect((await post(expo.url, JSON.stringify([message('ExponentPushToken[a]')]))).status).toBe(200);
    expect(expo.messages).toHaveLength(1);
    expect(expo.requests).toBe(2);
  });

  it('waits for the messages sent to a token, and gives up after its timeout', async () => {
    expo = await new FakeExpo().start();
    const waited = expo.waitFor((m) => m.to === 'ExponentPushToken[late]', 2_000);
    await post(expo.url, JSON.stringify([message('ExponentPushToken[other]')]));
    await post(expo.url, JSON.stringify([message('ExponentPushToken[late]')]));
    expect((await waited).to).toBe('ExponentPushToken[late]');
    // already there: answered at once
    expect((await expo.waitFor((m) => m.to === 'ExponentPushToken[other]', 10)).to).toBe('ExponentPushToken[other]');
    await expect(expo.waitFor((m) => m.to === 'ExponentPushToken[never]', 50)).rejects.toThrow(/no push.*50 ms/);
  });

  it('answers 404 elsewhere, 405 to another method, 400 to a body that is not JSON, and 413 past 64 KiB', async () => {
    expo = await new FakeExpo().start();
    const base = expo.url.replace('/--/api/v2/push/send', '');
    expect((await post(`${base}/other`, '[]')).status).toBe(404);
    expect((await fetch(expo.url)).status).toBe(405);
    expect((await post(expo.url, 'not json')).status).toBe(400);
    expect((await post(expo.url, JSON.stringify([{ to: 'x'.repeat(70 * 1024) }]))).status).toBe(413);
    expect(expo.messages).toEqual([]);
  });

  it('drops a request cut off mid-body without answering, and listens once until stopped', async () => {
    expo = await new FakeExpo().start();
    await expect(expo.start()).rejects.toThrow(/already listening/);
    const { port } = new URL(expo.url);
    await new Promise<void>((resolve) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/--/api/v2/push/send', headers: { 'content-length': '100' } });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.write('[{"to":');
      setTimeout(() => req.destroy(), 50);
    });
    expect(expo.messages).toEqual([]);
    await expo.stop();
    await expo.stop();
    expo = undefined;
  });
});
