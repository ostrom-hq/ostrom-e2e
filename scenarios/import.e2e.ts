// SPDX-License-Identifier: Apache-2.0
// E2E-TC-003 and 004: a TeamCode team into Ostrom with the real `ostrom import teamcode`, against the real server, the
// fake TeamCode team of ostrom-helm in MySQL (compose/demo/teamcode, helm#25) and a fake provider token endpoint
// (src/fake-tokens.ts, the server's OSTROM_SHARING_CLAUDE_TOKEN_URL, ostrom-server#96). The plan, the import, the
// accounts that wait while TeamCode runs, then the owner's cutover: accounts revived, one refused, exit codes, and the
// audit event in the owner's name. Each part says why it is skipped until its pieces are there.
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeTokens } from '../src/fake-tokens.ts';
import { isServed } from '../src/probe.ts';
import { CLI_BIN, DATABASE_ADMIN_URL, FAKE_TOKENS_PORT, SERVER_URL, TEAMCODE_DB, TEAMCODE_KEY_FILE, TEAMCODE_PASSWORD } from './env.ts';
import { type Run, person } from './lib.ts';
import { type Person, call, email, orgOf, orgsUnavailable, profileOf, signIn } from './org.ts';

async function unavailable(): Promise<string> {
  if (CLI_BIN === '') return 'no ostrom binary';
  if (TEAMCODE_DB === '' || TEAMCODE_KEY_FILE === '') return 'no fake TeamCode team (OSTROM_E2E_TEAMCODE_DB, OSTROM_E2E_TEAMCODE_KEY_FILE)';
  if (DATABASE_ADMIN_URL === '') return 'no OSTROM_E2E_DATABASE_ADMIN_URL';
  const orgs = await orgsUnavailable();
  if (orgs !== '') return orgs;
  const needed: [string, string][] = [['POST', '/api/v1/tokens'], ['POST', '/api/v1/import/teamcode'], ['GET', '/api/v1/accounts']];
  const missing: string[] = [];
  for (const [method, path] of needed) if (!(await isServed(SERVER_URL, path, method))) missing.push(`${method} ${path}`);
  return missing.length ? `not served yet: ${missing.join(', ')}` : '';
}

const WHY = await unavailable();
const CUTOVER_WHY =
  WHY !== '' ? WHY : FAKE_TOKENS_PORT > 0 ? '' : "no fake token endpoint (OSTROM_E2E_FAKE_TOKENS_PORT, the server's OSTROM_SHARING_CLAUDE_TOKEN_URL of ostrom-server#96): stops at the plan";
const named = (title: string, why: string) => (why === '' ? title : `${title} (skipped: ${why})`);

/** TeamCode's refresh tokens of the fake team's two Claude accounts (compose/demo/teamcode/seed.mjs, fake). */
const MAX_1 = 'sk-ant-ort-demo-1';
const MAX_2 = 'sk-ant-ort-demo-2';
/** The public client id of Claude Code, sent with every refresh (HttpOAuthRefresher). */
const CLAUDE_CODE_CLIENT = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

type Account = { id: string; label: string; providerAccountId?: string; status: string };

/** What the scenarios share: the owner, their org, their console token, the CLI as them. */
interface Team {
  owner: Person;
  orgId: string;
  userId: string;
  token: string;
  run(...args: string[]): Promise<Run>;
}
let team: Team | undefined;

async function teamOf(): Promise<Team> {
  if (team) return team;
  const owner = await signIn(email('tc-owner'));
  const org = await orgOf(owner);
  const profile = await profileOf(owner.caller);
  // A console token, as an owner makes one on the console: the device token of `ostrom login` cannot import
  const pat = await call(owner.caller, 'POST', '/api/v1/tokens', { name: 'e2e TeamCode import', scopes: ['import:write', 'accounts:read', 'profile:read'], expiresInDays: 1 });
  expect(pat.status, JSON.stringify(pat.body)).toBe(201);
  const token = String(pat.body['secret']);
  const cli = person('tc-owner');
  const run = (...args: string[]) =>
    cli.ostrom(['import', 'teamcode', '--db', TEAMCODE_DB, '--key-file', TEAMCODE_KEY_FILE, ...args], { env: { OSTROM_TOKEN: token, MYSQL_PWD: TEAMCODE_PASSWORD } });
  team = { owner, orgId: org.id, userId: profile.id, token, run };
  return team;
}

async function accounts(t: Team): Promise<Account[]> {
  const r = await call(t.owner.caller, 'GET', '/api/v1/accounts');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body['items'] as Account[]).toSorted((a, b) => a.label.localeCompare(b.label));
}

/** Runs [sql] as the superuser of the bench's database; its rows, tab-separated. */
function admin(sql: string): string[] {
  const out = execFileSync('docker', ['run', '--rm', '--network', 'host', 'postgres:18', 'psql', DATABASE_ADMIN_URL, '-v', 'ON_ERROR_STOP=1', '-AtF', '\t', '-c', sql], { encoding: 'utf8', timeout: 60_000 });
  return out.split('\n').filter((l) => l !== '');
}

const uuid = (v: string) => {
  if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error(`not a uuid: ${v}`);
  return v;
};

/** The output a run shows, for a failed expectation. */
const shown = (r: Run) => `exit ${r.code}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`;

describe('E2E-TC: TeamCode into Ostrom, with the real ostrom import teamcode', () => {
  const tokens = new FakeTokens();
  afterAll(() => tokens.stop());

  it.skipIf(WHY !== '')(named('E2E-TC-003 the plan writes nothing, the import shares the accounts, and an account to reconnect waits for the cutover while TeamCode runs', WHY), async () => {
    const t = await teamOf();
    const plan = await t.run();
    expect(plan.code, shown(plan)).toBe(0);
    expect(plan.stdout).toContain('Plan (nothing imported yet):');
    expect(plan.stdout).toMatch(/planned {2}account {2}claude\/Claude Max 1/);
    expect(plan.stdout).toContain('! Left out: account Never finished');
    expect(plan.stdout).toContain('Run the same command with --yes to import.');
    expect(await accounts(t), 'the plan writes nothing').toEqual([]);

    const imported = await t.run('--yes');
    expect(imported.code, shown(imported)).toBe(0);
    expect(imported.stdout).toMatch(/created {2}account {2}claude\/Claude Max 1\n/);
    const shared = await accounts(t);
    expect(shared.map((a) => [a.label, a.status])).toEqual([['Claude Max 1', 'ready'], ['Claude Max 2 (paused)', 'disabled']]);

    // Ostrom's copies lose their tokens, as when a refresh is refused (AccountTokens.retire): they wait for a
    // reconnection. While TeamCode runs, an import never tests TeamCode's tokens: testing rotates them.
    admin(`UPDATE sharing_accounts SET status = 'RECONNECT_REQUIRED', version = version + 1 WHERE org_id = '${uuid(t.orgId)}'`);
    const again = await t.run('--yes');
    expect(again.code, shown(again)).toBe(0);
    expect(again.stdout).toMatch(/revive_at_cutover {2}account {2}claude\/Claude Max 1 \(/);
    expect(again.stdout).toContain('2 to revive at the cutover.');
    expect(again.stdout).toContain('! 2 shared accounts wait for the final pass once TeamCode stops: ostrom import teamcode --cutover');
    expect((await accounts(t)).map((a) => a.status)).toEqual(['reconnect_required', 'reconnect_required']);
  });

  it.skipIf(CUTOVER_WHY !== '')(named("E2E-TC-004 the owner's cutover revives the waiting accounts with TeamCode's tokens, leaves a refused one waiting (2), and is audited in the owner's name", CUTOVER_WHY), async () => {
    const t = await teamOf();
    await tokens.start(FAKE_TOKENS_PORT);
    const before = admin(`SELECT count(*) FROM identity_audit_events WHERE org_id = '${uuid(t.orgId)}' AND action = 'import.teamcode.cutover'`);

    // without a terminal the word is given with --confirm; --yes and another word are no cutover
    const noTerminal = await t.run('--cutover');
    expect(noTerminal.code, shown(noTerminal)).toBe(64);
    expect(noTerminal.stderr).toContain('add --confirm cutover');
    expect((await t.run('--cutover', '--yes')).code).toBe(64);
    const declined = await t.run('--cutover', '--confirm', 'yes');
    expect(declined.code, shown(declined)).toBe(2);
    expect(declined.stdout).toContain('Cutover plan (nothing changed yet):');
    expect(declined.stdout).toMatch(/planned {2}account {2}claude\/Claude Max 1/);
    expect(declined.stdout).toContain('The cutover writes 2 shared accounts');
    expect(tokens.refreshes, 'a plan tests no token').toEqual([]);

    // The provider forgot one of TeamCode's refresh tokens: that account keeps waiting, the cutover ends with 2
    tokens.refused.add(MAX_2);
    const partial = await t.run('--cutover', '--confirm', 'cutover');
    expect(partial.code, shown(partial)).toBe(2);
    expect(partial.stdout).toMatch(/updated {2}account {2}claude\/Claude Max 1\n/);
    expect(partial.stdout).toMatch(/skipped {2}account {2}claude\/Claude Max 2 \(paused\) \(.+refused/);
    expect(partial.stdout).toContain('! 1 shared account left as before');
    expect(tokens.refreshes.map((r) => r.refreshToken).toSorted()).toEqual([MAX_1, MAX_2]);
    expect(tokens.refreshes.every((r) => r.grantType === 'refresh_token' && r.clientId === CLAUDE_CODE_CLIENT)).toBe(true);
    expect((await accounts(t)).map((a) => [a.label, a.status])).toEqual([['Claude Max 1', 'ready'], ['Claude Max 2 (paused)', 'reconnect_required']]);

    // The provider takes it again: the same command revives it, turned off as TeamCode had it
    tokens.refused.clear();
    const rest = await t.run('--cutover', '--confirm', 'cutover');
    expect(rest.code, shown(rest)).toBe(0);
    expect(rest.stdout).toMatch(/updated {2}account {2}claude\/Claude Max 2 \(paused\)\n/);
    expect(tokens.refreshes.at(-1)?.refreshToken).toBe(MAX_2);
    expect((await accounts(t)).map((a) => [a.label, a.status])).toEqual([['Claude Max 1', 'ready'], ['Claude Max 2 (paused)', 'disabled']]);
    const done = await t.run('--cutover', '--confirm', 'cutover');
    expect(done.code, shown(done)).toBe(0);
    expect(done.stdout).toContain('No shared account waits for the cutover: nothing to do.');

    // One audit event per cutover run, in the owner's name, before any write: the plans and the refusal record none
    const events = admin(`SELECT actor_id, details FROM identity_audit_events WHERE org_id = '${uuid(t.orgId)}' AND action = 'import.teamcode.cutover' ORDER BY sequence`);
    expect(events.length - Number(before[0])).toBe(2);
    for (const line of events) {
      const [actor, details] = line.split('\t');
      expect(actor).toBe(t.userId);
      expect(JSON.parse(String(details))).toMatchObject({ mode: 'cutover', accounts: '2' });
    }
  });
});
