// The browser's public name, shared by the leaderboard and rooms. There are no
// accounts: claiming a name returns a private key kept in localStorage.
export type Player = { id: string; name: string; key: string };
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const STORAGE = 'longjump-player';
export async function api<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body) headers['Content-Type'] = 'application/json';
  if (init.key) headers.Authorization = `Bearer ${init.key}`;
  let response: Response;
  try { response = await fetch(`/api/${path}`, { ...init, headers }); }
  catch { throw new ApiError('Leaderboard unavailable. Check your connection.', 0); }
  // The Cloudflare proxy answers with plain text when the service is missing or down.
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new ApiError('Leaderboard unavailable.', 503);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Leaderboard request failed.', response.status);
  return data;
}

export class Identity {
  player: Player | null = null;
  private listeners = new Set<(reason: 'claimed' | 'renamed' | 'forgotten' | 'checked') => void>();
  constructor() {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); if (saved?.key && saved?.name) this.player = saved; } catch { /* Start without a name. */ }
  }
  onChange(listener: (reason: 'claimed' | 'renamed' | 'forgotten' | 'checked') => void) { this.listeners.add(listener); }
  private emit(reason: 'claimed' | 'renamed' | 'forgotten' | 'checked') { for (const listener of this.listeners) listener(reason); }
  private store() { try { localStorage.setItem(STORAGE, JSON.stringify(this.player)); } catch { /* The name lasts for this session. */ } }
  /** Claims a new name, or renames the current one. */
  async save(name: string) {
    if (this.player) {
      const renamed = await api<{ player: { name: string } }>('players/me', { method: 'POST', body: JSON.stringify({ name }), key: this.player.key });
      this.player = { ...this.player, name: renamed.player.name }; this.store(); this.emit('renamed');
    } else {
      const claimed = await api<{ player: { id: string; name: string }; key: string }>('players', { method: 'POST', body: JSON.stringify({ name }) });
      this.player = { ...claimed.player, key: claimed.key }; this.store(); this.emit('claimed');
    }
  }
  /** Refreshes the name and posted bests; forgets a key the server no longer knows. */
  async check() {
    if (!this.player) return null;
    try {
      const me = await api<{ player: { name: string; banned: boolean }; bests: Record<number, number> }>('players/me', { key: this.player.key });
      this.player = { ...this.player, name: me.player.name }; this.store(); this.emit('checked');
      return me;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.forget();
      return null;
    }
  }
  forget() {
    this.player = null;
    try { localStorage.removeItem(STORAGE); } catch { /* Nothing stored. */ }
    this.emit('forgotten');
  }
}
