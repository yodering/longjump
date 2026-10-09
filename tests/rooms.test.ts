import { test, afterEach } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { flat } from './jump-fixture.ts';

type Message = Record<string, any>;
const servers: { stop(): void }[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.stop(); });

function start() {
  const db = openDatabase(':memory:');
  const app = createApp({ db, physicsVersion: 'test', proxy: { allowDirect: true },
    maps: { flat: { boxes: flat, contentVersion: 'test' }, other: { boxes: flat, contentVersion: 'test' } } });
  const server = Bun.serve<{ address: string }>({ port: 0, fetch: app.fetch, websocket: app.websocket });
  servers.push({ stop() { app.stop(); server.stop(true); } });
  const base = `http://127.0.0.1:${server.port}`;
  // Players are inserted directly; HTTP claims are rate limited per address and tested elsewhere.
  const claim = async (name: string) => {
    const key = randomBytes(32).toString('hex');
    db.query('INSERT INTO player (id, name, nameKey, keyHash, createdAt) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), name, name.toLowerCase(), createHash('sha256').update(key).digest('hex'), Date.now());
    return key;
  };
  async function connect(hello: Message) {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/rooms`), inbox: Message[] = [], waiters: (() => void)[] = [];
    ws.onmessage = event => { inbox.push(JSON.parse(String(event.data))); waiters.splice(0).forEach(w => w()); };
    let closed = false; ws.onclose = () => { closed = true; waiters.splice(0).forEach(w => w()); };
    await new Promise(resolve => { ws.onopen = resolve; });
    ws.send(JSON.stringify({ t: 'hello', physics: 'test', map: 'flat', ...hello }));
    const next = async (type: string, timeout = 1000): Promise<Message> => {
      const deadline = Date.now() + timeout;
      for (;;) {
        const index = inbox.findIndex(m => m.t === type);
        if (index >= 0) return inbox.splice(index, 1)[0];
        if (closed || Date.now() > deadline) throw new Error(`no ${type} message (${JSON.stringify(inbox)})`);
        await new Promise<void>(resolve => { waiters.push(resolve); setTimeout(resolve, 50); });
      }
    };
    return { ws, inbox, next, send: (m: Message) => ws.send(JSON.stringify(m)), closed: () => closed };
  }
  return { app, claim, connect };
}
const pose = (x: number, extra: Message = {}) => ({ t: 'pose', p: [x, 0, 0], v: [0, 250, 0], yaw: 1, pitch: 0, g: true, d: 0, m: 't', ...extra });

test('Players create a room, join by code, see each other and leave', async () => {
  const s = start(), a = await s.connect({ key: await s.claim('Alpha'), create: true });
  const welcome = await a.next('welcome');
  assert.match(welcome.room, /^[a-z2-9]{8}$/); assert.equal(welcome.map, 'flat');
  assert.deepEqual(welcome.players.map((p: Message) => p.name), ['Alpha']);
  const b = await s.connect({ key: await s.claim('Bravo'), room: welcome.room.toUpperCase() });
  const joined = await b.next('welcome');
  assert.deepEqual(joined.players.map((p: Message) => p.name).sort(), ['Alpha', 'Bravo']);
  assert.equal((await a.next('join')).name, 'Bravo');
  b.ws.close();
  assert.equal((await a.next('leave')).id, joined.you);
});

test('Poses are relayed to others in bounded snapshots, never back to the sender', async () => {
  const s = start(), a = await s.connect({ key: await s.claim('Alpha'), create: true }), { room } = await a.next('welcome');
  const b = await s.connect({ key: await s.claim('Bravo'), room }); const { you } = await b.next('welcome');
  b.send(pose(1)); b.send(pose(5, { r: true })); b.send(pose(6));
  const snapshot = await a.next('poses');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].id, you);
  // Only the latest pose is relayed, and a reset in between still makes the view snap.
  assert.deepEqual(snapshot.players[0].p, [6, 0, 0]); assert.equal(snapshot.players[0].r, true); assert.equal(snapshot.players[0].m, 't');
  // A burst beyond 40 poses per second is dropped instead of queued.
  await new Promise(resolve => setTimeout(resolve, 1100));
  for (let i = 100; i < 200; i++) b.send(pose(i));
  assert.ok((await a.next('poses')).players[0].p[0] < 140);
  // Malformed or absurd poses are dropped.
  b.send(pose(1e9)); b.send({ ...pose(1), g: 'yes' });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(a.inbox.filter(m => m.t === 'poses').length, 0);
  assert.equal(b.inbox.filter(m => m.t === 'poses').length, 0);
});

test('Jump announcements carry the server-assigned name and are rate limited', async () => {
  const s = start(), a = await s.connect({ key: await s.claim('Alpha'), create: true }), { room } = await a.next('welcome');
  const b = await s.connect({ key: await s.claim('Bravo'), room }); await b.next('welcome');
  const jump = { t: 'jump', name: 'Spoofed', distance: 245.5, sync: 80, pre: 250, max: 270, height: 55, width: 20, strafes: 6, ticks: 98, overlap: 0, deadAir: 1, edge: 3.2, tick: 128, auto: false };
  for (let i = 0; i < 10; i++) b.send(jump);
  b.send({ ...jump, distance: 'far' });
  const heard = await a.next('jump');
  assert.equal(heard.name, 'Bravo'); assert.equal(heard.distance, 245.5); assert.equal(heard.tick, 128);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(a.inbox.filter(m => m.t === 'jump').length, 3, 'four per second in total');
});

test('Rooms refuse missing names, stale game versions, unknown codes and a ninth player', async () => {
  const s = start();
  const nameless = await s.connect({ key: 'f'.repeat(64), create: true });
  assert.match((await nameless.next('error')).message, /name/);
  const stale = await s.connect({ key: await s.claim('Oldtab'), create: true, physics: 'old' });
  assert.match((await stale.next('error')).message, /Reload/);
  const lost = await s.connect({ key: await s.claim('Lost'), room: 'zzzzzzzz' });
  assert.match((await lost.next('error')).message, /ended/);
  const host = await s.connect({ key: await s.claim('Host'), create: true }), { room } = await host.next('welcome');
  for (let i = 0; i < 7; i++) await (await s.connect({ key: await s.claim(`guest${'abcdefg'[i]}x`), room })).next('welcome');
  const ninth = await s.connect({ key: await s.claim('Ninth'), room });
  assert.match((await ninth.next('error')).message, /full/);
});

test('Joining again from another tab replaces the old connection', async () => {
  const s = start(), key = await s.claim('Alpha'), first = await s.connect({ key, create: true }), { room } = await first.next('welcome');
  const watcher = await s.connect({ key: await s.claim('Watcher'), room }); await watcher.next('welcome');
  const second = await s.connect({ key, room });
  assert.deepEqual((await second.next('welcome')).players.map((p: Message) => p.name).sort(), ['Alpha', 'Watcher']);
  assert.match((await first.next('error')).message, /another tab/);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(watcher.inbox.filter(m => m.t === 'leave' || m.t === 'join').length, 0, 'no leave/join churn for a replaced tab');
});

test('Anyone in the room can change its map for everyone', async () => {
  const s = start(), a = await s.connect({ key: await s.claim('Alpha'), create: true }), { room } = await a.next('welcome');
  const b = await s.connect({ key: await s.claim('Bravo'), room }); await b.next('welcome');
  b.send({ t: 'map', map: 'nope' }); b.send({ t: 'map', map: 'other' });
  const changed = await a.next('map');
  assert.deepEqual([changed.map, changed.by], ['other', 'Bravo']);
  assert.equal((await b.next('map')).map, 'other');
  const late = await s.connect({ key: await s.claim('Late'), room });
  assert.equal((await late.next('welcome')).map, 'other');
});

test('The WebSocket endpoint sits behind the same proxy gate as the API', async () => {
  const app = createApp({ db: openDatabase(':memory:'), physicsVersion: 'test', proxy: { proxySecret: 'p'.repeat(32) }, maps: {} });
  const server = Bun.serve<{ address: string }>({ port: 0, fetch: app.fetch, websocket: app.websocket });
  servers.push({ stop() { app.stop(); server.stop(true); } });
  const response = await fetch(`http://127.0.0.1:${server.port}/api/rooms`, { headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' } });
  assert.equal(response.status, 404);
});
