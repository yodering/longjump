// Serves the static game and forwards /api/* to the Railway leaderboard service,
// so the game calls one origin. Keep this Worker free of replay checks and
// database work: the free plan allows 10 ms CPU per request.
type Env = { ASSETS: { fetch(request: Request): Promise<Response> }; API_URL?: string; PROXY_SECRET?: string };

const unavailable = () => new Response('Leaderboard unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });

export async function proxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  // A plain-text 503 lets the game show the leaderboard as unavailable.
  if (!env.API_URL || !env.PROXY_SECRET) return unavailable();
  const headers = new Headers();
  for (const [name, value] of request.headers) if (!name.startsWith('x-longjump-')) headers.set(name, value);
  headers.set('X-Longjump-Proxy', env.PROXY_SECRET);
  const address = request.headers.get('CF-Connecting-IP');
  if (address) headers.set('X-Longjump-Client-IP', address);
  const target = new URL(url.pathname + url.search, env.API_URL);
  // Room WebSockets pass straight through; Cloudflare relays frames without running this Worker per message.
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    try { return await fetch(target, { headers }); } catch { return unavailable(); }
  }
  try {
    const response = await fetch(target, {
      method: request.method, headers, body: request.body, redirect: 'manual',
    });
    return new Response(response.body, response);
  } catch { return unavailable(); }
}
export default { fetch: proxy };
