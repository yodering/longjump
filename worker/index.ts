import type { D1Database } from '@cloudflare/workers-types';
import { createAuth, validUsername } from './auth';
import { isAPIError } from 'better-auth/api';
import { backupEntry, equivalentAttempt } from '../src/backup';
import { saveBest } from '../src/history';
import type { SavedEntry } from '../src/history-archive';

export type Env = { DB: D1Database; AUTH_SECRET: string; AUTH_ORIGIN: string; ASSETS?: { fetch(request: Request): Promise<Response> } };
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (value: unknown, status = 200, headers = new Headers()) => {
  headers.set('Content-Type', 'application/json'); headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff'); return new Response(JSON.stringify(value), { status, headers });
};
function publicUser(user: Record<string, unknown>) {
  return { id: user.id, username: user.username, displayName: user.displayUsername ?? user.username };
}
async function body(request: Request, limit = 4096) {
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Missing request body.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Request is too large.'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}
function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 15 || value.length > 128) throw new HttpError(400, 'Use a password between 15 and 128 characters.');
  return value;
}
function name(value: unknown) {
  if (typeof value !== 'string' || !validUsername(value)) throw new HttpError(400, 'Use 3–20 letters, numbers or underscores for your username.');
  return value;
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function recoveryKey() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function rateLimit(env: Env, request: Request, route: string, max: number, windowSeconds = 60) {
  // Cloudflare supplies this address in production. Tests use a named fixture address.
  const address = request.headers.get('CF-Connecting-IP') ?? 'local';
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = await digest(`${env.AUTH_SECRET}:${address}:${route}:${bucket}`);
  const row = await env.DB.prepare(`INSERT INTO request_limit (key, count, expiresAt) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`).bind(key, (bucket + 2) * windowSeconds).first<{ count: number }>();
  if (!row || row.count > max) throw new HttpError(429, 'Too many attempts. Try again later.');
  // Limit rows contain salted hashes, not raw client addresses.
  if (crypto.getRandomValues(new Uint8Array(1))[0] < 4)
    await env.DB.prepare('DELETE FROM request_limit WHERE expiresAt < ?').bind(Math.floor(Date.now() / 1000)).run();
}
function requireOrigin(request: Request, env: Env) {
  if (request.headers.get('Origin') !== env.AUTH_ORIGIN || !request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new HttpError(403, 'This request must come from the game.');
}
async function authResponse(response: Response, extra: Record<string, unknown> = {}) {
  if (!response.ok) {
    const status = response.status === 401 ? 401 : response.status === 429 ? 429 : 400;
    throw new HttpError(status, status === 401 ? 'Username or password is incorrect.' : 'Could not complete this request. Check your details.');
  }
  const data = await response.json() as { user?: Record<string, unknown> };
  return json({ user: data.user ? publicUser(data.user) : null, ...extra }, 200, new Headers(response.headers));
}
export async function handle(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS?.fetch(request) ?? new Response('Not found', { status: 404 });
    if (url.origin !== env.AUTH_ORIGIN) throw new HttpError(403, 'Wrong account-service origin.');
    const allowed = ['/api/account', '/api/account/signup', '/api/account/login', '/api/account/logout', '/api/account/recover', '/api/sync'];
    // Never expose Better Auth's email/signup/update/link endpoints to the browser.
    if (!allowed.includes(path)) throw new HttpError(404, 'Not found.');
    if (request.method !== 'GET' && request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    if (request.method === 'POST') requireOrigin(request, env);
    const auth = createAuth(env.DB, env.AUTH_SECRET, env.AUTH_ORIGIN);
    if (path === '/api/account' && request.method === 'GET') {
      const session = await auth.api.getSession({ headers: request.headers });
      return json({ user: session ? publicUser(session.user as unknown as Record<string, unknown>) : null });
    }
    if (path === '/api/account/signup' && request.method === 'POST') {
      await rateLimit(env, request, 'signup', 5, 3600);
      const input = await body(request), username = name(input.username), pass = password(input.password);
      const key = recoveryKey(), signup = createAuth(env.DB, env.AUTH_SECRET, env.AUTH_ORIGIN, await digest(key));
      const response = await signup.api.signUpEmail({ headers: request.headers, asResponse: true, body: {
        username, displayUsername: username, name: username, password: pass, email: `${crypto.randomUUID()}@accounts.invalid`,
      } });
      return await authResponse(response, { recoveryKey: key });
    }
    if (path === '/api/account/login' && request.method === 'POST') {
      await rateLimit(env, request, 'login', 10);
      const input = await body(request), username = name(input.username);
      if (typeof input.password !== 'string' || input.password.length > 128) throw new HttpError(400, 'Invalid password.');
      return await authResponse(await auth.api.signInUsername({ headers: request.headers, asResponse: true,
        body: { username, password: input.password } }));
    }
    if (path === '/api/account/logout' && request.method === 'POST')
      return await authResponse(await auth.api.signOut({ headers: request.headers, asResponse: true }));
    if (path === '/api/account/recover' && request.method === 'POST') {
      await rateLimit(env, request, 'recover', 5);
      const input = await body(request), username = name(input.username).toLowerCase(), pass = password(input.password);
      if (typeof input.recoveryKey !== 'string' || !/^[0-9a-f]{64}$/.test(input.recoveryKey)) throw new HttpError(401, 'Username or recovery key is incorrect.');
      const oldHash = await digest(input.recoveryKey);
      const user = await env.DB.prepare('SELECT id FROM user WHERE username = ? AND recoveryKeyHash = ?').bind(username, oldHash).first<{ id: string }>();
      if (!user) throw new HttpError(401, 'Username or recovery key is incorrect.');
      const key = recoveryKey(), newHash = await digest(key), context = await auth.$context;
      const hash = await context.password.hash(pass);
      // Every statement checks the old key. D1's atomic batch serializes racing
      // recoveries; only one can rotate it, change the credential and revoke sessions.
      const guard = 'EXISTS (SELECT 1 FROM user WHERE id = ? AND recoveryKeyHash = ?)';
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential' AND ${guard}`).bind(hash, Date.now(), user.id, user.id, oldHash),
        env.DB.prepare(`DELETE FROM session WHERE userId = ? AND ${guard}`).bind(user.id, user.id, oldHash),
        env.DB.prepare('UPDATE user SET recoveryKeyHash = ?, updatedAt = ? WHERE id = ? AND recoveryKeyHash = ?').bind(newHash, Date.now(), user.id, oldHash),
      ]);
      if (result[0].meta.changes !== 1 || result[2].meta.changes !== 1) throw new HttpError(401, 'Username or recovery key is incorrect.');
      return json({ recoveryKey: key });
    }
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, 'Sign in to sync progress.');
    if (path === '/api/sync' && request.method === 'GET') {
      await rateLimit(env, request, 'sync-read', 120);
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, 'Invalid sync cursor.');
      const rows = await env.DB.prepare('SELECT sequence, payload FROM attempt WHERE userId = ? AND sequence > ? ORDER BY sequence LIMIT 51').bind(session.user.id, after).all<{ sequence: number; payload: string }>();
      const page = rows.results.slice(0, 50);
      const bests = await env.DB.prepare('SELECT payload FROM personal_best WHERE userId = ?').bind(session.user.id).all<{ payload: string }>();
      return json({ attempts: page.map(row => JSON.parse(row.payload)), cursor: page.at(-1)?.sequence ?? after,
        more: rows.results.length > 50, bests: bests.results.map(row => JSON.parse(row.payload)) });
    }
    if (path === '/api/sync' && request.method === 'POST') {
      await rateLimit(env, request, 'sync', 60);
      const input = await body(request, 256 * 1024);
      const suppliedBests = input.bests ?? [];
      if (!Array.isArray(input.attempts) || input.attempts.length > 50 || !Array.isArray(suppliedBests) || suppliedBests.length > 24)
        throw new HttpError(400, 'Send at most 50 attempts per sync batch.');
      let attempts: SavedEntry[];
      try {
        attempts = input.attempts.map(value => {
          const entry = backupEntry(value), id = (value as { id?: unknown }).id;
          if (typeof id !== 'string' || id.length > 256 || !/^[a-zA-Z0-9:-]+$/.test(id)) throw new Error();
          return { ...entry, id };
        });
      } catch { throw new HttpError(400, 'Invalid attempt data.'); }
      if (new Set(attempts.map(a => a.id)).size !== attempts.length) throw new HttpError(400, 'Repeated attempt IDs.');
      const statements = [];
      for (const entry of attempts) {
        const old = await env.DB.prepare('SELECT payload FROM attempt WHERE userId = ? AND attemptId = ?').bind(session.user.id, entry.id).first<{ payload: string }>();
        if (old && !equivalentAttempt(JSON.parse(old.payload), entry)) throw new HttpError(409, 'An attempt ID conflicts with saved data.');
        statements.push(env.DB.prepare('INSERT OR IGNORE INTO attempt (userId, attemptId, payload) VALUES (?, ?, ?)').bind(session.user.id, entry.id, JSON.stringify(entry)));
      }
      let bests;
      try { bests = [...attempts, ...suppliedBests.map(backupEntry)].reduce(saveBest, []); }
      catch { throw new HttpError(400, 'Invalid best data.'); }
      for (const entry of bests) {
        const category = `${entry.mapId}:${entry.tickRate}:${entry.autoBhop === undefined ? 'unknown' : entry.autoBhop}`;
        statements.push(env.DB.prepare(`INSERT INTO personal_best (userId, category, distance, payload) VALUES (?, ?, ?, ?)
          ON CONFLICT(userId, category) DO UPDATE SET distance = excluded.distance, payload = excluded.payload WHERE excluded.distance > personal_best.distance`)
          .bind(session.user.id, category, entry.distance, JSON.stringify(entry)));
      }
      if (statements.length) await env.DB.batch(statements);
      return json({ acknowledged: attempts.map(a => a.id) });
    }
    throw new HttpError(405, 'Method not allowed.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof Error && error.message.includes('LONGJUMP_QUOTA'))
      return json({ error: 'Cloud storage is full. Keep your local backup. No attempts from this batch were saved.' }, 413);
    if (error instanceof Error && error.message.includes('LONGJUMP_CONFLICT'))
      return json({ error: 'An attempt ID conflicts with saved data.' }, 409);
    if (isAPIError(error)) {
      const status = error.statusCode === 401 ? 401 : error.statusCode === 403 ? 403 : 400;
      return json({ error: status === 401 ? 'Username or password is incorrect.' : 'Could not complete this request. The username may be unavailable.' }, status);
    }
    // Never echo library errors, request bodies, credentials or database contents.
    return json({ error: 'The account service could not complete this request.' }, 500);
  }
}
export default { fetch: handle };
