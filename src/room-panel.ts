import { createElement, Eye } from 'lucide';
import { api, ApiError, type Identity } from './identity';
import { escapeHtml, nameForm } from './html';
import { ROOM_SIZE, type RoomClient } from './room';

type Viewing = { showPlayers(): boolean; setShowPlayers(show: boolean): void; spectating(): string | null; spectate(id: string | null): void;
  autoJoin(): boolean; setAutoJoin(on: boolean): void; counts(counts: Record<string, number>): void };

// Practice-tab controls for rooms: join the map's public room, create a private one, join from an invite link,
// copy the link, see who's here, spectate them, hide their models and leave. Joining needs a name first.
// Named players join a busy public room on load until they leave one.
const REFRESH_MS = 15_000;
const eye = createElement(Eye, { 'aria-hidden': 'true' }).outerHTML;
export class RoomPanel {
  private invite: string | null = null;
  private naming = false;
  private joiningPublic = false;
  private message = '';
  private counts: Record<string, number> = {};
  private refreshedAt = -Infinity;
  private loaded = false;
  constructor(private root: HTMLElement, private identity: Identity, private room: RoomClient, private mapId: () => string, private viewing: Viewing) {
    root.innerHTML = `<h3>Play with others</h3><div class="settings-card room-card">
      <div class="setting-row" data-room="head"><span class="setting-text"><span data-room="title"></span><small data-room="detail"></small></span>
        <div class="settings-buttons"><button class="settings-button" data-room="copy">Copy link</button><button class="settings-button" data-room="leave"></button></div></div>
      <div class="setting-row" data-room="public-row"><span class="setting-text"><span>Public room</span><small data-room="public-note"></small></span>
        <button class="settings-button" data-room="public" aria-label="Join public room">Join</button></div>
      <div class="setting-row" data-room="create-row"><span class="setting-text"><span>Private room</span><small>Invite friends with a link</small></span>
        <button class="settings-button" data-room="create" aria-label="Create private room">Create</button></div>
      <div class="room-naming" data-room="naming"><span class="setting-text"><span data-room="naming-title"></span><small>Other players and the leaderboard show this name.</small></span>
        ${nameForm('room', 'Join', 'Cancel')}</div>
      <ul class="room-players" data-room="players" aria-label="Players in this room"></ul>
      <label class="setting-row" data-room="options"><span class="setting-text"><span>Show other players</span></span><input class="switch" type="checkbox" role="switch" data-room="show"/></label>
      <p class="setting-note" data-room="status" role="status" aria-live="polite"></p></div>`;
    this.element<HTMLInputElement>('show').addEventListener('change', () => this.viewing.setShowPlayers(this.element<HTMLInputElement>('show').checked));
    this.element('players').addEventListener('click', event => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-spectate]')?.dataset.spectate;
      if (id !== undefined) this.viewing.spectate(id || null);
    });
    this.element('create').addEventListener('click', () => { this.joiningPublic = false; if (this.identity.player) this.room.start(this.mapId()); else { this.naming = true; this.render(); this.focusName(); } });
    this.element('public').addEventListener('click', () => {
      this.viewing.setAutoJoin(true); this.joiningPublic = true;
      if (this.identity.player) this.room.joinPublic(this.mapId()); else { this.naming = true; this.render(); this.focusName(); }
    });
    this.element('leave').addEventListener('click', () => {
      if (this.room.publicMap) this.viewing.setAutoJoin(false);
      this.room.leave(); this.setHash(null); this.message = ''; this.render();
    });
    this.element('copy').addEventListener('click', () => void navigator.clipboard.writeText(this.room.inviteLink())
      .then(() => this.status('Invite link copied.'), () => this.status(this.room.inviteLink())));
    const form = this.form();
    form.addEventListener('submit', event => { event.preventDefault(); void this.saveName(); });
    this.field(form, 'cancel').addEventListener('click', () => { this.naming = false; this.joiningPublic = false; if (this.invite) { this.invite = null; this.setHash(null); } this.render(); });
    identity.onChange(() => this.render());
    // Invite links look like longjump.ing/#room=abcd2345.
    const code = new URLSearchParams(location.hash.slice(1)).get('room');
    if (code && /^[a-z2-9]{8}$/i.test(code)) {
      this.invite = code.toLowerCase();
      if (identity.player) room.join(this.invite); else this.naming = true;
    }
    this.render(); void this.refresh();
  }
  /** Fetches public room counts, at most every few seconds; the first fetch may auto-join. */
  async refresh() {
    if (performance.now() - this.refreshedAt < REFRESH_MS) return;
    this.refreshedAt = performance.now();
    try { this.counts = (await api<{ maps: Record<string, number> }>('rooms/public')).maps; } catch { return; }
    this.viewing.counts(this.counts);
    const first = !this.loaded; this.loaded = true;
    if (first && this.viewing.autoJoin() && this.identity.player && !this.invite && this.room.status === 'idle' && this.counts[this.mapId()]) this.room.joinPublic(this.mapId());
    this.render();
  }
  private element<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-room="${name}"]`)!; }
  private form() { return this.root.querySelector<HTMLFormElement>('[data-form="room"]')!; }
  private field<T extends HTMLElement = HTMLElement>(form: HTMLElement, name: string) { return form.querySelector<T>(`[data-field="${name}"]`)!; }
  private focusName() { this.field<HTMLInputElement>(this.form(), 'name').focus(); }
  private status(message: string) { this.message = message; this.render(); }
  private setHash(code: string | null) { history.replaceState(null, '', code ? `#room=${code}` : location.pathname + location.search); }
  private async saveName() {
    const form = this.form(), input = this.field<HTMLInputElement>(form, 'name'), button = this.field<HTMLButtonElement>(form, 'save'), name = input.value.trim();
    if (!name) return;
    button.disabled = true;
    try {
      await this.identity.save(name);
      this.naming = false; input.value = ''; this.message = '';
      if (this.invite) this.room.join(this.invite); else if (this.joiningPublic) this.room.joinPublic(this.mapId()); else this.room.start(this.mapId());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.identity.forget();
      this.message = error instanceof Error ? error.message : 'Could not save that name.';
    } finally { button.disabled = false; this.render(); }
  }
  /** Shows a room error, such as a full or ended room. */
  error(message: string) {
    if (!this.room.code) { this.invite = null; this.setHash(null); }
    this.message = message; this.render();
  }
  render() {
    const r = this.room, open = r.connected, busy = r.status !== 'idle', naming = this.naming && !this.identity.player;
    // Public rooms rematch by map on reload, so only private rooms keep their code in the address.
    if (open) this.setHash(r.publicMap ? null : r.code);
    const playing = this.counts[this.mapId()] ?? 0;
    this.element('head').hidden = !busy;
    this.element('title').textContent = open ? (r.publicMap ? 'Public room' : 'Private room')
      : r.status === 'retrying' ? 'Reconnecting…' : r.publicMap ? 'Joining public room…' : 'Joining room…';
    this.element('detail').textContent = open ? `${r.publicMap ? '' : `Code ${r.code} · `}${r.players.size} of ${ROOM_SIZE} players` : '';
    this.element('detail').hidden = !open;
    this.element('leave').textContent = open ? 'Leave' : 'Cancel';
    this.element('copy').hidden = !open || !!r.publicMap;
    this.element('public-row').hidden = this.element('create-row').hidden = busy || naming;
    this.element('public-note').innerHTML = playing ? `<span class="live-dot" aria-hidden="true"></span>${playing} playing on this map` : 'Anyone on this map can join';
    this.element('naming').hidden = !naming;
    this.element('naming-title').textContent = this.invite ? `Join room ${this.invite}` : 'Choose a name';
    this.field(this.form(), 'save').textContent = this.invite || this.joiningPublic ? 'Join' : 'Create';
    this.element('status').textContent = this.message; this.element('status').hidden = !this.message;
    const watching = this.viewing.spectating();
    // You first, then everyone else in join order.
    const players = [...r.players].sort(([a], [b]) => Number(b === r.you) - Number(a === r.you));
    this.element('players').hidden = !open;
    this.element('players').innerHTML = open ? players.map(([id, name]) => {
      const label = escapeHtml(name), watched = id === watching;
      return `<li class="room-player"><span>${label}</span>${id === r.you ? '<small>you</small>' : `${watched ? '<small>spectating</small>' : ''}
        <button class="room-spectate" data-spectate="${watched ? '' : escapeHtml(id)}" aria-pressed="${watched}" aria-label="${watched ? 'Stop spectating' : 'Spectate'} ${label}" title="${watched ? 'Stop spectating' : 'Spectate'}">${eye}</button>`}</li>`;
    }).join('') : '';
    this.element('options').hidden = !open;
    this.element<HTMLInputElement>('show').checked = this.viewing.showPlayers();
  }
}
