import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { maps } from '../src/maps';
import { openDatabase } from './db';
import { checkConfig, gate } from './http';
import { createLeaderboard } from './leaderboard';
import { loadMapRules, physicsVersion } from './versions';

const path = process.env.DATABASE_PATH ?? '.data/longjump.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const proxy = { proxySecret: process.env.PROXY_SECRET || undefined, allowDirect: process.env.ALLOW_DIRECT === '1' };
const adminToken = process.env.ADMIN_TOKEN || undefined;
checkConfig({ ...proxy, adminToken });
const db = openDatabase(path);
const leaderboard = createLeaderboard({ db, adminToken, physicsVersion: physicsVersion(),
  maps: Object.fromEntries(maps.map(map => [map.id, loadMapRules(map.id)])) });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  // Replays are well under this; refuse anything larger before reading it.
  maxRequestBodySize: 256 * 1024,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') { db.query('SELECT 1').get(); return new Response('ok', { headers: { 'Cache-Control': 'no-store' } }); }
    const allowed = gate(request, proxy);
    if (!allowed || !url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return leaderboard(request, allowed.address);
  },
});
console.log(`Longjump server listening on ${server.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  // Close cleanly so WAL contents are checkpointed into the volume's database file.
  void server.stop().then(() => { db.close(); process.exit(0); });
});
