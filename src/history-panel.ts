import { maps } from './maps';
import { HistoryArchive, type HistoryQuery, type SavedEntry } from './history-archive';

const date = (at: number) => at ? new Date(at).toLocaleString() : 'Earlier session';
const mode = (entry: SavedEntry) => entry.autoBhop === undefined ? 'Legacy' : entry.autoBhop ? 'Auto-hop' : 'Manual';

export class HistoryPanel {
  private page = 0;
  private revision = 0;
  private searchTimer = 0;
  constructor(private root: HTMLElement, private archive: HistoryArchive, private onCount: (count: number) => void, private records: () => unknown) {
    root.innerHTML = `<div class="history-filters">
      <input type="search" data-history="search" aria-label="Search jump history" placeholder="Search map or distance"/>
      <select data-history="map" aria-label="History map"><option value="all">All maps</option>${maps.map(map => `<option value="${map.id}">${map.name}</option>`).join('')}</select>
      <select data-history="tick" aria-label="History tick rate"><option value="all">All tick rates</option><option value="64">64 tick</option><option value="128">128 tick</option></select>
      <select data-history="status" aria-label="History result"><option value="all">All attempts</option><option value="valid">Valid jumps</option><option value="miss">Misses / invalid</option></select>
      <select data-history="order" aria-label="History order"><option value="at">Newest first</option><option value="distance">Longest first</option></select>
    </div><div data-history="entries"></div>
    <div class="history-pages"><button class="settings-button" data-history="previous">Previous</button><span data-history="page"></span><button class="settings-button" data-history="next">Next</button></div>
    <button class="settings-button" data-history="export">Export history</button><p class="setting-note" data-history="storage">Saved in this browser. Export a backup before clearing site data.</p>`;
    root.querySelectorAll('select').forEach(select => select.addEventListener('change', () => { this.page = 0; void this.refresh(); }));
    this.element<HTMLInputElement>('search').addEventListener('input', () => {
      clearTimeout(this.searchTimer); this.searchTimer = window.setTimeout(() => { this.page = 0; void this.refresh(); }, 150);
    });
    this.element('previous').addEventListener('click', () => { this.page = Math.max(0, this.page - 1); void this.refresh(); });
    this.element('next').addEventListener('click', () => { this.page++; void this.refresh(); });
    this.element<HTMLButtonElement>('export').addEventListener('click', () => void this.export());
    void archive.ready().then(() => this.refresh());
  }
  private element<T extends HTMLElement = HTMLElement>(name: string) { return this.root.querySelector<T>(`[data-history="${name}"]`)!; }
  async refresh() {
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
    this.element('entries').innerHTML = result.entries.length ? result.entries.map(entry => this.row(entry)).join('') : '<p class="setting-note">No matching attempts.</p>';
    this.element('page').textContent = `Page ${this.page + 1}`;
    this.element<HTMLButtonElement>('previous').disabled = !this.page;
    this.element<HTMLButtonElement>('next').disabled = !result.more;
    this.storageNote();
  }
  private row(entry: SavedEntry) {
    const map = maps.find(map => map.id === entry.mapId)?.name ?? 'Older map';
    const number = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
    return `<details class="history-attempt"><summary><span><b class="${entry.valid ? '' : 'failed'}">${entry.distance.toFixed(2)}</b><small>${map} · ${entry.tickRate}T · ${entry.valid ? 'Landed' : 'Miss / invalid'} · ${mode(entry)}</small></span><span>${entry.sync.toFixed(0)}% sync</span></summary>
      <div class="history-detail"><p>${map}<br/>${date(entry.at)}</p><div class="jump-metrics"><div><span>PRE SPEED</span><b>${number(entry.preSpeed)}</b></div><div><span>MAX SPEED</span><b>${number(entry.maxSpeed)}</b></div><div><span>STRAFES</span><b>${entry.strafes.length}</b></div><div><span>AIRTIME</span><b>${number(entry.duration, 3)}s</b></div></div></div></details>`;
  }
  private storageNote() {
    this.element('storage').textContent = this.archive.durable ? 'Saved in this browser. Export a backup before clearing site data.' : 'Storage unavailable. New attempts are kept for this session only. Export to save them.';
  }
  private async export() {
    const button = this.element<HTMLButtonElement>('export'); button.disabled = true;
    try {
      const attempts = await this.archive.export();
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, attempts, bests: this.records() })], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `longjump-history-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { this.element('storage').textContent = 'Export failed. Try again before closing this tab.'; }
    finally { button.disabled = false; }
  }
}
