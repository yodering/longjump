import { readHistory, type Entry } from './history';

export type SavedEntry = Entry & { id: string };
export type HistoryQuery = { map: string; tick: string; status: string; order: 'at' | 'distance'; search: string; page: number };
export const PAGE_SIZE = 10;
export function matchesHistory(entry: Entry, query: HistoryQuery) {
  return (query.map === 'all' || entry.mapId === query.map)
    && (query.tick === 'all' || String(entry.tickRate) === query.tick)
    && (query.status === 'all' || entry.valid === (query.status === 'valid'))
    && `${entry.mapId ?? 'Older map'} ${entry.distance.toFixed(2)} ${entry.ljBind ? 'LJ bind' : ''}`.toLowerCase().includes(query.search.trim().toLowerCase());
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('History transaction failed'));
  });
}

// One asynchronous write per attempt. History pages read only the rows they need.
export class HistoryArchive {
  private database: Promise<IDBDatabase | null>;
  private writes: Promise<void> = Promise.resolve();
  private memory: SavedEntry[];
  durable = true;
  constructor(legacy: Entry[], factory: IDBFactory | undefined = globalThis.indexedDB, name = 'longjump-history') {
    this.memory = readHistory(legacy).map((entry, index) => ({ ...entry, at: Number.isFinite(entry.at) ? entry.at : 0, id: `legacy-${index}` }));
    this.database = this.open(factory, name, this.memory.slice()).catch(() => { this.durable = false; return null; });
  }
  private async open(factory: IDBFactory | undefined, name: string, legacy: SavedEntry[]) {
    if (!factory) throw new Error('History storage unavailable');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('attempts', { keyPath: 'id' });
        store.createIndex('at', 'at'); store.createIndex('distance', 'distance');
        request.result.createObjectStore('meta');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('History upgrade blocked')); };
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
    db.onversionchange = () => db.close();
    const transaction = db.transaction(['attempts', 'meta'], 'readwrite');
    const done = completed(transaction);
    const marker = transaction.objectStore('meta').get('legacy-imported');
    marker.onsuccess = () => {
      if (marker.result) return;
      for (const entry of legacy) transaction.objectStore('attempts').put(entry);
      transaction.objectStore('meta').put(true, 'legacy-imported');
    };
    try { await done; } catch (error) { db.close(); throw error; }
    return db;
  }
  async ready() { await this.database; return this.durable; }
  append(entry: Entry) {
    const saved = { ...entry, id: crypto.randomUUID() };
    this.memory.unshift(saved);
    this.writes = this.writes.then(async () => {
      const db = await this.database;
      if (!db || !this.durable) return;
      const transaction = db.transaction('attempts', 'readwrite');
      const done = completed(transaction);
      transaction.objectStore('attempts').add(saved); await done;
    }).catch(() => { this.durable = false; });
    return this.writes;
  }
  async page(query: HistoryQuery): Promise<{ entries: SavedEntry[]; more: boolean; total: number }> {
    await this.writes;
    const db = await this.database;
    if (!db || !this.durable) {
      const matching = this.memory.filter(entry => matchesHistory(entry, query)).sort((a, b) => b[query.order] - a[query.order]);
      const offset = query.page * PAGE_SIZE;
      return { entries: matching.slice(offset, offset + PAGE_SIZE), more: matching.length > offset + PAGE_SIZE, total: this.memory.length };
    }
    try {
      const transaction = db.transaction('attempts', 'readonly');
      const store = transaction.objectStore('attempts');
      const count = store.count();
      let total = 0; count.onsuccess = () => { total = count.result; };
      const entries: SavedEntry[] = []; let skipped = 0, more = false;
      const cursor = store.index(query.order).openCursor(null, 'prev');
      const done = completed(transaction);
      cursor.onsuccess = () => {
        const current = cursor.result; if (!current) return;
        if (matchesHistory(current.value, query)) {
          if (skipped++ >= query.page * PAGE_SIZE) {
            if (entries.length === PAGE_SIZE) { more = true; return; }
            entries.push(current.value);
          }
        }
        current.continue();
      };
      await done; return { entries, more, total };
    } catch { this.durable = false; return this.page(query); }
  }
  async export() {
    await this.writes; const db = await this.database;
    if (!db || !this.durable) return this.memory;
    const transaction = db.transaction('attempts', 'readonly');
    const done = completed(transaction);
    const request = transaction.objectStore('attempts').getAll();
    await done; return request.result as SavedEntry[];
  }
  async close() { await this.writes; (await this.database)?.close(); }
}
