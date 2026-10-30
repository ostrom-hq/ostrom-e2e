// Reads the sign-in links the server writes to OSTROM_MAIL_DIR instead of sending them (one file per mail:
// `To: …`, `Subject: …`, a blank line, the text). The token is in the link's fragment: `…/auth/email#token=<token>`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The token of the newest sign-in mail sent to `email` in `dir`, or undefined. */
export function signInToken(dir: string, email: string): string | undefined {
  const mails = readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, at: statSync(path).mtimeMs, text: readFileSync(path, 'utf8') }))
    .filter((m) => m.text.toLowerCase().startsWith(`to: ${email.toLowerCase()}\n`))
    .sort((a, b) => b.at - a.at || b.path.localeCompare(a.path));
  for (const m of mails) {
    const token = /#token=([A-Za-z0-9._~%-]+)/.exec(m.text)?.[1];
    if (token) return decodeURIComponent(token);
  }
  return undefined;
}
