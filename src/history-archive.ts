import { readHistory, readBests, type Entry } from './history';
import { equivalentAttempt } from './backup';

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
  sourceId = crypto.randomUUID() as string;
  constructor(legacy: Entry[], factory: IDBFactory | undefined = globalThis.indexedDB, name = 'longjump-history') {
    this.memory = readHistory(legacy).map((entry, index) => ({ ...entry, at: Number.isFinite(entry.at) ? entry.at : 0, id: `legacy:${this.sourceId}:${index}` }));
    this.database = this.open(factory, name, this.memory.slice()).catch(() => { this.durable = false; return null; });
  }
  private async open(factory: IDBFactory | undefined, name: string, legacy: SavedEntry[]) {
    if (!factory) throw new Error('History storage unavailable');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      // Version 2 briefly added a cloud-sync outbox. Keep the number so those
      // databases still open; new databases need only these two stores.
      const request = factory.open(name, 2);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('attempts')) {
          const store = request.result.createObjectStore('attempts', { keyPath: 'id' });
          store.createIndex('at', 'at'); store.createIndex('distance', 'distance');
          request.result.createObjectStore('meta');
        }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('History upgrade blocked')); };
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
    db.onversionchange = () => db.close();
    const transaction = db.transaction(['attempts', 'meta'], 'readwrite');
    const done = completed(transaction);
    const source = transaction.objectStore('meta').get('source-id');
    source.onsuccess = () => {
      this.sourceId = source.result ?? this.sourceId;
      transaction.objectStore('meta').put(this.sourceId, 'source-id');
      for (const entry of legacy) entry.id = `legacy:${this.sourceId}:${entry.id.split(':').at(-1)}`;
      const migrated = transaction.objectStore('meta').get('portable-ids');
      migrated.onsuccess = () => {
        if (migrated.result) return;
        const request = transaction.objectStore('attempts').getAll();
        request.onsuccess = () => {
          for (const entry of request.result as SavedEntry[]) if (/^legacy-\d+$/.test(entry.id)) {
            transaction.objectStore('attempts').delete(entry.id);
            entry.id = `legacy:${this.sourceId}:${entry.id.slice(7)}`;
            transaction.objectStore('attempts').add(entry);
          }
          transaction.objectStore('meta').put(true, 'portable-ids');
        };
      };
    };
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
  async bests(): Promise<Entry[]> {
    await this.writes;
    const db = await this.database; if (!db || !this.durable) return [];
    const transaction = db.transaction('meta', 'readonly'), done = completed(transaction);
    const request = transaction.objectStore('meta').get('bests');
    await done; return readHistory(request.result);
  }
  async importPreview(entries: SavedEntry[]) {
    const existing = new Map((await this.export()).map(entry => [entry.id, entry]));
    let duplicates = 0;
    for (const entry of entries) {
      const old = existing.get(entry.id);
      if (!old) continue;
      if (!equivalentAttempt(old, entry)) throw new Error('An attempt ID conflicts with different saved data. Nothing was imported.');
      duplicates++;
    }
    return { added: entries.length - duplicates, duplicates };
  }
  merge(entries: SavedEntry[], bests: Entry[]) {
    const operation = this.writes.then(async () => {
      const db = await this.database;
      if (!db || !this.durable) throw new Error('Browser storage is unavailable. No backup was imported.');
      const transaction = db.transaction(['attempts', 'meta'], 'readwrite');
      const done = completed(transaction), store = transaction.objectStore('attempts');
      let added = 0, conflict = false;
      for (const entry of entries) {
        const request = store.get(entry.id);
        request.onsuccess = () => {
          try {
            if (!request.result) { store.add(entry); added++; }
            else if (!equivalentAttempt(request.result, entry)) { conflict = true; transaction.abort(); }
          } catch { conflict = true; transaction.abort(); }
        };
      }
      const meta = transaction.objectStore('meta'), previous = meta.get('bests');
      previous.onsuccess = () => meta.put(readBests([...readHistory(previous.result), ...bests], entries), 'bests');
      try { await done; } catch (error) {
        if (conflict) throw new Error('An attempt ID conflicts with saved data. Nothing was imported.');
        throw error;
      }
      const ids = new Set(this.memory.map(entry => entry.id));
      for (const entry of entries) if (!ids.has(entry.id)) this.memory.push(entry);
      return added;
    });
    // A rejected import must not poison later ordinary writes.
    this.writes = operation.then(() => undefined, () => undefined);
    return operation;
  }
  append(entry: Entry, bests?: Entry[]) {
    const saved = { ...entry, id: crypto.randomUUID() };
    this.memory.unshift(saved);
    this.writes = this.writes.then(async () => {
      const db = await this.database;
      if (!db || !this.durable) return;
      const transaction = db.transaction(['attempts', 'meta'], 'readwrite');
      const done = completed(transaction);
      transaction.objectStore('attempts').add(saved);
      const meta = transaction.objectStore('meta'), previous = meta.get('bests');
      previous.onsuccess = () => meta.put(readBests([...readHistory(previous.result), ...(bests ?? [])], [entry]), 'bests');
      await done;
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
