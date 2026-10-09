import { ApiError, type Identity } from './identity';
import { escapeHtml, nameForm } from './html';
import { ROOM_SIZE, type RoomClient } from './room';

type Viewing = { showPlayers(): boolean; setShowPlayers(show: boolean): void; spectating(): string | null; spectate(id: string | null): void };

// Practice-tab controls for private rooms: create, join from an invite link,
// copy the link, see who's here, spectate them, hide their models and leave. Joining needs a name first.
export class RoomPanel {
  private invite: string | null = null;
  private naming = false;
  private message = '';
  constructor(private root: HTMLElement, private identity: Identity, private room: RoomClient, private mapId: () => string, private viewing: Viewing) {
    root.innerHTML = `<div class="profile-row room-row"><span data-room="title"></span><div class="settings-buttons">
        <button class="settings-button" data-room="create">Create room</button>
        <button class="settings-button" data-room="copy">Copy invite link</button>
        <button class="settings-button" data-room="leave">Leave</button></div></div>
      ${nameForm('room', 'Join', 'Cancel')}
      <p class="setting-note" data-room="status" role="status" aria-live="polite"></p>
      <ul class="room-players" data-room="players"></ul>
      <label class="toggle-row room-options" data-room="options">Show other players <input type="checkbox" data-room="show"/></label>`;
    this.element<HTMLInputElement>('show').addEventListener('change', () => this.viewing.setShowPlayers(this.element<HTMLInputElement>('show').checked));
    this.element('players').addEventListener('click', event => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-spectate]')?.dataset.spectate;
      if (id !== undefined) this.viewing.spectate(id || null);
    });
    this.element('create').addEventListener('click', () => { if (this.identity.player) this.room.start(this.mapId()); else { this.naming = true; this.render(); this.focusName(); } });
    this.element('leave').addEventListener('click', () => { this.room.leave(); this.setHash(null); this.message = ''; this.render(); });
    this.element('copy').addEventListener('click', () => void navigator.clipboard.writeText(this.room.inviteLink())
      .then(() => this.status('Invite link copied.'), () => this.status(this.room.inviteLink())));
    const form = this.form();
    form.addEventListener('submit', event => { event.preventDefault(); void this.saveName(); });
    this.field(form, 'cancel').addEventListener('click', () => { this.naming = false; if (this.invite) { this.invite = null; this.setHash(null); } this.render(); });
    identity.onChange(() => this.render());
    // Invite links look like longjump.ing/#room=abcd2345.
    const code = new URLSearchParams(location.hash.slice(1)).get('room');
    if (code && /^[a-z2-9]{8}$/i.test(code)) {
      this.invite = code.toLowerCase();
      if (identity.player) room.join(this.invite); else this.naming = true;
    }
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
      if (this.invite) this.room.join(this.invite); else this.room.start(this.mapId());
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
    const r = this.room, inRoom = !!r.code && r.status !== 'idle', open = r.connected;
    if (open) this.setHash(r.code);
    this.element('title').textContent = open ? `Room ${r.code} · ${r.players.size}/${ROOM_SIZE}`
      : inRoom || r.status !== 'idle' ? (r.status === 'retrying' ? 'Reconnecting…' : 'Joining room…')
      : this.invite && this.naming ? `Join room ${this.invite}` : 'Play with friends';
    this.element('create').hidden = inRoom || r.status !== 'idle' || this.naming;
    this.element('copy').hidden = !open; this.element('leave').hidden = !inRoom && r.status === 'idle';
    const form = this.form(); form.hidden = !this.naming || !!this.identity.player;
    this.field(form, 'save').textContent = this.invite ? 'Join' : 'Create room';
    this.element('status').textContent = this.message; this.element('status').hidden = !this.message;
    const watching = this.viewing.spectating();
    this.element('players').innerHTML = open ? [...r.players].map(([id, name]) => `<li>${escapeHtml(name)}${id === r.you ? ' <small>you</small>'
      : id === watching ? ' <small>spectating</small> <button class="settings-button" data-spectate="">Stop</button>' : ` <button class="settings-button" data-spectate="${escapeHtml(id)}" aria-label="Spectate ${escapeHtml(name)}">Spectate</button>`}</li>`).join('') : '';
    this.element('options').hidden = !open;
    this.element<HTMLInputElement>('show').checked = this.viewing.showPlayers();
  }
}
