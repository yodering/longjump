import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { maps } from '../src/maps';
import { createApp } from './app';
import { openDatabase } from './db';
import { checkConfig } from './http';
import { loadMapRules, physicsVersion } from './versions';

const path = process.env.DATABASE_PATH ?? '.data/longjump.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const proxy = { proxySecret: process.env.PROXY_SECRET || undefined, allowDirect: process.env.ALLOW_DIRECT === '1' };
const adminToken = process.env.ADMIN_TOKEN || undefined;
checkConfig({ ...proxy, adminToken });
const db = openDatabase(path);
const app = createApp({ db, adminToken, proxy, physicsVersion: physicsVersion(),
  maps: Object.fromEntries(maps.map(map => [map.id, loadMapRules(map.id)])) });

const server = Bun.serve<{ address: string }>({
  port: Number(process.env.PORT ?? 8787),
  // Replays are well under this; refuse anything larger before reading it.
  maxRequestBodySize: 256 * 1024,
  fetch: app.fetch,
  websocket: app.websocket,
});
console.log(`Longjump server listening on ${server.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  // Close cleanly so WAL contents are checkpointed into the volume's database file.
  app.stop();
  void server.stop().then(() => { db.close(); process.exit(0); });
});
