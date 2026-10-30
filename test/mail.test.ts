import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signInToken } from '../src/mail.ts';

const mail = (to: string, link: string) => `To: ${to}\nSubject: Sign in to Ostrom\n\nSign in to Ostrom as ${to} with this link:\n\n${link}\n`;

describe('signInToken', () => {
  it('returns the token of the newest mail to that address, decoded, ignoring others and folders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ostrom-mail-'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'a.eml'), mail('dev-a@example.test', 'http://c/auth/email#token=old'));
    writeFileSync(join(dir, 'b.eml'), mail('dev-a@example.test', 'http://c/auth/email#token=new%2Bone'));
    writeFileSync(join(dir, 'c.eml'), mail('rev-b@example.test', 'http://c/auth/email#token=other'));
    writeFileSync(join(dir, 'd.eml'), mail('Dev-A@example.test', 'no link here'));
    utimesSync(join(dir, 'a.eml'), 1000, 1000);
    utimesSync(join(dir, 'b.eml'), 2000, 2000);
    utimesSync(join(dir, 'd.eml'), 3000, 3000);
    expect(signInToken(dir, 'DEV-A@example.test')).toBe('new+one');
    expect(signInToken(dir, 'rev-b@example.test')).toBe('other');
    expect(signInToken(dir, 'nobody@example.test')).toBeUndefined();
  });

  it('breaks a tie on the time by the file name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ostrom-mail-'));
    writeFileSync(join(dir, '1.eml'), mail('x@example.test', 'http://c/#token=first'));
    writeFileSync(join(dir, '2.eml'), mail('x@example.test', 'http://c/#token=second'));
    utimesSync(join(dir, '1.eml'), 5000, 5000);
    utimesSync(join(dir, '2.eml'), 5000, 5000);
    expect(signInToken(dir, 'x@example.test')).toBe('second');
  });
});
