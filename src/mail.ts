// SPDX-License-Identifier: Apache-2.0
// Reads the sign-in links the server writes to OSTROM_MAIL_DIR instead of sending them (one file per mail:
// `To: …`, `Subject: …`, a blank line, the text). The token is in the link's fragment: `…/auth/email#token=<token>`
// for a sign-in, `…/invite#token=<token>` for an invitation to an organization (ostrom-server#51).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The token of the newest mail sent to `email` in `dir` whose link ends with `page` before `#token=` (any link when
 * `page` is empty), or undefined.
 */
export function signInToken(dir: string, email: string, page = ''): string | undefined {
  const link = new RegExp(`${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#token=([A-Za-z0-9._~%-]+)`);
  const mails = readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, at: statSync(path).mtimeMs, text: readFileSync(path, 'utf8') }))
    .filter((m) => m.text.toLowerCase().startsWith(`to: ${email.toLowerCase()}\n`))
    .sort((a, b) => b.at - a.at || b.path.localeCompare(a.path));
  for (const m of mails) {
    const token = link.exec(m.text)?.[1];
    if (token) return decodeURIComponent(token);
  }
  return undefined;
}

/** The token of the newest invitation to an organization mailed to `email` (`…/invite#token=`). */
export const invitationToken = (dir: string, email: string) => signInToken(dir, email, '/invite');
