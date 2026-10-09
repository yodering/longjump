import { accountRequest, accountUser, AccountSync, AccountError, type AccountUser } from './account-sync';
import { HistoryArchive } from './history-archive';
import { readBests, type Entry } from './history';

type Hooks = { activate: (archive: HistoryArchive, user: AccountUser | null) => Promise<void>;
  changed: () => Promise<void>; canRun: () => boolean; guestBests: () => Entry[]; export: () => Promise<void> };
export class AccountPanel {
  user: AccountUser | null = null;
  private archive: HistoryArchive;
  private syncer: AccountSync | null = null;
  private syncMessage = 'Checking accounts…';
  private busy = false;
  private generation = 0;
  private key = '';
  constructor(private root: HTMLElement, private guest: HistoryArchive, private hooks: Hooks) {
    this.archive = guest;
    root.innerHTML = `<div class="account-summary"><span data-account="identity">Guest</span><span class="setting-note" data-account="status"></span><button class="settings-button" data-account="toggle" aria-expanded="false" aria-controls="account-details">Sign in</button></div>
      <div id="account-details" class="account-details" hidden>
      <div data-account="forms"><form data-account="form" class="account-form">
        <label>Username <input name="username" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" required/></label>
        <label data-account="key-label" hidden>Recovery key <input name="recoveryKey" autocomplete="off" maxlength="64"/></label>
        <label>Password <span class="account-password"><input name="password" aria-label="Password" type="password" autocomplete="current-password" maxlength="128" required/><button class="settings-button" data-account="show-password" type="button" aria-pressed="false">Show</button></span></label>
        <p class="setting-note" data-account="help">Your username is also your display name.</p>
        <div class="settings-buttons"><button class="settings-button" type="submit" data-account="submit">Sign in</button><button class="settings-button" type="button" data-account="mode">Create account</button><button class="settings-button" type="button" data-account="recover">Recover account</button></div>
      </form></div>
      <div data-account="manage" hidden><p class="setting-note">History and best jumps sync across devices. Settings and saved positions stay on this device; Backups can transfer them.</p>
        <div class="settings-buttons"><button class="settings-button" data-account="sync">Sync now</button><button class="settings-button" data-account="guest">Copy guest progress</button><button class="settings-button" data-account="logout">Sign out</button></div>
        <div data-account="copy-confirm" hidden><p class="setting-note" data-account="copy-note"></p><div class="settings-buttons"><button class="settings-button" data-account="copy">Copy into this account</button><button class="settings-button" data-account="copy-cancel">Cancel</button></div></div>
        <details><summary>Delete account</summary><p class="setting-note">Permanently removes your account and cloud history. Export a backup first. The local copy stays on this device.</p><button class="settings-button" data-account="export">Export backup</button>
          <form data-account="delete-form" class="account-form"><label>Confirm username <input name="username" autocomplete="username" required/></label><label>Password <input name="password" type="password" autocomplete="current-password" required maxlength="128"/></label><button class="settings-button" type="submit">Permanently delete account</button></form>
        </details>
      </div>
      <div data-account="recovery" hidden><p class="setting-note">Save this recovery key. It resets your password if you forget it. There is no email recovery.</p><textarea data-account="recovery-value" aria-label="Your recovery key" readonly spellcheck="false"></textarea><div class="settings-buttons"><button class="settings-button" data-account="copy-key">Copy key</button><button class="settings-button" data-account="download-key">Download key</button><button class="settings-button" data-account="done">I saved my key</button></div></div>
      <p class="setting-note" role="alert" data-account="error"></p>
      <button class="settings-button" data-account="signin-again" hidden>Sign in again</button><button class="settings-button" data-account="local-guest" hidden>Use guest on this device</button>
      </div>`;
    let mode: 'login' | 'signup' | 'recover' = 'login';
    const changeMode = (next: typeof mode) => {
      mode = next; const password = this.input('password'); password.value = ''; password.type = 'password'; this.el('show-password').textContent = 'Show'; this.el('show-password').setAttribute('aria-pressed', 'false'); password.minLength = next === 'login' ? 0 : 15;
      password.autocomplete = next === 'login' ? 'current-password' : 'new-password';
      this.el('key-label').hidden = next !== 'recover'; this.input('recoveryKey').required = next === 'recover';
      this.el('submit').textContent = next === 'signup' ? 'Create account' : next === 'recover' ? 'Reset password' : 'Sign in';
      this.el('mode').textContent = next === 'login' ? 'Create account' : 'Back to sign in';
      this.el('help').textContent = next === 'login' ? 'Your username is also your display name.' : 'Use 3–20 letters, numbers or underscores and a password of at least 15 characters. No email needed.';
    };
    this.el('toggle').onclick = () => { const panel = this.el('details'); panel.hidden = !panel.hidden; this.el('toggle').setAttribute('aria-expanded', String(!panel.hidden)); };
    this.el('mode').onclick = () => changeMode(mode === 'login' ? 'signup' : 'login');
    this.el('show-password').onclick = () => { const input = this.input('password'); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; this.el('show-password').textContent = show ? 'Hide' : 'Show'; this.el('show-password').setAttribute('aria-pressed', String(show)); };
    this.el('recover').onclick = () => changeMode('recover');
    this.el('signin-again').onclick = () => { this.el('forms').hidden = false; changeMode('login'); };
    this.el('form').onsubmit = event => {
      event.preventDefault();
      const data = { username: this.input('username').value, password: this.input('password').value, recoveryKey: this.input('recoveryKey').value };
      void this.run(async () => {
        this.syncer?.pause();
        const result = await accountRequest(`account/${mode}`, data);
        this.input('password').value = ''; this.input('recoveryKey').value = '';
        if (result.recoveryKey) this.showKey(result.recoveryKey);
        if (mode === 'recover') { this.syncer?.stop(); this.syncMessage = 'Password reset. Sign in with your new password.'; changeMode('login'); this.update(); }
        else await this.activate(accountUser(result.user));
      });
    };
    this.el('done').onclick = () => { this.key = ''; (this.el('recovery-value') as HTMLTextAreaElement).value = ''; this.el('recovery').hidden = true; this.update(); };
    this.el('copy-key').onclick = () => void navigator.clipboard.writeText(this.key).then(() => { this.el('error').textContent = 'Recovery key copied.'; }, () => { this.el('error').textContent = 'Clipboard unavailable. Download your key instead.'; });
    this.el('download-key').onclick = () => {
      const url = URL.createObjectURL(new Blob([`longjump recovery key\nUsername: ${this.input('username').value}\n${this.key}\nKeep this private.\n`], { type: 'text/plain' }));
      const link = document.createElement('a'); link.href = url; link.download = 'longjump-recovery-key.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    this.el('sync').onclick = () => void this.syncer?.sync();
    this.el('guest').onclick = () => void this.run(async () => {
      const entries = await this.guest.export();
      this.el('copy-note').textContent = `Copy ${entries.length.toLocaleString()} guest attempts and personal bests into ${this.user?.displayName}? Guest progress will also stay on this device.`;
      this.el('copy-confirm').hidden = false;
    });
    this.el('copy-cancel').onclick = () => { this.el('copy-confirm').hidden = true; };
    this.el('copy').onclick = () => void this.run(async () => {
      if (!this.user) return;
      const target = this.archive;
      const entries = await this.guest.export();
      await target.merge(entries, readBests([...this.hooks.guestBests(), ...await this.guest.bests()], entries));
      this.el('copy-confirm').hidden = true; await this.hooks.changed(); this.syncer?.wake();
    });
    this.el('logout').onclick = () => void this.run(async () => {
      this.syncer?.pause(); await accountRequest('account/logout', {}, this.user?.id); await this.activate(null);
    });
    this.el('local-guest').onclick = () => void this.run(() => this.activate(null));
    this.el('export').onclick = () => void this.hooks.export();
    this.el('delete-form').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget as HTMLFormElement;
      const values = new FormData(form); const data = { username: values.get('username'), password: values.get('password') };
      void this.run(async () => {
        this.syncer?.pause(); await accountRequest('account/delete', data, this.user?.id);
        form.reset(); await this.activate(null); this.el('error').textContent = 'Account and cloud history deleted.';
      });
    };
    this.update(); void this.restore();
    window.addEventListener('online', () => this.wake());
    document.addEventListener('visibilitychange', () => this.wake());
  }
  private el(name: string) { return this.root.querySelector<HTMLElement>(name === 'details' ? '#account-details' : `[data-account="${name}"]`)!; }
  private input(name: string) { return this.el('form').querySelector<HTMLInputElement>(`[name="${name}"]`)!; }
  private async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true; this.generation++; this.el('error').textContent = '';
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) {
      this.el('error').textContent = error instanceof Error ? error.message : 'Could not complete this request.';
      this.syncer?.wake();
    } finally { this.busy = false; this.root.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; }); }
  }
  private showKey(key: string) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Could not read your recovery key.');
    this.key = key; (this.el('recovery-value') as HTMLTextAreaElement).value = key; this.el('recovery').hidden = false;
  }
  private update() {
    this.el('identity').textContent = this.user?.displayName ?? 'Guest';
    this.el('delete-form').querySelector<HTMLInputElement>('[name="username"]')!.placeholder = this.user?.username ?? '';
    this.el('status').textContent = this.syncMessage;
    this.el('toggle').textContent = this.user ? 'Account' : 'Sign in';
    this.el('forms').hidden = !!this.user;
    this.el('manage').hidden = !this.user;
    this.updateRetry();
  }
  private async activate(user: AccountUser | null, remember = true, connected = true, generation = this.generation) {
    // A sign-in finishing while the player resumes must wait until the menu opens.
    while (!this.hooks.canRun()) await new Promise(resolve => setTimeout(resolve, 250));
    if (generation !== this.generation) return;
    this.syncer?.stop(); this.syncer = null;
    const archive = user ? new HistoryArchive([], undefined, `longjump-history-account-${user.id}`, true) : this.guest;
    await archive.ready();
    while (!this.hooks.canRun()) await new Promise(resolve => setTimeout(resolve, 250));
    if (generation !== this.generation) { if (archive !== this.guest) await archive.close(); return; }
    const previous = this.archive;
    this.user = user; this.archive = archive; this.syncMessage = user ? 'Saved on this device' : 'Saved on this device · no account needed';
    await this.hooks.activate(archive, user);
    if (previous !== this.guest && previous !== archive) await previous.close();
    if (remember) try { localStorage.setItem('longjump-profile', JSON.stringify(user)); } catch { /* The account cookie still works. */ }
    if (user && connected) this.startSync(); this.update();
  }
  private updateRetry() {
    const retry = !!this.user && this.syncMessage !== 'Saved to cloud' && this.syncMessage !== 'Syncing…' && this.syncMessage !== 'Waiting to sync…';
    this.el('signin-again').hidden = !retry; this.el('local-guest').hidden = !retry;
  }
  private startSync() {
    if (!this.user) return;
    this.syncer?.stop();
    this.syncer = new AccountSync(this.archive, this.user.id, this.hooks.canRun,
      message => { this.syncMessage = message; this.el('status').textContent = message; this.updateRetry(); }, this.hooks.changed);
    this.syncer.wake();
  }
  private async restore() {
    const generation = this.generation;
    try {
      const saved = localStorage.getItem('longjump-profile');
      if (saved && JSON.parse(saved)) await this.activate(accountUser(JSON.parse(saved)), false, false, generation);
      if (generation !== this.generation) return;
      const result = await accountRequest('account');
      if (generation !== this.generation) return;
      if (result.user && saved !== 'null') await this.activate(accountUser(result.user), true, true, generation);
      else if (this.user) { this.syncMessage = 'Sign in again to sync. Jumps stay saved here.'; this.update(); }
      else { this.syncMessage = 'Saved on this device · no account needed'; this.update(); }
    } catch (error) { if (generation !== this.generation) return; if (!this.user && error instanceof AccountError && error.status === 503) this.root.hidden = true; this.syncMessage = this.user ? 'Offline · progress saved on this device' : error instanceof Error ? error.message : 'Account service unavailable'; this.update(); }
  }
  wake() {
    if (this.hooks.canRun()) this.syncer?.wake();
    else { this.syncer?.pause(); this.input('password').value = ''; if (this.user && this.syncer) { this.syncMessage = 'Saved here · cloud sync when paused'; this.el('status').textContent = this.syncMessage; } }
  }
}
