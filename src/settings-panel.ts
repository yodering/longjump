import { createElement, Plus, X } from 'lucide';
import { actions, assignBinding, normalizeBindings, tokenLabel, validToken, type Action } from './bindings.ts';
import { normalizeSettings, resolutions, speedPlacements, speedSizes, viewPresets, viewRanges, type Settings } from './settings.ts';
import { exportConfig, importConfig, type ConfigReport } from './config.ts';
import { decodeCrosshair, encodeCrosshair } from './crosshair-code.ts';
import { soundTiers } from './sound-tiers.ts';

export const settingsPages = { general: 'General', controls: 'Controls', hud: 'HUD', crosshair: 'Crosshair', viewmodel: 'Viewmodel' } as const;
export type SettingsPage = keyof typeof settingsPages;
const labels = { fov: 'Viewmodel FOV', x: 'Horizontal offset', y: 'Forward offset', z: 'Vertical offset',
  bobLower: 'Running lower', bobLat: 'Side bob', bobVert: 'Vertical bob', bobCycle: 'Bob cycle' };
const crosshairRanges = { size: ['Length', 0, 20, 0.5], gap: ['Gap', -5, 20, 0.5], thickness: ['Thickness', 0.5, 5, 0.5], alpha: ['Opacity', 0, 1, 0.05] } as const;
const crosshairMarkup = '<i></i><i></i><i></i><i></i><b></b>';
const toggles = { 'invert-y': 'invertY', 'auto-bhop': 'autoBhop', 'null-bind': 'nullBind', jumpStats: 'jumpStats', trail: 'trail',
  sound: 'sound', viewmodel: 'viewmodel', leftHand: 'leftHand' } as const;
const hudToggles = { 'hud-takeoff': 'takeoff', 'hud-keys': 'keys', 'hud-pb': 'pb', 'hud-hints': 'hints' } as const;

// Markup helpers: one row per setting, grouped into cards. Notes sit under their label.
const text = (label: string, note?: string, id?: string) => `<span class="setting-text"><span${id ? ` id="${id}-label"` : ''}>${label}</span>${note ? `<small${id ? ` id="${id}-note"` : ''}>${note}</small>` : ''}</span>`;
const toggle = (id: string, label: string, note?: string) => `<label class="setting-row">${text(label, note)}<input id="${id}" class="switch" type="checkbox" role="switch"/></label>`;
const control = (id: string, label: string, input: string, note?: string) => `<div class="setting-row"><label for="${id}" class="setting-text"><span>${label}</span>${note === undefined ? '' : `<small id="${id}-note">${note}</small>`}</label>${input}</div>`;
const choice = (name: string, label: string, options: Record<string, string>, note?: string) => `<div class="setting-row" role="radiogroup" aria-labelledby="${name}-label">${text(label, note, name)}<div class="segmented">${Object.entries(options).map(([value, option]) => `<label><input type="radio" name="${name}" value="${value}"/><span>${option}</span></label>`).join('')}</div></div>`;
const slider = (id: string, label: string, [min, max, step]: readonly number[], data = '') => `<div class="setting-slider"><label for="${id}">${label}</label><output id="${id}-output" for="${id}"></output><input id="${id}" ${data} type="range" min="${min}" max="${max}" step="${step}"/></div>`;
const group = (title: string, body: string, extra = '') => `<section class="settings-group"${extra}><h3>${title}</h3><div class="settings-card">${body}</div></section>`;

export class SettingsPanel {
  private capture: Action | null = null;
  private pending: Settings | null = null;
  page: SettingsPage = 'controls';
  constructor(private root: HTMLElement, private settings: Settings, private changed: () => void, private paged: (page: SettingsPage) => void = () => {}) {
    root.innerHTML = `
      <nav class="settings-nav" aria-label="Settings sections">${Object.entries(settingsPages).map(([id, name]) => `<button data-page="${id}" aria-pressed="false">${name}</button>`).join('')}</nav>
      <div data-settings-page="general">
        ${group('Display', `
          ${choice('appearance', 'Theme', { dark: 'Dark', light: 'Light' })}
          ${control('resolution', 'Render resolution', `<select id="resolution">${Object.entries(resolutions).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select>`, '90° FOV at 4:3, matching CS:GO.')}
          ${choice('scaling', 'Scaling', { stretch: 'Stretched', fit: 'Black bars' })}
          <div class="setting-row">${text('Fullscreen')}<button id="settings-fullscreen" class="settings-button">Toggle</button></div>`)}
        ${group('Audio', `
          ${toggle('sound', 'KZ sounds')}
          ${slider('volume', 'Volume', [0, 1, 0.05])}
          <details class="sound-samples"><summary>Sound samples</summary><div>${soundTiers.map(t => `<button data-sample="${t.name}">${t.label} <small>${t.distance}+</small></button>`).join('')}<button data-sample="checkpoint">Checkpoint beep</button><button data-sample="error">Error beep</button></div><p class="setting-note">Practice long-jump thresholds.</p></details>`)}
        ${group('Import / export', `
          <p class="setting-note">Import your CS:GO .cfg for supported movement binds, sensitivity, viewmodel and static crosshair settings. Other commands are listed and skipped.</p>
          <div class="settings-buttons"><button id="import-config" class="settings-button">Import config / profile</button><button id="export-config" class="settings-button">Export .cfg</button><button id="export-profile" class="settings-button">Export profile</button></div>
          <input id="config-file" type="file" accept=".cfg,.json,.txt" hidden/>
          <p id="config-status" role="status" class="setting-note"></p>
          <details id="config-report" hidden><summary>Import details</summary><pre id="config-report-text"></pre></details>
          <div id="config-apply-row" class="settings-buttons" hidden><button id="config-apply" class="settings-button">Apply imported settings</button><button id="config-cancel" class="settings-button">Cancel</button></div>`, ' id="config-group"')}
      </div>
      <div data-settings-page="controls">
        ${group('Mouse', `
          ${control('sensitivity', 'Sensitivity', '<input id="sensitivity" type="number" min="0.01" max="20" step="0.01" inputmode="decimal"/>', '')}
          ${toggle('invert-y', 'Invert mouse Y')}`)}
        ${group('Movement', `
          ${toggle('auto-bhop', 'Auto bunnyhop', 'Hold jump to hop again on landing.')}
          ${toggle('null-bind', 'Null binds', 'The newest strafe key wins: pressing A while holding D moves left, and releasing A resumes D.')}`)}
        ${group('Binds', `
          <div id="binding-list"></div>
          <p id="binding-status" role="status" class="setting-note">Select + to add a bind, then press a key, mouse button or scroll. Esc cancels.</p>
          <p class="setting-note">LJ bind: jump + duck, release forward/back. Release the bind to stand, then duck again before landing.</p>
          <div class="settings-buttons"><button id="bindings-reset" class="settings-button">Restore default binds</button></div>`)}
      </div>
      <div data-settings-page="hud">
        ${group('Speed', `
          ${choice('hud-speed', 'Position', speedPlacements)}
          ${toggle('hud-takeoff', 'Takeoff speed', 'Shown in parentheses while airborne.')}
          ${choice('hud-decimals', 'Decimals', { 0: '0', 1: '1', 2: '2' })}
          <div id="crosshair-speed-options">
            ${choice('hud-size', 'Size', speedSizes)}
            ${control('hud-color', 'Color', '<input id="hud-color" type="color"/>')}
            ${slider('hud-offset', 'Distance below crosshair', [24, 320, 4])}
          </div>`)}
        ${group('Screen', `
          ${toggle('hud-keys', 'Key display')}
          ${toggle('hud-pb', 'Personal best')}
          ${toggle('hud-hints', 'Control hints', 'Reset, save and return keys in the corner.')}
          ${toggle('jumpStats', 'Jump stats panel')}
          ${toggle('trail', 'Last-jump trail')}`)}
      </div>
      <div data-settings-page="crosshair">
        <div class="crosshair-preview"><div class="cs-crosshair">${crosshairMarkup}</div></div>
        ${group('Share code', `
          <form id="crosshair-code-form" class="history-toolbar">
            <input id="crosshair-code" aria-label="Crosshair share code" placeholder="CSGO-…" autocomplete="off" spellcheck="false" maxlength="40"/>
            <button class="settings-button">Apply</button>
            <button type="button" id="crosshair-code-copy" class="settings-button">Copy mine</button>
          </form>
          <p id="crosshair-code-status" role="status" class="setting-note">Paste a CS:GO crosshair code, or copy yours.</p>`)}
        ${group('Style', `
          ${control('crosshair-color', 'Color', '<input id="crosshair-color" type="color"/>')}
          ${Object.entries(crosshairRanges).map(([id, [label, ...range]]) => slider(`crosshair-${id}`, label, range, `data-crosshair="${id}"`)).join('')}
          ${toggle('crosshair-dot', 'Center dot')}
          ${toggle('crosshair-outline', 'Outline')}`)}
      </div>
      <div data-settings-page="viewmodel">
        ${group('Knife', `
          ${toggle('viewmodel', 'Show viewmodel')}
          ${choice('team', 'Knife', { ct: 'CT default', t: 'T default' })}
          ${toggle('leftHand', 'Left-handed')}`)}
        ${group('Position', `
          ${control('view-preset', 'Preset', '<select id="view-preset"><option value="custom">Custom</option><option value="desktop">Desktop</option><option value="couch">Couch</option><option value="classic">Classic</option></select>')}
          ${Object.entries(viewRanges).map(([id, range]) => slider(`view-${id}`, labels[id as keyof typeof labels], range, `data-view="${id}"`)).join('')}`)}
      </div>
    `;
    root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => button.addEventListener('click', () => {
      this.cancelCapture(); this.page = button.dataset.page as SettingsPage; this.renderPage(); this.paged(this.page);
    }));
    for (const [id, key] of Object.entries(toggles)) this.on(id, 'change', () => { settings[key] = this.input(id).checked; this.commit(); });
    for (const [id, key] of Object.entries(hudToggles)) this.on(id, 'change', () => { settings.hud[key] = this.input(id).checked; this.commit(); });
    root.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(input => input.addEventListener('change', () => {
      const value = input.value;
      if (input.name === 'appearance') settings.appearance = value === 'light' ? 'light' : 'dark';
      if (input.name === 'scaling') settings.scaling = value === 'fit' ? 'fit' : 'stretch';
      if (input.name === 'team') settings.team = value === 't' ? 't' : 'ct';
      if (input.name === 'hud-speed') settings.hud.speed = value as Settings['hud']['speed'];
      if (input.name === 'hud-size') settings.hud.size = value as Settings['hud']['size'];
      if (input.name === 'hud-decimals') settings.hud.decimals = Number(value) as Settings['hud']['decimals'];
      this.commit();
    }));
    this.on('resolution', 'change', () => { settings.resolution = this.input('resolution').value as Settings['resolution']; this.commit(); });
    this.on('sensitivity', 'change', () => {
      const n = Number(this.input('sensitivity').value);
      if (Number.isFinite(n) && n > 0) settings.sensitivity = Math.min(20, Math.max(0.01, n));
      this.commit();
    });
    this.on('volume', 'input', () => { settings.volume = Number(this.input('volume').value); this.commit(); });
    this.on('hud-color', 'input', () => { settings.hud.color = this.input('hud-color').value; this.commit(); });
    this.on('hud-offset', 'input', () => { settings.hud.offset = Number(this.input('hud-offset').value); this.commit(); });
    this.on('bindings-reset', 'click', () => { settings.bindings = normalizeBindings(null); this.capture = null; this.commit(); this.status('Default binds restored.'); });
    this.on('crosshair-code-form', 'submit', () => {
      const crosshair = decodeCrosshair(this.input('crosshair-code').value);
      if (!crosshair) { this.crosshairStatus('That isn’t a CS:GO crosshair code.'); return; }
      settings.crosshair = normalizeSettings({ crosshair }).crosshair; this.input('crosshair-code').value = ''; this.commit();
      this.crosshairStatus('Crosshair applied.');
    });
    this.root.querySelector('#crosshair-code-form')!.addEventListener('submit', event => event.preventDefault());
    this.on('crosshair-code-copy', 'click', () => {
      const code = encodeCrosshair(settings.crosshair);
      void navigator.clipboard.writeText(code).then(() => this.crosshairStatus(`Copied ${code}`), () => this.crosshairStatus(code));
    });
    this.on('settings-fullscreen', 'click', () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => this.status('Fullscreen is unavailable in this browser.')); });
    this.on('view-preset', 'change', () => { const preset = viewPresets[this.input('view-preset').value]; if (preset) { settings.view = { ...preset }; this.commit(); } });
    root.querySelectorAll<HTMLInputElement>('[data-view]').forEach(input => input.addEventListener('input', () => {
      settings.view[input.dataset.view as keyof Settings['view']] = Number(input.value); this.commit();
    }));
    root.querySelectorAll<HTMLInputElement>('[data-crosshair]').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.crosshair as keyof typeof crosshairRanges; settings.crosshair[key] = Number(input.value); this.commit();
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
    this.renderPage(); this.render();
  }
  private input(id: string) { return this.root.querySelector<HTMLInputElement>(`#${id}`)!; }
  private on(id: string, event: string, fn: () => void) { this.root.querySelector(`#${id}`)!.addEventListener(event, fn); }
  private status(text: string) { this.root.querySelector('#binding-status')!.textContent = text; }
  private crosshairStatus(text: string) { this.root.querySelector('#crosshair-code-status')!.textContent = text; }
  private commit() { this.changed(); this.render(); }
  private renderPage() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.page === this.page)));
    this.root.querySelectorAll<HTMLElement>('[data-settings-page]').forEach(page => page.hidden = page.dataset.settingsPage !== this.page);
  }
  private radio(name: string, value: string | number) {
    this.root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach(input => input.checked = input.value === String(value));
  }
  private range(id: string, value: number, shown = String(+value.toFixed(2))) { this.input(id).value = String(value); this.root.querySelector(`#${id}-output`)!.textContent = shown; }
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
    for (const [id, key] of Object.entries(toggles)) this.input(id).checked = s[key];
    for (const [id, key] of Object.entries(hudToggles)) this.input(id).checked = s.hud[key];
    this.radio('appearance', s.appearance); this.radio('scaling', s.scaling); this.radio('team', s.team);
    this.radio('hud-speed', s.hud.speed); this.radio('hud-size', s.hud.size); this.radio('hud-decimals', s.hud.decimals);
    this.input('resolution').value = s.resolution;
    if (document.activeElement !== this.input('sensitivity')) this.input('sensitivity').value = String(s.sensitivity);
    this.root.querySelector('#sensitivity-note')!.textContent = `Sensitivity × ${s.mouseYaw}° horizontally / ${s.mousePitch}° vertically per pixel.`;
    this.range('volume', s.volume, `${Math.round(s.volume * 100)}%`);
    // Options that only shape the readout under the crosshair are disabled when it is not shown there.
    const underCrosshair = s.hud.speed === 'crosshair' || s.hud.speed === 'both';
    this.root.querySelector<HTMLElement>('#crosshair-speed-options')!.querySelectorAll<HTMLInputElement>('input').forEach(input => input.disabled = !underCrosshair);
    this.root.querySelectorAll<HTMLInputElement>('input[name="hud-decimals"], #hud-takeoff').forEach(input => input.disabled = s.hud.speed === 'off');
    this.input('hud-color').value = s.hud.color;
    this.range('hud-offset', s.hud.offset, `${s.hud.offset}px`);
    this.input('view-preset').value = Object.entries(viewPresets).find(([, v]) => Object.keys(viewRanges).every(k => v[k as keyof typeof v] === s.view[k as keyof typeof v]))?.[0] ?? 'custom';
    for (const key of Object.keys(viewRanges) as (keyof Settings['view'])[]) this.range(`view-${key}`, s.view[key]);
    for (const key of Object.keys(crosshairRanges) as (keyof typeof crosshairRanges)[]) this.range(`crosshair-${key}`, s.crosshair[key]);
    this.input('crosshair-color').value = s.crosshair.color;
    for (const key of ['dot', 'outline'] as const) this.input(`crosshair-${key}`).checked = s.crosshair[key];
    const style = document.documentElement.style;
    for (const key of ['size', 'gap', 'thickness'] as const) style.setProperty(`--crosshair-${key}`, `${s.crosshair[key]}px`);
    style.setProperty('--crosshair-color', s.crosshair.color); style.setProperty('--crosshair-alpha', String(s.crosshair.alpha));
    style.setProperty('--crosshair-outline', s.crosshair.outline ? '0 0 0 1px #000' : 'none');
    style.setProperty('--crosshair-dot', s.crosshair.dot ? 'block' : 'none');
    style.setProperty('--hud-speed-size', `var(--size-${{ s: 'm', m: 'l', l: 'xl' }[s.hud.size]})`);
    style.setProperty('--hud-speed-color', s.hud.color); style.setProperty('--hud-speed-offset', `${s.hud.offset}px`);
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
          applied: ['VNL profile: binds, display, viewmodel, crosshair, HUD and preferences (current room and tick rate retained)'], ignored: [] };
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
