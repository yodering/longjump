import { createElement, Plus, X } from 'lucide';
import { actions, assignBinding, normalizeBindings, tokenLabel, validToken, type Action } from './bindings.ts';
import { normalizeSettings, resolutions, viewPresets, viewRanges, type Settings } from './settings.ts';
import { exportConfig, importConfig, type ConfigReport } from './config.ts';

const labels = { fov: 'Viewmodel FOV', x: 'Horizontal offset', y: 'Forward offset', z: 'Vertical offset',
  bobLower: 'Running lower', bobLat: 'Side bob', bobVert: 'Vertical bob', bobCycle: 'Bob cycle' };
const crosshairMarkup = '<i></i><i></i><i></i><i></i><b></b>';
export class SettingsPanel {
  private capture: Action | null = null;
  private pending: Settings | null = null;
  constructor(private root: HTMLElement, private settings: Settings, private changed: () => void) {
    root.insertAdjacentHTML('afterbegin', `
      <details class="settings-section" open><summary>Controls</summary>
        <div id="binding-list"></div><p id="binding-status" role="status" class="setting-note">Select + to add a bind, then press a key, mouse button or scroll. Esc cancels.</p>
        <button id="bindings-reset" class="settings-button">Restore default binds</button>
        <p class="setting-note">LJ bind: jump + duck, release forward/back. Release the bind to stand, then duck again before landing.</p>
        <label class="toggle-row">Invert mouse Y <input id="invert-y" type="checkbox"/></label>
      </details>
      <details class="settings-section"><summary>Display</summary>
        <label class="toggle-row">Theme <select id="appearance"><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label class="toggle-row">Render resolution <select id="resolution">${Object.entries(resolutions).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
        <label class="toggle-row">Scaling <select id="scaling"><option value="stretch">Stretched</option><option value="fit">Black bars</option></select></label>
        <button id="settings-fullscreen" class="settings-button">Toggle fullscreen</button>
        <p class="setting-note">90° FOV at 4:3, matching CS:GO.</p>
      </details>
      <details class="settings-section"><summary>Viewmodel</summary>
        <label class="toggle-row">Preset <select id="view-preset"><option value="custom">Custom</option><option value="desktop">Desktop</option><option value="couch">Couch</option><option value="classic">Classic</option></select></label>
        ${Object.entries(viewRanges).map(([id, [min, max, step]]) => `<label class="setting-range" for="view-${id}">${labels[id as keyof typeof labels]} <output id="view-${id}-output"></output></label><input data-view="${id}" id="view-${id}" type="range" min="${min}" max="${max}" step="${step}"/>`).join('')}
      </details>
      <details class="settings-section"><summary>Crosshair</summary>
        <div class="crosshair-preview"><div class="cs-crosshair">${crosshairMarkup}</div></div>
        <label class="toggle-row">Color <input id="crosshair-color" type="color"/></label>
        ${[['size', 'Length', 0, 20, 0.5], ['gap', 'Gap', -5, 20, 0.5], ['thickness', 'Thickness', 0.5, 5, 0.5], ['alpha', 'Opacity', 0, 1, 0.05]].map(([id, label, min, max, step]) => `<label class="setting-range" for="crosshair-${id}">${label} <output id="crosshair-${id}-output"></output></label><input data-crosshair="${id}" id="crosshair-${id}" type="range" min="${min}" max="${max}" step="${step}"/>`).join('')}
        <label class="toggle-row">Center dot <input id="crosshair-dot" type="checkbox"/></label>
        <label class="toggle-row">Outline <input id="crosshair-outline" type="checkbox"/></label>
      </details>
      <details class="settings-section"><summary>Import / export</summary>
        <p class="setting-note">Import your CS:GO .cfg for supported movement binds, sensitivity, viewmodel and static crosshair settings. Other commands are listed and skipped.</p>
        <div class="settings-buttons"><button id="import-config" class="settings-button">Import config / profile</button><button id="export-config" class="settings-button">Export .cfg</button><button id="export-profile" class="settings-button">Export profile</button></div>
        <input id="config-file" type="file" accept=".cfg,.json,.txt" hidden/>
        <p id="config-status" role="status" class="setting-note"></p>
        <details id="config-report" hidden><summary>Import details</summary><pre id="config-report-text"></pre></details>
        <div id="config-apply-row" class="settings-buttons" hidden><button id="config-apply" class="settings-button">Apply imported settings</button><button id="config-cancel" class="settings-button">Cancel</button></div>
      </details>
    `);
    this.on('bindings-reset', 'click', () => { settings.bindings = normalizeBindings(null); this.capture = null; this.commit(); this.status('Default binds restored.'); });
    this.on('invert-y', 'change', () => { settings.invertY = this.input('invert-y').checked; this.commit(); });
    for (const id of ['resolution', 'scaling', 'appearance'] as const) this.on(id, 'change', () => {
      Object.assign(settings, { [id]: this.input(id).value }); this.commit();
    });
    this.on('settings-fullscreen', 'click', () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => this.status('Fullscreen is unavailable in this browser.')); });
    this.on('view-preset', 'change', () => { const preset = viewPresets[this.input('view-preset').value]; if (preset) { settings.view = { ...preset }; this.commit(); } });
    root.querySelectorAll<HTMLInputElement>('[data-view]').forEach(input => input.addEventListener('input', () => {
      settings.view[input.dataset.view as keyof Settings['view']] = Number(input.value); this.commit();
    }));
    root.querySelectorAll<HTMLInputElement>('[data-crosshair]').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.crosshair as 'size' | 'gap' | 'thickness' | 'alpha'; settings.crosshair[key] = Number(input.value); this.commit();
    }));
    this.on('crosshair-color', 'input', () => { settings.crosshair.color = this.input('crosshair-color').value; this.commit(); });
    for (const key of ['dot', 'outline'] as const) this.on(`crosshair-${key}`, 'change', () => { settings.crosshair[key] = this.input(`crosshair-${key}`).checked; this.commit(); });
    this.on('import-config', 'click', () => this.input('config-file').click());
    this.on('config-file', 'change', () => void this.readFile());
    this.on('config-apply', 'click', () => {
      if (!this.pending) return;
      Object.assign(settings, this.pending); this.pending = null; this.capture = null;
      this.commit(); this.root.querySelector<HTMLElement>('#config-apply-row')!.hidden = true;
      this.root.querySelector<HTMLElement>('#config-status')!.textContent = 'Settings saved.';
    });
    this.on('config-cancel', 'click', () => { this.pending = null; this.root.querySelector<HTMLElement>('#config-apply-row')!.hidden = true; this.root.querySelector<HTMLElement>('#config-status')!.textContent = 'Import cancelled.'; });
    this.on('export-config', 'click', () => this.download('vnl-lj.cfg', exportConfig(settings)));
    this.on('export-profile', 'click', () => this.download('vnl-lj-profile.json', JSON.stringify({ format: 'vnl-lj-profile', version: 1, settings }, null, 2)));
    this.render();
  }
  private input(id: string) { return this.root.querySelector<HTMLInputElement>(`#${id}`)!; }
  private on(id: string, event: string, fn: () => void) { this.root.querySelector(`#${id}`)!.addEventListener(event, fn); }
  private status(text: string) { this.root.querySelector('#binding-status')!.textContent = text; }
  private commit() { this.changed(); this.render(); }
  cancelCapture() { if (this.capture) this.status('Binding cancelled.'); this.capture = null; this.renderBindings(); }
  captureToken(token: string) {
    if (!this.capture) return false;
    if (token === 'Escape') { this.cancelCapture(); return true; }
    if (!validToken(token)) { this.status('That key is reserved or unsupported. Choose another key, or Esc to cancel.'); return true; }
    const action = this.capture;
    if (this.settings.bindings[action].length >= 8 && !this.settings.bindings[action].includes(token)) { this.status('Remove a bind before adding another.'); return true; }
    const previous = assignBinding(this.settings.bindings, action, token); this.capture = null;
    this.commit(); this.status(`${tokenLabel(token)} bound to ${actions[action]}.${previous && previous !== action ? ` Removed from ${actions[previous]}.` : ''}`);
    return true;
  }
  private renderBindings() {
    const list = this.root.querySelector('#binding-list')!; list.replaceChildren();
    for (const action of Object.keys(actions) as Action[]) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('span'); label.textContent = actions[action]; row.append(label);
      const binds = document.createElement('div'); binds.className = 'binding-buttons';
      for (const token of this.settings.bindings[action]) {
        const button = document.createElement('button'); button.className = 'binding-chip';
        const key = document.createElement('span'); key.textContent = tokenLabel(token);
        button.append(key, createElement(X, { class: 'binding-remove', 'aria-hidden': 'true' }));
        button.title = `Remove ${tokenLabel(token)}`;
        button.setAttribute('aria-label', `Remove ${tokenLabel(token)} from ${actions[action]}`);
        button.addEventListener('click', () => { this.settings.bindings[action] = this.settings.bindings[action].filter(t => t !== token); this.commit(); }); binds.append(button);
      }
      const add = document.createElement('button'); add.className = 'binding-add';
      if (this.capture === action) { add.textContent = 'Press a key…'; add.classList.add('capturing'); }
      else {
        add.append(createElement(Plus, { 'aria-hidden': 'true' }));
        if (!this.settings.bindings[action].length) add.append('Bind');
      }
      add.title = `Add binding for ${actions[action]}`;
      add.setAttribute('aria-label', `Add binding for ${actions[action]}`);
      add.addEventListener('click', () => { this.capture = action; this.renderBindings(); this.status(`Press a key, mouse button or scroll for ${actions[action]}. Esc cancels.`); });
      binds.append(add); row.append(binds); list.append(row);
    }
  }
  render() {
    this.renderBindings(); const s = this.settings;
    this.input('invert-y').checked = s.invertY;
    this.input('appearance').value = s.appearance; this.input('resolution').value = s.resolution; this.input('scaling').value = s.scaling;
    this.input('view-preset').value = Object.entries(viewPresets).find(([, v]) => Object.keys(viewRanges).every(k => v[k as keyof typeof v] === s.view[k as keyof typeof v]))?.[0] ?? 'custom';
    for (const key of Object.keys(viewRanges) as (keyof Settings['view'])[]) {
      this.input(`view-${key}`).value = String(s.view[key]); this.root.querySelector(`#view-${key}-output`)!.textContent = String(s.view[key]);
    }
    for (const key of ['size', 'gap', 'thickness', 'alpha'] as const) {
      this.input(`crosshair-${key}`).value = String(s.crosshair[key]); this.root.querySelector(`#crosshair-${key}-output`)!.textContent = String(s.crosshair[key]);
    }
    this.input('crosshair-color').value = s.crosshair.color;
    for (const key of ['dot', 'outline'] as const) this.input(`crosshair-${key}`).checked = s.crosshair[key];
    const style = document.documentElement.style;
    for (const key of ['size', 'gap', 'thickness'] as const) style.setProperty(`--crosshair-${key}`, `${s.crosshair[key]}px`);
    style.setProperty('--crosshair-color', s.crosshair.color); style.setProperty('--crosshair-alpha', String(s.crosshair.alpha));
    style.setProperty('--crosshair-outline', s.crosshair.outline ? '0 0 0 1px #000' : 'none');
    style.setProperty('--crosshair-dot', s.crosshair.dot ? 'block' : 'none');
  }
  private async readFile() {
    const input = this.input('config-file'), file = input.files?.[0]; if (!file) return;
    this.pending = null; this.root.querySelector<HTMLElement>('#config-apply-row')!.hidden = true;
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a config smaller than 1 MB.');
      const text = await file.text(); let report: ConfigReport;
      if (file.name.toLowerCase().endsWith('.json')) {
        const profile = JSON.parse(text);
        if (profile?.format !== 'vnl-lj-profile' || profile?.version !== 1 || !profile.settings || typeof profile.settings !== 'object') throw new Error('This is not a supported VNL profile.');
        report = { settings: normalizeSettings({ ...profile.settings, mapId: this.settings.mapId, tickRate: this.settings.tickRate }),
          applied: ['VNL profile: binds, display, viewmodel, crosshair and preferences (current room and tick rate retained)'], ignored: [] };
      } else report = importConfig(text, this.settings);
      this.pending = report.applied.length ? report.settings : null;
      this.root.querySelector('#config-status')!.textContent = `${report.applied.length} supported commands, ${report.ignored.length} skipped. ${this.pending ? 'Review the details, then Apply.' : 'No supported settings found.'}`;
      this.root.querySelector<HTMLElement>('#config-report')!.hidden = false;
      this.root.querySelector('#config-report-text')!.textContent = `Supported:\n${report.applied.join('\n') || 'None'}\n\nSkipped:\n${report.ignored.join('\n') || 'None'}`;
      this.root.querySelector<HTMLElement>('#config-apply-row')!.hidden = !this.pending;
    } catch (error) { this.root.querySelector('#config-status')!.textContent = error instanceof Error ? error.message : 'Could not read this config.'; }
    finally { input.value = ''; }
  }
  private download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
