import type { Database } from 'bun:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseReplay, verifyReplay } from '../src/replay';
import { nameKey, nameProblem } from './names';
import type { MapRules } from './versions';

export type LeaderboardConfig = { db: Database; maps: Record<string, MapRules>; physicsVersion: string; adminToken?: string };
type Player = { id: string; name: string; banned: number };
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const BOARD_SIZE = 100;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

// Single-process counters are enough for one Railway replica; a restart only resets them.
class Limiter {
  private hits = new Map<string, { count: number; reset: number }>();
  allow(key: string, max: number, windowMs: number) {
    const now = Date.now(), hit = this.hits.get(key);
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    if (!hit || hit.reset < now) { this.hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    return ++hit.count <= max;
  }
}

async function body(request: Request, limit: number) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'Request is too large.');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}
const bearer = (request: Request) => request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1] ?? null;

export function createLeaderboard(config: LeaderboardConfig) {
  const { db } = config, limits = new Limiter();
  const limit = (key: string, max: number, windowMs = 60_000) => { if (!limits.allow(key, max, windowMs)) throw new HttpError(429, 'Too many requests. Try again later.'); };
  const playerByKey = db.query<Player, [string]>('SELECT id, name, banned FROM player WHERE keyHash = ?');
  const board = (tick: number | null) => db.query<Record<string, unknown>, [number, number, number]>(`SELECT e.id, p.name, e.distance, e.tickRate, e.mapId, e.preSpeed, e.sync, e.strafes, e.ducked, e.at
    FROM entry e JOIN player p ON p.id = e.playerId WHERE p.banned = 0 AND (? = 0 OR e.tickRate = ?) ORDER BY e.distance DESC, e.at ASC LIMIT ?`).all(tick ?? 0, tick ?? 0, BOARD_SIZE);

  function player(request: Request) {
    const key = bearer(request); const found = key ? playerByKey.get(sha(key)) : null;
    if (!found) throw new HttpError(401, 'This browser’s name is no longer recognised. Choose a name again.');
    return found;
  }
  function claimName(name: unknown, exceptId?: string) {
    const problem = nameProblem(name); if (problem) throw new HttpError(400, problem);
    const owner = db.query<{ id: string }, [string]>('SELECT id FROM player WHERE nameKey = ?').get(nameKey(name as string));
    if (owner && owner.id !== exceptId) throw new HttpError(409, 'That name is taken.');
    return name as string;
  }
  function admin(request: Request) {
    const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const expected = config.adminToken;
    if (!expected || !timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest()))
      throw new HttpError(404, 'Not found.');
  }

  async function route(request: Request, address: string): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (path === '/api/leaderboard' && method === 'GET') {
      limit(`read:${address}`, 120);
      const tick = url.searchParams.get('tick'), filter = tick === '64' ? 64 : tick === '128' ? 128 : null;
      return json({ entries: board(filter).map((row, index) => ({ rank: index + 1, ...row, ducked: !!row.ducked })) });
    }
    if (path === '/api/players' && method === 'POST') {
      limit(`claim:${address}`, 5, 3_600_000);
      const name = claimName((await body(request, 1024)).name);
      const key = randomBytes(32).toString('hex'), id = crypto.randomUUID();
      try {
        db.query('INSERT INTO player (id, name, nameKey, keyHash, createdAt) VALUES (?, ?, ?, ?, ?)').run(id, name, nameKey(name), sha(key), Date.now());
      } catch { throw new HttpError(409, 'That name is taken.'); }
      return json({ player: { id, name }, key }, 201);
    }
    if (path === '/api/players/me' && method === 'GET') {
      limit(`me:${address}`, 60);
      const me = player(request);
      const bests = Object.fromEntries(db.query<{ tickRate: number; distance: number }, [string]>('SELECT tickRate, distance FROM entry WHERE playerId = ?')
        .all(me.id).map(row => [row.tickRate, row.distance]));
      return json({ player: { id: me.id, name: me.name, banned: !!me.banned }, bests });
    }
    if (path === '/api/players/me' && method === 'POST') {
      limit(`rename:${address}`, 10, 3_600_000);
      const me = player(request), name = claimName((await body(request, 1024)).name, me.id);
      try { db.query('UPDATE player SET name = ?, nameKey = ? WHERE id = ?').run(name, nameKey(name), me.id); }
      catch { throw new HttpError(409, 'That name is taken.'); }
      return json({ player: { id: me.id, name } });
    }
    if (path === '/api/jumps' && method === 'POST') {
      limit(`jump:${address}`, 30);
      const me = player(request);
      limit(`jump-player:${me.id}`, 20);
      if (me.banned) throw new HttpError(403, 'This name can’t post to the leaderboard.');
      const input = await body(request, 128 * 1024);
      let replay;
      try { replay = parseReplay(input.replay); } catch (error) { throw new HttpError(400, (error as Error).message); }
      if (replay.physicsVersion !== config.physicsVersion) throw new HttpError(409, 'The game was updated. Reload to post jumps.');
      const map = config.maps[replay.mapId];
      if (!map || map.contentVersion !== replay.mapContentVersion) throw new HttpError(409, 'This map version can’t post jumps. Reload the game.');
      let result;
      try { result = verifyReplay(replay, map.boxes); } catch (error) { throw new HttpError(422, (error as Error).message); }
      if (!result.valid) throw new HttpError(422, `This jump doesn’t count: ${result.reason.toLowerCase()}.`);
      const id = crypto.randomUUID(), now = Date.now();
      const saved = db.query(`INSERT INTO entry (id, playerId, tickRate, distance, mapId, preSpeed, sync, strafes, ducked, physicsVersion, replay, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(playerId, tickRate) DO UPDATE SET id = excluded.id, distance = excluded.distance, mapId = excluded.mapId, preSpeed = excluded.preSpeed,
          sync = excluded.sync, strafes = excluded.strafes, ducked = excluded.ducked, physicsVersion = excluded.physicsVersion, replay = excluded.replay, at = excluded.at
        WHERE excluded.distance > entry.distance`).run(id, me.id, replay.tickRate, result.distance, replay.mapId, result.preSpeed, result.sync,
        result.strafes.length, result.ducked ? 1 : 0, replay.physicsVersion, JSON.stringify(replay), now);
      const rank = db.query<{ n: number }, [number]>('SELECT COUNT(*) AS n FROM entry e JOIN player p ON p.id = e.playerId WHERE p.banned = 0 AND e.distance > ?').get(result.distance)!.n + 1;
      return json({ distance: result.distance, tickRate: replay.tickRate, improved: saved.changes > 0, rank });
    }
    if (path.startsWith('/api/admin/')) {
      admin(request);
      const entry = path.match(/^\/api\/admin\/entries\/([0-9a-f-]{36})$/), target = path.match(/^\/api\/admin\/players\/([0-9a-f-]{36})$/);
      if (path === '/api/admin/entries' && method === 'GET') {
        const search = `%${(url.searchParams.get('name') ?? '').toLowerCase()}%`;
        return json({ entries: db.query(`SELECT e.id, e.playerId, p.name, p.banned, e.distance, e.tickRate, e.mapId, e.at FROM entry e JOIN player p ON p.id = e.playerId
          WHERE lower(p.name) LIKE ? ORDER BY e.distance DESC LIMIT 200`).all(search) });
      }
      if (entry && method === 'DELETE') {
        const removed = db.query('DELETE FROM entry WHERE id = ?').run(entry[1]);
        return json({ deleted: removed.changes });
      }
      if (target && method === 'POST') {
        const input = await body(request, 1024);
        if (input.name !== undefined) {
          const name = claimName(input.name, target[1]);
          db.query('UPDATE player SET name = ?, nameKey = ? WHERE id = ?').run(name, nameKey(name), target[1]);
        }
        if (typeof input.banned === 'boolean') db.query('UPDATE player SET banned = ? WHERE id = ?').run(input.banned ? 1 : 0, target[1]);
        return json({ player: db.query('SELECT id, name, banned FROM player WHERE id = ?').get(target[1]) });
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  return async (request: Request, address: string) => {
    try { return await route(request, address); }
    catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error('Leaderboard request failed', error instanceof Error ? error.message : error);
      return json({ error: 'The leaderboard could not complete this request.' }, 500);
    }
  };
}
