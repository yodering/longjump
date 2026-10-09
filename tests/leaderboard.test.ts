import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.ts';
import { createLeaderboard } from '../server/leaderboard.ts';
import { checkConfig, gate } from '../server/http.ts';
import { nameKey, nameProblem } from '../server/names.ts';
import { loadMapRules, physicsVersion } from '../server/versions.ts';
import { proxy } from '../worker/proxy.ts';
import { flat, recordJump } from './jump-fixture.ts';

const ADMIN = 'test-only-admin-token-0123456789abcdef';
function fixture(path = ':memory:') {
  const db = openDatabase(path);
  const handle = createLeaderboard({ db, adminToken: ADMIN, physicsVersion: 'test', maps: { flat: { boxes: flat, contentVersion: 'test' } } });
  const call = async (method: string, path: string, body?: unknown, key?: string, address = 'fixture') => {
    const response = await handle(new Request(`http://local${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: `Bearer ${key}` } : {}) } }), address);
    return { status: response.status, data: await response.json() as Record<string, any> };
  };
  const claim = async (name: string, address = 'fixture') => {
    const r = await call('POST', '/api/players', { name }, undefined, address);
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data as { player: { id: string; name: string }; key: string };
  };
  return { db, call, claim };
}

test('Names are validated, filtered and protected against look-alikes', async () => {
  assert.equal(nameProblem('Jumper_1'), null);
  for (const bad of ['ab', 'a'.repeat(17), 'has space', 'émile', '___', 'Admin', 'adm1n', 'shitjumper', 'Sh1tJumper']) assert.ok(nameProblem(bad), bad);
  assert.equal(nameKey('Yoder_Ing'), nameKey('yoderlng'));
  assert.equal(nameKey('B0LT'), nameKey('bolt'));
  const f = fixture(); const first = await f.claim('Yodering');
  assert.equal(first.key.length, 64);
  // Failed claims count toward the rate limit, so spread these across addresses.
  for (const copy of ['yodering', 'YODERING', 'Y0dering', 'Yoder_ing', 'Yoderlng']) assert.equal((await f.call('POST', '/api/players', { name: copy }, undefined, copy)).status, 409, copy);
  // Only the key's hash is stored.
  const row = f.db.query<{ keyHash: string }, []>('SELECT keyHash FROM player').get()!;
  assert.notEqual(row.keyHash, first.key);
  assert.deepEqual((await f.call('GET', '/api/players/me', undefined, first.key)).data.player, { ...first.player, banned: false });
  assert.equal((await f.call('GET', '/api/players/me', undefined, 'f'.repeat(64))).status, 401);
  const renamed = await f.call('POST', '/api/players/me', { name: 'NewName' }, first.key);
  assert.equal(renamed.status, 200); assert.equal(renamed.data.player.name, 'NewName');
  // The old name is free again; renaming to your own look-alike is allowed.
  await f.claim('Yodering', 'another');
  assert.equal((await f.call('POST', '/api/players/me', { name: 'newname' }, first.key)).status, 200);
});

test('Only verified replays post, and each player keeps one best per tick rate', async () => {
  const f = fixture(), a = await f.claim('Alpha'), b = await f.claim('Bravo');
  const short = recordJump(128, 0.012), other = recordJump(128, 0.02), slow = recordJump(64);
  const longer = short.result.distance > other.result.distance ? short : other, shorter = longer === short ? other : short;
  assert.equal((await f.call('POST', '/api/jumps', { replay: shorter.replay })).status, 401);
  const first = await f.call('POST', '/api/jumps', { replay: shorter.replay }, a.key);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.distance, shorter.result.distance); assert.equal(first.data.improved, true); assert.equal(first.data.rank, 1);
  assert.equal((await f.call('POST', '/api/jumps', { replay: longer.replay }, a.key)).data.improved, true);
  assert.equal((await f.call('POST', '/api/jumps', { replay: shorter.replay }, a.key)).data.improved, false);
  await f.call('POST', '/api/jumps', { replay: slow.replay }, a.key);
  assert.deepEqual((await f.call('GET', '/api/players/me', undefined, a.key)).data.bests, { 64: slow.result.distance, 128: longer.result.distance });
  await f.call('POST', '/api/jumps', { replay: shorter.replay }, b.key);
  const board = (await f.call('GET', '/api/leaderboard')).data.entries as Record<string, any>[];
  assert.deepEqual(board.map(e => [e.name, e.tickRate, e.distance]), [['Alpha', 128, longer.result.distance], ['Bravo', 128, shorter.result.distance], ['Alpha', 64, slow.result.distance]]
    .sort((x, y) => (y[2] as number) - (x[2] as number)));
  assert.deepEqual(board.map(e => e.rank), [1, 2, 3]);
  assert.ok(!('replay' in board[0]) && !('playerId' in board[0]));
  // Stats come from the server's own replay, not from anything the browser claims.
  assert.deepEqual(board.find(e => e.tickRate === 64)!.stats, { preSpeed: slow.result.preSpeed, maxSpeed: slow.result.maxSpeed, sync: slow.result.sync,
    strafes: slow.result.strafes.length, height: slow.result.height, airtime: slow.result.duration, edge: slow.result.edge, width: slow.result.width,
    overlap: slow.result.overlap, deadAir: slow.result.deadAir, ducked: slow.result.ducked });
  const only64 = (await f.call('GET', '/api/leaderboard?tick=64')).data.entries as Record<string, any>[];
  assert.deepEqual(only64.map(e => e.tickRate), [64]);
});

test('Edited, mismatched or invalid jumps are refused', async () => {
  const f = fixture(), a = await f.claim('Alpha'), { replay } = recordJump(128);
  const copy = () => JSON.parse(JSON.stringify(replay));
  const claimed = { ...copy(), distance: 999 };
  const honest = await f.call('POST', '/api/jumps', { replay: claimed }, a.key);
  assert.equal(honest.data.distance, recordJump(128).result.distance, 'claimed numbers are ignored');
  const floating = copy(); floating.state.position.z = 40;
  assert.equal((await f.call('POST', '/api/jumps', { replay: floating }, a.key)).status, 422);
  const cut = copy(); cut.inputs = cut.inputs.slice(0, 20);
  assert.equal((await f.call('POST', '/api/jumps', { replay: cut }, a.key)).status, 422);
  assert.equal((await f.call('POST', '/api/jumps', { replay: { ...copy(), physicsVersion: 'old' } }, a.key)).status, 409);
  assert.equal((await f.call('POST', '/api/jumps', { replay: { ...copy(), mapContentVersion: 'old' } }, a.key)).status, 409);
  assert.equal((await f.call('POST', '/api/jumps', { replay: { ...copy(), mapId: 'nope' } }, a.key)).status, 409);
  assert.equal((await f.call('POST', '/api/jumps', { replay: { ...copy(), tickRate: 100 } }, a.key)).status, 400);
  // A standing jump replays as one: short of the 200-unit minimum, so it doesn't count.
  const standing = copy(); standing.state.velocity = { x: 0, y: 0, z: 0 };
  standing.inputs = standing.inputs.map((i: Record<string, unknown>) => ({ ...i, forward: 0, side: 0 }));
  const refused = await f.call('POST', '/api/jumps', { replay: standing }, a.key);
  assert.equal(refused.status, 422); assert.match(refused.data.error, /short jump/);
});

test('Moderators can list, delete, rename and ban; others cannot reach admin routes', async () => {
  const f = fixture(), a = await f.claim('Spammer'), b = await f.claim('Fine');
  await f.call('POST', '/api/jumps', { replay: recordJump(128).replay }, a.key);
  await f.call('POST', '/api/jumps', { replay: recordJump(64).replay }, b.key);
  const handle = createLeaderboard({ db: f.db, adminToken: ADMIN, physicsVersion: 'test', maps: {} });
  const admin = async (method: string, path: string, body?: unknown, token = ADMIN) => {
    const r = await handle(new Request(`http://local${path}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } }), 'mod');
    return { status: r.status, data: await r.json() as Record<string, any> };
  };
  assert.equal((await admin('GET', '/api/admin/entries', undefined, 'wrong-token-wrong-token-wrong-token')).status, 404);
  assert.equal((await f.call('GET', '/api/admin/entries')).status, 404);
  const listed = (await admin('GET', '/api/admin/entries?name=spam')).data.entries;
  assert.equal(listed.length, 1);
  assert.equal((await admin('POST', `/api/admin/players/${a.player.id}`, { name: 'Renamed' })).data.player.name, 'Renamed');
  assert.equal((await admin('POST', `/api/admin/players/${a.player.id}`, { banned: true })).data.player.banned, 1);
  assert.deepEqual(((await f.call('GET', '/api/leaderboard')).data.entries as any[]).map(e => e.name), ['Fine']);
  assert.equal((await f.call('POST', '/api/jumps', { replay: recordJump(128).replay }, a.key)).status, 403);
  const fine = (await admin('GET', '/api/admin/entries?name=fine')).data.entries[0];
  assert.equal((await admin('DELETE', `/api/admin/entries/${fine.id}`)).data.deleted, 1);
  assert.deepEqual((await f.call('GET', '/api/leaderboard')).data.entries, []);
});

test('Name claims are rate limited per address', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await f.claim(`player${'abcde'[i]}x`, 'busy');
  assert.equal((await f.call('POST', '/api/players', { name: 'oneMore' }, undefined, 'busy')).status, 429);
  await f.claim('otherplace', 'elsewhere');
});

test('Startup and proxy gate refuse direct production access', () => {
  assert.throws(() => checkConfig({}), /PROXY_SECRET/);
  assert.throws(() => checkConfig({ proxySecret: 'short' }), /32/);
  assert.throws(() => checkConfig({ allowDirect: true, adminToken: 'short' }), /ADMIN_TOKEN/);
  checkConfig({ allowDirect: true }); checkConfig({ proxySecret: 'p'.repeat(32), adminToken: ADMIN });
  const config = { proxySecret: 'p'.repeat(32) };
  assert.equal(gate(new Request('http://x/api/leaderboard'), config), null);
  assert.equal(gate(new Request('http://x/api/leaderboard', { headers: { 'X-Longjump-Proxy': 'wrong' } }), config), null);
  assert.deepEqual(gate(new Request('http://x/api/leaderboard', { headers: { 'X-Longjump-Proxy': config.proxySecret, 'X-Longjump-Client-IP': '203.0.113.9' } }), config), { address: '203.0.113.9' });
  assert.deepEqual(gate(new Request('http://x/api/leaderboard', { headers: { 'X-Longjump-Client-IP': '1.1.1.1' } }), {}), { address: 'local' });
});

test('Entries saved before stats existed get them from their replay at startup', async () => {
  const f = fixture(), a = await f.claim('Older'), jump = recordJump(128);
  await f.call('POST', '/api/jumps', { replay: jump.replay }, a.key);
  f.db.query('UPDATE entry SET stats = NULL').run();
  createLeaderboard({ db: f.db, physicsVersion: 'test', maps: { flat: { boxes: flat, contentVersion: 'test' } } });
  const [row] = (await f.call('GET', '/api/leaderboard')).data.entries as Record<string, any>[];
  assert.equal(row.stats.maxSpeed, jump.result.maxSpeed); assert.equal(row.stats.airtime, jump.result.duration);
  // Replays from other rules keep their verified distance and simply show no stats.
  f.db.query("UPDATE entry SET stats = NULL, physicsVersion = 'old'").run();
  createLeaderboard({ db: f.db, physicsVersion: 'test', maps: { flat: { boxes: flat, contentVersion: 'test' } } });
  assert.equal(((await f.call('GET', '/api/leaderboard')).data.entries as Record<string, any>[])[0].stats, null);
});

test('Scores persist across restarts and migrations apply once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'longjump-board-'));
  try {
    const path = join(dir, 'board.sqlite');
    let f = fixture(path); const a = await f.claim('Durable');
    await f.call('POST', '/api/jumps', { replay: recordJump(128).replay }, a.key); f.db.close();
    f = fixture(path);
    assert.equal(((await f.call('GET', '/api/leaderboard')).data.entries as any[])[0].name, 'Durable');
    assert.deepEqual(f.db.query<{ name: string }, []>('SELECT name FROM schema_migration').all().map(r => r.name), ['0001_leaderboard.sql', '0002_entry_stats.sql']);
    f.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Server rule fingerprints match what the game computes', async () => {
  const { fingerprint } = await import('../src/backup.ts');
  for (const id of ['longjump_source_go', 'kz_longjumps_go']) {
    const data = await Bun.file(`public/maps/${id}/map.json`).json();
    assert.equal(loadMapRules(id).contentVersion, await fingerprint(JSON.stringify({ boxes: data.boxes, entry: data.entry, lanes: data.lanes })));
  }
  assert.match(physicsVersion(), /^[0-9a-f]{64}$/);
});

test('Cloudflare proxy forwards only /api with its own trusted headers', async () => {
  const seen: Request[] = [], original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { seen.push(new Request(input, init)); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  try {
    const assets = { fetch: async () => new Response('game') }, env = { ASSETS: assets, API_URL: 'https://api.up.railway.app', PROXY_SECRET: 'p'.repeat(32) };
    assert.equal(await (await proxy(new Request('https://longjump.ing/maps/x.json'), env)).text(), 'game');
    await proxy(new Request('https://longjump.ing/api/leaderboard?tick=64', { headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-Longjump-Proxy': 'forged', 'X-Longjump-Client-IP': '1.1.1.1', Authorization: 'Bearer k' } }), env);
    const sent = seen[0];
    assert.equal(sent.url, 'https://api.up.railway.app/api/leaderboard?tick=64');
    assert.equal(sent.headers.get('X-Longjump-Proxy'), env.PROXY_SECRET);
    assert.equal(sent.headers.get('X-Longjump-Client-IP'), '203.0.113.7');
    assert.equal(sent.headers.get('Authorization'), 'Bearer k');
    assert.equal((await proxy(new Request('https://longjump.ing/api/leaderboard'), { ASSETS: assets })).status, 503);
    globalThis.fetch = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const down = await proxy(new Request('https://longjump.ing/api/leaderboard'), env);
    assert.equal(down.status, 503); assert.ok(!down.headers.get('Content-Type')?.includes('json'));
  } finally { globalThis.fetch = original; }
});
