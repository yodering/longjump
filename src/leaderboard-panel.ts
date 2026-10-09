import { maps } from './maps';
import type { Result } from './physics';
import type { Replay } from './replay';

type Player = { id: string; name: string; key: string };
type Row = { rank: number; id: string; name: string; distance: number; tickRate: number; mapId: string; at: number };
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const STORAGE = 'longjump-player';
const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const mapName = (id: string) => maps.find(map => map.id === id)?.name ?? id;

async function api<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
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

// Names are claimed per browser with a private key; there are no accounts.
// Only manual (auto-hop off) jumps the server can replay are posted.
export class LeaderboardPanel {
  private player: Player | null = null;
  private bests: Record<number, number> = {};
  private editing = false;
  private loading = 0;
  constructor(private root: HTMLElement, private notify: (message: string) => void) {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); if (saved?.key && saved?.name) this.player = saved; } catch { /* Start without a name. */ }
    root.innerHTML = `<form class="history-toolbar" data-board="form" hidden>
        <input data-board="name" aria-label="Leaderboard name" placeholder="Name" autocomplete="nickname" maxlength="16" spellcheck="false"/>
        <button class="settings-button" data-board="save">Save name</button>
        <button type="button" class="settings-button" data-board="cancel" hidden>Cancel</button>
      </form>
      <div class="leaderboard-player" data-board="identity" hidden><span>Posting as <b data-board="current"></b></span><button class="settings-button" data-board="rename">Change name</button></div>
      <p class="setting-note" data-board="status" role="status" aria-live="polite"></p>
      <div class="history-toolbar"><select data-board="tick" aria-label="Leaderboard tick rate"><option value="all">All tick rates</option><option value="128">128 tick</option><option value="64">64 tick</option></select></div>
      <ol class="leaderboard" data-board="rows"></ol>`;
    this.element('form').addEventListener('submit', event => { event.preventDefault(); void this.saveName(); });
    this.element('rename').addEventListener('click', () => { this.editing = true; this.render(); this.element<HTMLInputElement>('name').focus(); });
    this.element('cancel').addEventListener('click', () => { this.editing = false; this.status(''); this.render(); });
    this.element('tick').addEventListener('change', () => void this.refresh());
    this.render();
    if (this.player) void this.check();
  }
  private element<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-board="${name}"]`)!; }
  private status(message: string) { this.element('status').textContent = message; }
  private render() {
    const naming = !this.player || this.editing;
    this.element('form').hidden = !naming; this.element('identity').hidden = naming;
    this.element('cancel').hidden = !this.player;
    this.element<HTMLInputElement>('name').placeholder = this.player ? this.player.name : 'Choose a name to post manual jumps';
    if (this.player) this.element('current').textContent = this.player.name;
  }
  private store() { try { localStorage.setItem(STORAGE, JSON.stringify(this.player)); } catch { /* The name lasts for this session. */ } }
  private forget(message: string) {
    this.player = null; this.bests = {}; this.editing = false;
    try { localStorage.removeItem(STORAGE); } catch { /* Nothing stored. */ }
    this.render(); this.status(message);
  }
  private async check() {
    try {
      const me = await api<{ player: { name: string; banned: boolean }; bests: Record<number, number> }>('players/me', { key: this.player!.key });
      this.player = { ...this.player!, name: me.player.name }; this.bests = me.bests; this.store(); this.render();
      if (me.player.banned) this.status('This name can’t post to the leaderboard.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.forget('Your saved name was removed. Choose a name to keep posting.');
    }
  }
  private async saveName() {
    const input = this.element<HTMLInputElement>('name'), button = this.element<HTMLButtonElement>('save'), name = input.value.trim();
    if (!name) return;
    button.disabled = true;
    try {
      if (this.player) {
        const renamed = await api<{ player: { name: string } }>('players/me', { method: 'POST', body: JSON.stringify({ name }), key: this.player.key });
        this.player = { ...this.player, name: renamed.player.name };
      } else {
        const claimed = await api<{ player: { id: string; name: string }; key: string }>('players', { method: 'POST', body: JSON.stringify({ name }) });
        this.player = { ...claimed.player, key: claimed.key }; this.bests = {};
      }
      this.store(); this.editing = false; input.value = ''; this.status(''); this.render(); void this.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.forget('Your saved name was removed. Choose a name to keep posting.');
      else this.status(error instanceof Error ? error.message : 'Could not save that name.');
    } finally { button.disabled = false; }
  }
  async refresh() {
    const request = ++this.loading, tick = this.element<HTMLSelectElement>('tick').value, list = this.element('rows');
    if (!list.childElementCount) list.innerHTML = '<li class="setting-note">Loading…</li>';
    try {
      const { entries } = await api<{ entries: Row[] }>(`leaderboard${tick === 'all' ? '' : `?tick=${tick}`}`);
      if (request !== this.loading) return;
      list.innerHTML = entries.length ? entries.map(row => `<li class="leaderboard-row${row.name === this.player?.name ? ' own' : ''}">
        <span class="leaderboard-rank">${row.rank}</span><span class="leaderboard-name">${escape(row.name)}<small>${escape(mapName(row.mapId))}</small></span>
        <span class="leaderboard-score"><b>${row.distance.toFixed(2)}</b><small>${row.tickRate}T</small></span></li>`).join('')
        : '<li class="setting-note">No jumps posted yet.</li>';
    } catch (error) {
      if (request === this.loading) list.innerHTML = `<li class="setting-note">${escape(error instanceof Error ? error.message : 'Leaderboard unavailable.')}</li>`;
    }
  }
  /** Posts a valid manual jump that beats this name's posted best. Never blocks play. */
  submit(result: Result, replay: Omit<Replay, 'version'>) {
    const player = this.player;
    if (!player || !result.valid || result.distance <= (this.bests[replay.tickRate] ?? 0)) return;
    // Assume it counts until the server answers so a quick second jump is compared correctly.
    const previous = this.bests[replay.tickRate]; this.bests[replay.tickRate] = result.distance;
    void api<{ distance: number; improved: boolean; rank: number }>('jumps', { method: 'POST', key: player.key, body: JSON.stringify({ replay: { version: 1, ...replay } }) })
      .then(posted => { if (posted.improved) this.notify(`Leaderboard #${posted.rank} · ${posted.distance.toFixed(2)}`); })
      .catch(error => {
        if (this.bests[replay.tickRate] === result.distance) this.bests[replay.tickRate] = previous ?? 0;
        if (error instanceof ApiError && error.status === 401) this.forget('Your saved name was removed. Choose a name to keep posting.');
        else if (error instanceof ApiError && error.status !== 0 && error.status !== 503 && error.status !== 429) this.notify(error.message);
      });
  }
}
