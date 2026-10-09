import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { handle, type Env } from '../worker/index';

// D1-compatible SQL fixture. Actual Worker runtime is checked separately with Wrangler.
class Statement {
  args: unknown[] = [];
  constructor(private db: Database, private query: string) {}
  bind(...args: unknown[]) { const s = new Statement(this.db, this.query); s.args = args; return s; }
  rows() { return this.db.query(this.query).all(...this.args as never[]); }
  async all() { return { results: this.rows(), success: true, meta: { changes: this.changes(), duration: 0 } }; }
  async first(column?: string) { const row = this.db.query(this.query).get(...this.args as never[]) as Record<string, unknown> | null; return column ? row?.[column] ?? null : row; }
  async run() { this.db.query(this.query).run(...this.args as never[]); return { success: true, meta: { changes: this.changes(), duration: 0 } }; }
  async raw() { return this.db.query(this.query).values(...this.args as never[]); }
  changes() { return (this.db.query('SELECT changes() AS n').get() as { n: number }).n; }
}
class LocalD1 {
  sqlite = new Database(':memory:');
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_auth.sql', '0002_progress.sql', '0003_storage_limits.sql']) this.sqlite.exec(readFileSync(new URL(`../worker/migrations/${file}`, import.meta.url), 'utf8'));
  }
  prepare(sql: string) { return new Statement(this.sqlite, sql); }
  async batch(statements: Statement[]) {
    return this.sqlite.transaction(() => statements.map(statement => {
      const results = statement.rows(); return { results, success: true, meta: { changes: statement.changes(), duration: 0 } };
    }))();
  }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 }; }
}
function fixture() {
  const db = new LocalD1();
  const env: Env = { DB: db as unknown as Env['DB'], AUTH_SECRET: 'test-only-account-fixture-secret-not-production', AUTH_ORIGIN: 'http://127.0.0.1:5178' };
  const call = (path: string, data?: unknown, cookie?: string, address = 'fixture', owner?: string) => handle(new Request(env.AUTH_ORIGIN + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { Origin: env.AUTH_ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': address, ...(cookie ? { Cookie: cookie } : {}), ...(owner ? { 'X-Longjump-Account': owner } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), env);
  return { env, db, call };
}
const pass = 'a test-only long password';
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function signup(f: ReturnType<typeof fixture>, username: string, address = 'fixture') {
  const response = await f.call('/api/account/signup', { username, password: pass }, undefined, address);
  assert.equal(response.status, 200, await response.clone().text());
  return { response, cookie: cookies(response), data: await response.json() as { user: { id: string; username: string; displayName: string }; recoveryKey: string } };
}

test('Username-only signup stores hashed credentials, sanitizes responses and creates an HTTP-only session', async () => {
  const f = fixture(); const a = await signup(f, 'TestPlayer');
  assert.equal(a.data.user.username, 'testplayer'); assert.equal(a.data.user.displayName, 'TestPlayer');
  assert.equal(a.data.recoveryKey.length, 64); assert.ok(a.cookie);
  assert.ok(a.response.headers.getSetCookie().every(value => /httponly/i.test(value)));
  assert.equal(a.response.headers.get('Cache-Control'), 'no-store');
  const stored = f.db.sqlite.query('SELECT recoveryKeyHash, email FROM user').get() as { recoveryKeyHash: string; email: string };
  assert.notEqual(stored.recoveryKeyHash, a.data.recoveryKey); assert.ok(stored.email.endsWith('@accounts.invalid'));
  const credential = f.db.sqlite.query('SELECT password FROM account').get() as { password: string };
  assert.notEqual(credential.password, pass);
  const session = await f.call('/api/account', undefined, a.cookie); const text = await session.text();
  assert.ok(text.includes('TestPlayer')); assert.ok(!text.includes(stored.email)); assert.ok(!text.includes('recoveryKeyHash'));
  const duplicate = await f.call('/api/account/signup', { username: 'testplayer', password: pass });
  assert.equal(duplicate.status, 400); assert.equal((f.db.sqlite.query('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n, 1);
  f.db.sqlite.close();
});
test('Case-insensitive login and logout invalidate the session', async () => {
  const f = fixture(); await signup(f, 'PlayerOne');
  assert.equal((await f.call('/api/account/login', { username: 'playerone', password: 'incorrect' })).status, 401);
  const login = await f.call('/api/account/login', { username: 'PLAYERONE', password: pass });
  assert.equal(login.status, 200); const cookie = cookies(login);
  assert.ok((await (await f.call('/api/account', undefined, cookie)).json() as { user: unknown }).user);
  assert.equal((await f.call('/api/account/logout', {}, cookie)).status, 200);
  assert.equal((await (await f.call('/api/account', undefined, cookie)).json() as { user: unknown }).user, null);
  f.db.sqlite.close();
});
test('Recovery rotates the key, changes the password atomically and revokes every old session', async () => {
  const f = fixture(); const a = await signup(f, 'RecoverMe');
  const newPassword = 'another test-only long password';
  const result = await f.call('/api/account/recover', { username: 'RecoverMe', recoveryKey: a.data.recoveryKey, password: newPassword });
  assert.equal(result.status, 200); const rotated = await result.json() as { recoveryKey: string };
  assert.notEqual(rotated.recoveryKey, a.data.recoveryKey);
  assert.equal((await (await f.call('/api/account', undefined, a.cookie)).json() as { user: unknown }).user, null);
  assert.equal((await f.call('/api/account/login', { username: 'RecoverMe', password: pass })).status, 401);
  assert.equal((await f.call('/api/account/login', { username: 'RecoverMe', password: newPassword })).status, 200);
  assert.equal((await f.call('/api/account/recover', { username: 'RecoverMe', recoveryKey: a.data.recoveryKey, password: pass })).status, 401);
  f.db.sqlite.close();
});
test('Unexposed email endpoints, cross-origin writes, reserved names and oversized requests are rejected', async () => {
  const f = fixture();
  assert.equal((await f.call('/api/auth/sign-up/email', { email: 'not-used@example.test', password: pass })).status, 404);
  assert.equal((await handle(new Request(f.env.AUTH_ORIGIN + '/api/account/signup', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: '{}' }), f.env)).status, 403);
  assert.equal((await f.call('/api/account/signup', { username: 'ADMIN', password: pass })).status, 400);
  assert.equal((await f.call('/api/account/signup', { username: 'GoodName', password: 'x'.repeat(5000) })).status, 413);
  f.db.sqlite.close();
});
test('Rate limits remain enforced across fresh Worker/auth instances', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) assert.equal((await f.call('/api/account/login', { username: 'Unknown', password: pass })).status, 401);
  assert.equal((await f.call('/api/account/login', { username: 'Unknown', password: pass })).status, 429);
  f.db.sqlite.close();
});
test('Cloud history deduplicates retries, merges longest PBs and isolates account ownership', async () => {
  const f = fixture(); const a = await signup(f, 'PlayerAlpha'), b = await signup(f, 'PlayerBeta');
  const attempt = { id: 'test:attempt:1', mapId: 'longjump_source_go', tickRate: 128, autoBhop: false,
    distance: 246, valid: true, landed: true, sync: 80, strafes: [], path: [] };
  const payload = { attempts: [attempt], bests: [], userId: b.data.user.id };
  assert.equal((await f.call('/api/sync', payload)).status, 401);
  for (let i = 0; i < 2; i++) assert.equal((await f.call('/api/sync', payload, a.cookie)).status, 200);
  const saved = await (await f.call('/api/sync', undefined, a.cookie)).json() as { attempts: unknown[]; bests: { distance: number }[]; cursor: number };
  assert.equal(saved.attempts.length, 1); assert.equal(saved.bests[0].distance, 246);
  assert.equal((await (await f.call('/api/sync', undefined, b.cookie)).json() as { attempts: unknown[] }).attempts.length, 0);
  assert.equal((await f.call('/api/sync', { attempts: [{ ...attempt, distance: 300 }], bests: [] }, a.cookie)).status, 409);
  const next = await (await f.call(`/api/sync?after=${saved.cursor}`, undefined, a.cookie)).json() as { attempts: unknown[] };
  assert.equal(next.attempts.length, 0);
  f.db.sqlite.close();
});
test('Storage quotas reject the entire batch, allow duplicate retries and do not affect another player', async () => {
  const f = fixture(), a = await signup(f, 'QuotaPlayer'), b = await signup(f, 'OtherPlayer');
  const attempt = { id: 'quota:1', mapId: 'longjump_source_go', tickRate: 128, autoBhop: false,
    distance: 240, valid: true, landed: true, sync: 80, strafes: [], path: [] };
  assert.equal((await f.call('/api/sync', { attempts: [attempt] }, a.cookie)).status, 200);
  f.db.sqlite.query('UPDATE account_usage SET bytes = 134217728 WHERE userId = ?').run(a.data.user.id);
  assert.equal((await f.call('/api/sync', { attempts: [attempt] }, a.cookie)).status, 200);
  assert.equal((await f.call('/api/sync', { attempts: [attempt, { ...attempt, id: 'quota:2', distance: 250 }] }, a.cookie)).status, 413);
  const saved = await (await f.call('/api/sync', undefined, a.cookie)).json() as { attempts: unknown[]; bests: { distance: number }[] };
  assert.equal(saved.attempts.length, 1); assert.equal(saved.bests[0].distance, 240);
  assert.equal((await f.call('/api/sync', { attempts: [attempt] }, b.cookie)).status, 200);
  f.db.sqlite.close();
});
test('The database rejects conflicting duplicate IDs even when a concurrent request passes preflight', async () => {
  const f = fixture(), a = await signup(f, 'RacePlayer');
  const payload = JSON.stringify({ id: 'race:1', distance: 240 });
  await f.db.prepare('INSERT INTO attempt (userId, attemptId, payload) VALUES (?, ?, ?)').bind(a.data.user.id, 'race:1', payload).run();
  await assert.rejects(f.db.batch([
    f.db.prepare('INSERT INTO attempt (userId, attemptId, payload) VALUES (?, ?, ?)').bind(a.data.user.id, 'race:2', payload),
    f.db.prepare('INSERT OR IGNORE INTO attempt (userId, attemptId, payload) VALUES (?, ?, ?)').bind(a.data.user.id, 'race:1', '{}'),
  ]), /LONGJUMP_CONFLICT/);
  assert.equal((f.db.sqlite.query('SELECT COUNT(*) AS n FROM attempt').get() as { n: number }).n, 1);
  assert.equal((f.db.sqlite.query('SELECT attempts FROM account_usage').get() as { attempts: number }).attempts, 1);
  f.db.sqlite.close();
});


test('Account owner headers reject stale tabs and deletion removes only the confirmed account', async () => {
  const f = fixture(), a = await signup(f, 'DeletePlayer'), b = await signup(f, 'KeepPlayer');
  const attempt = { id: 'delete:1', mapId: 'longjump_source_go', tickRate: 128, autoBhop: false,
    distance: 240, valid: true, landed: true, sync: 80, strafes: [], path: [] };
  assert.equal((await f.call('/api/sync', { attempts: [attempt] }, a.cookie, 'fixture', b.data.user.id)).status, 409);
  assert.equal((await f.call('/api/sync', undefined, a.cookie, 'fixture', b.data.user.id)).status, 409);
  assert.equal((await f.call('/api/account/logout', {}, a.cookie, 'fixture', b.data.user.id)).status, 409);
  for (const player of [a, b]) assert.equal((await f.call('/api/sync', { attempts: [attempt] }, player.cookie, 'fixture', player.data.user.id)).status, 200);
  const confirmation = { username: a.data.user.username, password: pass };
  assert.equal((await f.call('/api/account/delete', confirmation, a.cookie)).status, 403);
  assert.equal((await f.call('/api/account/delete', { ...confirmation, password: 'wrong' }, a.cookie, 'fixture', a.data.user.id)).status, 401);
  assert.equal((await f.call('/api/account/delete', confirmation, a.cookie, 'fixture', a.data.user.id)).status, 200);
  assert.equal((await (await f.call('/api/account', undefined, a.cookie)).json() as { user: unknown }).user, null);
  for (const table of ['user', 'account', 'session', 'attempt', 'personal_best', 'account_usage']) {
    const key = table === 'user' ? 'id' : 'userId';
    assert.equal((f.db.sqlite.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} = ?`).get(a.data.user.id) as { n: number }).n, 0);
  }
  assert.equal((await (await f.call('/api/sync', undefined, b.cookie)).json() as { attempts: unknown[] }).attempts.length, 1);
  f.db.sqlite.close();
});
