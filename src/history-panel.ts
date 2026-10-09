import { maps } from './maps';
import { HistoryArchive, type HistoryQuery, type SavedEntry } from './history-archive';
import { parseBackup, MAX_BACKUP_BYTES, type Backup, type SavedPosition } from './backup';
import { readBests, type Entry } from './history';
import type { Settings } from './settings';

type BackupOptions = { preferences: () => Settings; checkpoints: () => SavedPosition[];
  apply: (preferences: Settings | undefined, checkpoints: SavedPosition[] | undefined, display: boolean) => string | void;
  bests: (bests: Entry[]) => void };

const date = (at: number) => at ? new Date(at).toLocaleString() : 'Earlier session';
const mode = (entry: SavedEntry) => entry.autoBhop === undefined ? 'Legacy' : entry.autoBhop ? 'Auto-hop' : 'Manual';

export class HistoryPanel {
  private active = true;
  private page = 0;
  private revision = 0;
  private searchTimer = 0;
  private pending: Backup | null = null;
  constructor(private root: HTMLElement, private archive: HistoryArchive, private onCount: (count: number) => void,
    private records: () => Entry[], private backup: BackupOptions) {
    root.innerHTML = `<div class="history-toolbar">
      <input type="search" data-history="search" aria-label="Search jump history" placeholder="Search map or distance"/>
      <button class="settings-button" data-history="filters-toggle" aria-expanded="false" aria-controls="history-filters">Filters</button>
      <button class="settings-button" data-history="backup-toggle" aria-expanded="false" aria-controls="history-backup">Backups</button>
    </div><div id="history-filters" class="history-filters" data-history="filters" hidden>
      <select data-history="map" aria-label="History map"><option value="all">All maps</option>${maps.map(map => `<option value="${map.id}">${map.name}</option>`).join('')}</select>
      <select data-history="tick" aria-label="History tick rate"><option value="all">All tick rates</option><option value="64">64 tick</option><option value="128">128 tick</option></select>
      <select data-history="status" aria-label="History result"><option value="all">All attempts</option><option value="valid">Valid jumps</option><option value="miss">Misses / invalid</option></select>
      <select data-history="order" aria-label="History order"><option value="at">Newest first</option><option value="distance">Longest first</option></select>
      <button class="settings-button" data-history="clear-filters" disabled>Clear filters</button>
    </div><div id="history-backup" class="history-backup" data-history="backup" hidden>
    <div class="settings-buttons"><button class="settings-button" data-history="export">Export backup</button><button class="settings-button" data-history="import">Import backup</button></div>
    <input type="file" accept=".json,application/json" data-history="file" hidden/>
    <div data-history="preview" hidden><p class="setting-note" data-history="summary"></p>
      <label class="toggle-row">Apply preferences <input type="checkbox" data-history="preferences"/></label>
      <label class="toggle-row">Include display settings <input type="checkbox" data-history="display" disabled/></label>
      <label class="toggle-row">Restore saved positions <input type="checkbox" data-history="checkpoints"/></label>
      <div class="settings-buttons"><button class="settings-button" data-history="confirm">Merge backup</button><button class="settings-button" data-history="cancel">Cancel</button></div>
    </div><p class="setting-note" data-history="transfer" role="status" aria-live="polite"></p>
    <p class="setting-note">Export a backup before clearing site data.</p></div>
    <p class="setting-note" data-history="storage" role="status" hidden></p>
    <div data-history="entries"></div>
    <div class="history-pages" data-history="pages"><button class="settings-button" data-history="previous">Previous</button><span data-history="page"></span><button class="settings-button" data-history="next">Next</button></div>`;
    for (const name of ['filters', 'backup']) this.element(`${name}-toggle`).addEventListener('click', () => {
      const panel = this.element(name); panel.hidden = !panel.hidden;
      this.element(`${name}-toggle`).setAttribute('aria-expanded', String(!panel.hidden));
    });
    this.element('clear-filters').addEventListener('click', () => {
      for (const name of ['map', 'tick', 'status', 'order']) this.element<HTMLSelectElement>(name).selectedIndex = 0;
      this.page = 0; void this.refresh();
    });
    root.querySelectorAll('select').forEach(select => select.addEventListener('change', () => { this.page = 0; void this.refresh(); }));
    this.element<HTMLInputElement>('search').addEventListener('input', () => {
      clearTimeout(this.searchTimer); this.searchTimer = window.setTimeout(() => { this.page = 0; void this.refresh(); }, 150);
    });
    this.element('previous').addEventListener('click', () => { this.page = Math.max(0, this.page - 1); void this.refresh(); });
    this.element('next').addEventListener('click', () => { this.page++; void this.refresh(); });
    this.element<HTMLButtonElement>('export').addEventListener('click', () => void this.export());
    this.element('import').addEventListener('click', () => this.element<HTMLInputElement>('file').click());
    this.element<HTMLInputElement>('file').addEventListener('change', () => void this.previewImport());
    this.element('confirm').addEventListener('click', () => void this.import());
    this.element('cancel').addEventListener('click', () => this.cancelImport());
    this.element<HTMLInputElement>('preferences').addEventListener('change', () => {
      const enabled = this.element<HTMLInputElement>('preferences').checked;
      this.element<HTMLInputElement>('display').disabled = !enabled;
      if (!enabled) this.element<HTMLInputElement>('display').checked = false;
    });
    void archive.ready().then(() => this.refresh());
  }
  private element<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-history="${name}"]`)!; }
  destroy() { this.active = false; this.revision++; clearTimeout(this.searchTimer); }
  async refresh() {
    if (!this.active) return;
    const revision = ++this.revision;
    const query: HistoryQuery = {
      map: this.element<HTMLSelectElement>('map').value, tick: this.element<HTMLSelectElement>('tick').value,
      status: this.element<HTMLSelectElement>('status').value, order: this.element<HTMLSelectElement>('order').value as HistoryQuery['order'],
      search: this.element<HTMLInputElement>('search').value, page: this.page,
    };
    this.element<HTMLButtonElement>('previous').disabled = true; this.element<HTMLButtonElement>('next').disabled = true;
    const result = await this.archive.page(query);
    if (revision !== this.revision) return;
    this.onCount(result.total);
    let previous = '';
    this.element('entries').innerHTML = result.entries.length ? result.entries.map(entry => {
      const context = `${this.mapName(entry)} · ${entry.tickRate} tick · ${mode(entry)}`;
      const heading = context !== previous ? `<p class="history-group-label">${context}</p>` : '';
      previous = context; return heading + this.row(entry);
    }).join('') : `<p class="setting-note">${result.total ? 'No matching attempts.' : 'No jumps recorded yet.'}</p>`;
    this.element('page').textContent = `Page ${this.page + 1}`;
    this.element<HTMLButtonElement>('previous').disabled = !this.page;
    this.element<HTMLButtonElement>('next').disabled = !result.more;
    this.element('pages').hidden = !this.page && !result.more;
    const active = ['map', 'tick', 'status', 'order'].filter(name => this.element<HTMLSelectElement>(name).selectedIndex !== 0).length;
    this.element('filters-toggle').textContent = active ? `Filters · ${active}` : 'Filters';
    this.element<HTMLButtonElement>('clear-filters').disabled = !active;
    this.storageNote();
  }
  private mapName(entry: SavedEntry) { return maps.find(map => map.id === entry.mapId)?.name ?? (entry.mapId === 'concrete' ? 'Concrete (retired)' : 'Older map'); }
  private row(entry: SavedEntry) {
    const number = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
    return `<details class="history-attempt"><summary><span><b class="${entry.valid ? '' : 'failed'}">${entry.distance.toFixed(2)}</b>${entry.valid ? '' : '<small>Miss / invalid</small>'}</span><span>${entry.strafes.length} strafes · ${entry.sync.toFixed(0)}% sync</span></summary>
      <div class="history-detail"><p>${date(entry.at)}</p><div class="jump-metrics"><div><span>PRE SPEED</span><b>${number(entry.preSpeed)}</b></div><div><span>MAX SPEED</span><b>${number(entry.maxSpeed)}</b></div><div><span>STRAFES</span><b>${entry.strafes.length}</b></div><div><span>AIRTIME</span><b>${number(entry.duration, 3)}s</b></div></div></div></details>`;
  }
  private storageNote() {
    this.element('storage').hidden = this.archive.durable;
    this.element('storage').textContent = this.archive.durable ? '' : 'Storage unavailable. New attempts are kept for this session only. Export to save them.';
  }
  async export() {
    const button = this.element<HTMLButtonElement>('export'); button.disabled = true;
    try {
      const attempts = await this.archive.export();
      if (!this.active) return;
      const backup: Backup = { version: 2, sourceId: this.archive.sourceId, exportedAt: new Date().toISOString(),
        attempts, bests: this.records(), preferences: this.backup.preferences(), checkpoints: this.backup.checkpoints() };
      const file = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      if (file.size > MAX_BACKUP_BYTES || attempts.length > 100_000) throw new Error('This archive exceeds the supported backup size. No file was exported.');
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = `longjump-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (this.active) this.element('transfer').textContent = error instanceof Error ? error.message : 'Export failed. Try again before closing this tab.'; }
    finally { button.disabled = false; }
  }
  private cancelImport() {
    this.pending = null; this.element('preview').hidden = true;
    this.element<HTMLInputElement>('file').value = '';
  }
  private busy(value: boolean) {
    if (!this.active) return;
    for (const name of ['import', 'export', 'confirm', 'cancel']) this.element<HTMLButtonElement>(name).disabled = value;
  }
  private async previewImport() {
    const file = this.element<HTMLInputElement>('file').files?.[0]; if (!file) return;
    this.cancelImport(); this.busy(true); this.element('transfer').textContent = 'Checking backup…';
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 128 MB limit.');
      const backup = await parseBackup(await file.text());
      const counts = await this.archive.importPreview(backup.attempts);
      if (!this.active) return;
      this.pending = backup;
      this.element('summary').textContent = `${counts.added.toLocaleString()} new attempts, ${counts.duplicates.toLocaleString()} duplicates. Personal bests will merge. Current map and tick rate stay selected.`;
      for (const [name, available] of [['preferences', !!backup.preferences], ['checkpoints', !!backup.checkpoints.length]] as const) {
        this.element<HTMLInputElement>(name).disabled = !available; this.element<HTMLInputElement>(name).checked = false;
      }
      this.element<HTMLInputElement>('display').checked = false; this.element<HTMLInputElement>('display').disabled = true;
      this.element('preview').hidden = false; this.element('transfer').textContent = '';
    } catch (error) { if (this.active) this.element('transfer').textContent = error instanceof Error ? error.message : 'Could not read this backup.'; }
    finally { this.busy(false); }
  }
  private async import() {
    if (!this.pending) return;
    const backup = this.pending; this.busy(true); this.element('transfer').textContent = 'Saving backup…';
    try {
      const records = readBests([...this.records(), ...backup.bests], backup.attempts);
      const added = await this.archive.merge(backup.attempts, records);
      if (!this.active) return;
      this.backup.bests(records);
      const note = this.backup.apply(this.element<HTMLInputElement>('preferences').checked ? backup.preferences : undefined,
        this.element<HTMLInputElement>('checkpoints').checked ? backup.checkpoints : undefined, this.element<HTMLInputElement>('display').checked);
      this.cancelImport(); this.page = 0; await this.refresh();
      this.element('transfer').textContent = `${added.toLocaleString()} attempts imported. Bests merged.${note ? ` ${note}` : ''}`;
    } catch (error) { if (this.active) this.element('transfer').textContent = error instanceof Error ? error.message : 'Import failed. Your existing history was kept.'; }
    finally { this.busy(false); }
  }
}
