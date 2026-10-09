import { maps } from './maps';
import type { Result } from './physics';
import type { Replay } from './replay';

type Player = { id: string; name: string; key: string };
type Stats = { preSpeed: number; maxSpeed: number; sync: number; strafes: number; height: number; airtime: number;
  edge: number | null; width: number; overlap: number; deadAir: number; ducked: boolean };
type Row = { rank: number; id: string; name: string; distance: number; tickRate: number; mapId: string; at: number; stats: Stats | null };
type Pending = { result: Result; replay: Omit<Replay, 'version'> };
class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const STORAGE = 'longjump-player';
const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const mapName = (id: string) => maps.find(map => map.id === id)?.name ?? id;
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

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
const nameForm = (id: string, action: string) => `<form class="history-toolbar" data-form="${id}">
  <input data-field="name" aria-label="Leaderboard name" placeholder="Name" autocomplete="nickname" maxlength="16" spellcheck="false"/>
  <button class="settings-button" data-field="save">${action}</button>
  <button type="button" class="settings-button" data-field="cancel">${id === 'prompt' ? 'Not now' : 'Cancel'}</button>
</form>`;

// Names are claimed per browser with a private key; there are no accounts.
// Only manual (auto-hop off) jumps the server can replay are posted. Without a
// name, the best jump per tick rate waits here and the menu offers to post it.
export class LeaderboardPanel {
  private player: Player | null = null;
  private bests: Record<number, number> = {};
  private pending = new Map<number, Pending>();
  private dismissed = false;
  private hinted = false;
  private editing = false;
  private loading = 0;
  constructor(private root: HTMLElement, private prompt: HTMLElement, private notify: (message: string) => void) {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null'); if (saved?.key && saved?.name) this.player = saved; } catch { /* Start without a name. */ }
    prompt.innerHTML = `<p data-prompt="summary"></p>${nameForm('prompt', 'Post')}<p class="setting-note" data-prompt="status" role="status" aria-live="polite"></p>`;
    root.innerHTML = `${nameForm('tab', 'Save name')}
      <div class="leaderboard-player" data-board="identity" hidden><span>Posting as <b data-board="current"></b></span><button class="settings-button" data-board="rename">Change name</button></div>
      <p class="setting-note" data-board="status" role="status" aria-live="polite"></p>
      <div class="history-toolbar"><select data-board="tick" aria-label="Leaderboard tick rate"><option value="all">All tick rates</option><option value="128">128 tick</option><option value="64">64 tick</option></select></div>
      <ol class="leaderboard" data-board="rows"></ol>`;
    for (const [form, status] of [[this.form('tab'), this.element('status')], [this.form('prompt'), prompt.querySelector<HTMLElement>('[data-prompt="status"]')!]] as const) {
      form.addEventListener('submit', event => { event.preventDefault(); void this.saveName(form, status); });
    }
    this.field(this.form('tab'), 'cancel').addEventListener('click', () => { this.editing = false; this.element('status').textContent = ''; this.render(); });
    this.field(this.form('prompt'), 'cancel').addEventListener('click', () => { this.dismissed = true; this.render(); });
    this.element('rename').addEventListener('click', () => { this.editing = true; this.render(); this.field<HTMLInputElement>(this.form('tab'), 'name').focus(); });
    this.element('tick').addEventListener('change', () => void this.refresh());
    this.render();
    if (this.player) void this.check();
  }
  private element<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-board="${name}"]`)!; }
  private form(id: 'tab' | 'prompt') { return (id === 'tab' ? this.root : this.prompt).querySelector<HTMLFormElement>(`[data-form="${id}"]`)!; }
  private field<T extends HTMLElement = HTMLElement>(form: HTMLElement, name: string) { return form.querySelector<T>(`[data-field="${name}"]`)!; }
  private render() {
    const naming = !this.player || this.editing, tab = this.form('tab');
    tab.hidden = !naming; this.element('identity').hidden = naming;
    this.field(tab, 'cancel').hidden = !this.player;
    this.field<HTMLInputElement>(tab, 'name').placeholder = this.player ? this.player.name : 'Choose a name to post manual jumps';
    if (this.player) this.element('current').textContent = this.player.name;
    const waiting = [...this.pending.values()].sort((a, b) => b.result.distance - a.result.distance);
    this.prompt.hidden = !!this.player || this.dismissed || !waiting.length;
    this.prompt.querySelector('[data-prompt="summary"]')!.textContent = `Add a name to post ${waiting.map(p => `${p.result.distance.toFixed(2)} · ${p.replay.tickRate} tick`).join(' and ')} on the leaderboard?`;
  }
  private store() { try { localStorage.setItem(STORAGE, JSON.stringify(this.player)); } catch { /* The name lasts for this session. */ } }
  private forget(message: string) {
    this.player = null; this.bests = {}; this.editing = false;
    try { localStorage.removeItem(STORAGE); } catch { /* Nothing stored. */ }
    this.render(); this.element('status').textContent = message;
  }
  private async check() {
    try {
      const me = await api<{ player: { name: string; banned: boolean }; bests: Record<number, number> }>('players/me', { key: this.player!.key });
      this.player = { ...this.player!, name: me.player.name }; this.bests = me.bests; this.store(); this.render();
      if (me.player.banned) this.element('status').textContent = 'This name can’t post to the leaderboard.';
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.forget('Your saved name was removed. Choose a name to keep posting.');
    }
  }
  private async saveName(form: HTMLFormElement, status: HTMLElement) {
    const input = this.field<HTMLInputElement>(form, 'name'), button = this.field<HTMLButtonElement>(form, 'save'), name = input.value.trim();
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
      this.store(); this.editing = false; input.value = ''; status.textContent = '';
      const waiting = [...this.pending.values()]; this.pending.clear();
      this.render();
      for (const jump of waiting) await this.post(jump);
      void this.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.forget('Your saved name was removed. Choose a name to keep posting.');
      else status.textContent = error instanceof Error ? error.message : 'Could not save that name.';
    } finally { button.disabled = false; }
  }
  async refresh() {
    const request = ++this.loading, tick = this.element<HTMLSelectElement>('tick').value, list = this.element('rows');
    if (!list.childElementCount) list.innerHTML = '<li class="setting-note">Loading…</li>';
    try {
      const { entries } = await api<{ entries: Row[] }>(`leaderboard${tick === 'all' ? '' : `?tick=${tick}`}`);
      if (request !== this.loading) return;
      list.innerHTML = entries.length ? entries.map(row => this.row(row)).join('') : '<li class="setting-note">No jumps posted yet.</li>';
    } catch (error) {
      if (request === this.loading) list.innerHTML = `<li class="setting-note">${escape(error instanceof Error ? error.message : 'Leaderboard unavailable.')}</li>`;
    }
  }
  private row(row: Row) {
    const s = row.stats, own = row.name === this.player?.name ? ' own' : '';
    const metrics = s ? `<div class="jump-metrics"><div><span>PRE SPEED</span><b>${number(s.preSpeed)}</b></div><div><span>MAX SPEED</span><b>${number(s.maxSpeed)}</b></div>
      <div><span>SYNC</span><b>${number(s.sync)}%</b></div><div><span>STRAFES</span><b>${s.strafes}</b></div><div><span>HEIGHT</span><b>${number(s.height, 2)}</b></div>
      <div><span>AIRTIME</span><b>${number(s.airtime, 3)}s</b></div><div><span>EDGE</span><b>${number(s.edge)}</b></div><div><span>WIDTH</span><b>${number(s.width)}°</b></div>
      <div><span>OVERLAP</span><b>${s.overlap}</b></div><div><span>DEAD AIR</span><b>${s.deadAir}</b></div></div>` : '';
    return `<li><details class="history-attempt leaderboard-row${own}"><summary><span class="leaderboard-rank">${row.rank}</span>
      <span class="leaderboard-name">${escape(row.name)}<small>${escape(mapName(row.mapId))}</small></span>
      <span class="leaderboard-score"><b>${row.distance.toFixed(2)}</b><small>${row.tickRate}T</small></span></summary>
      <div class="history-detail"><p>${new Date(row.at).toLocaleString()}${s?.ducked ? ' · Ducked' : ''}</p>${metrics}</div></details></li>`;
  }
  private post({ result, replay }: Pending) {
    // Assume it counts until the server answers so a quick second jump is compared correctly.
    const player = this.player!, previous = this.bests[replay.tickRate]; this.bests[replay.tickRate] = result.distance;
    return api<{ distance: number; improved: boolean; rank: number }>('jumps', { method: 'POST', key: player.key, body: JSON.stringify({ replay: { version: 1, ...replay } }) })
      .then(posted => { if (posted.improved) this.notify(`Leaderboard #${posted.rank} · ${posted.distance.toFixed(2)}`); })
      .catch(error => {
        if (this.bests[replay.tickRate] === result.distance) this.bests[replay.tickRate] = previous ?? 0;
        if (error instanceof ApiError && error.status === 401) this.forget('Your saved name was removed. Choose a name to keep posting.');
        else if (error instanceof ApiError && error.status !== 0 && error.status !== 503 && error.status !== 429) this.notify(error.message);
      });
  }
  /** Posts a valid manual jump that beats this name's posted best, or holds it until a name is chosen. Never blocks play. */
  submit(result: Result, replay: Omit<Replay, 'version'>) {
    if (!result.valid) return;
    if (!this.player) {
      if (result.distance <= (this.pending.get(replay.tickRate)?.result.distance ?? 0)) return;
      // The open prompt updates in place; Not now keeps it closed for the session.
      this.pending.set(replay.tickRate, { result, replay }); this.render();
      if (!this.dismissed && !this.hinted) { this.hinted = true; this.notify('Add a name to post on the leaderboard? Press Esc'); }
      return;
    }
    if (result.distance > (this.bests[replay.tickRate] ?? 0)) void this.post({ result, replay });
  }
}
