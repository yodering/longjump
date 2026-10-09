import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { HistoryArchive, type SavedEntry } from '../src/history-archive';
import { parseBackup, checkpointForMap, fingerprint, type Backup } from '../src/backup';
import { defaults } from '../src/settings';
import { Movement } from '../src/physics';

const entry = (id = crypto.randomUUID(), distance = 240): SavedEntry => ({ id, mapId: 'longjump_source_go', tickRate: 128,
  autoBhop: false, ljBind: false, distance, gap: 240, at: 1000, sync: 80, preSpeed: 250, maxSpeed: 310,
  duration: 0.8, ticks: 100, height: 55, overlap: 0, deadAir: 2, width: 18, edge: 0, valid: true,
  landed: true, ducked: true, reason: 'Long jump', path: [{ x: 1, y: 2, z: 3 }], strafes: [],
});
const backup = (attempts = [entry()]): Backup => ({ version: 2, sourceId: crypto.randomUUID(), exportedAt: new Date().toISOString(),
  attempts, bests: attempts.slice(0, 1), preferences: structuredClone(defaults), checkpoints: [] });

test('Version-2 backups restore 10,000 attempts idempotently and preserve standalone bests on reload', async () => {
  const source = backup(Array.from({ length: 10_000 }, () => entry()));
  source.bests.push(entry(crypto.randomUUID(), 250));
  const parsed = await parseBackup(JSON.stringify(source));
  assert.equal(parsed.attempts.length, 10_000); assert.equal(parsed.bests[0].distance, 250);
  assert.deepEqual(parsed.preferences, defaults);
  const factory = new IDBFactory();
  const archive = new HistoryArchive([], factory);
  assert.deepEqual(await archive.importPreview(parsed.attempts), { added: 10_000, duplicates: 0 });
  assert.equal(await archive.merge(parsed.attempts, parsed.bests), 10_000);
  assert.deepEqual(await archive.importPreview(parsed.attempts), { added: 0, duplicates: 10_000 });
  assert.equal(await archive.merge(parsed.attempts, parsed.bests), 0);
  const exported = await archive.export(); assert.equal(exported.length, 10_000);
  const id = archive.sourceId; await archive.close();
  const reloaded = new HistoryArchive([], factory);
  assert.equal((await reloaded.export()).length, 10_000); assert.equal(reloaded.sourceId, id);
  assert.equal((await reloaded.bests())[0].distance, 250); await reloaded.close();
});
test('Version-1 files gain repeatable IDs without collapsing equal-looking attempts', async () => {
  const a = { ...entry(), id: 'legacy-0' }, b = { ...a, id: 'legacy-1' };
  const text = JSON.stringify({ version: 1, attempts: [a, b], bests: [a] });
  const first = await parseBackup(text), second = await parseBackup(text);
  assert.equal(first.attempts[0].id, second.attempts[0].id);
  assert.notEqual(first.attempts[0].id, first.attempts[1].id);
  const uuid = entry();
  assert.equal((await parseBackup(JSON.stringify({ version: 1, attempts: [uuid] }))).attempts[0].id, uuid.id);
});
test('Retired Concrete attempts remain portable without becoming current-map bests', async () => {
  const retired = { ...entry(), mapId: 'concrete' as const };
  const parsed = await parseBackup(JSON.stringify({ ...backup(), attempts: [retired], bests: [retired] }));
  assert.equal(parsed.attempts[0].mapId, 'concrete'); assert.equal(parsed.bests.length, 0);
});
test('Separate browsers namespace their legacy records and merge both copies', async () => {
  const a = new HistoryArchive([entry()], new IDBFactory()), b = new HistoryArchive([entry()], new IDBFactory());
  const first = await a.export(), second = await b.export();
  assert.notEqual(first[0].id, second[0].id);
  assert.equal(await a.merge(second, []), 1); assert.equal((await a.export()).length, 2);
  await a.close(); await b.close();
});
test('Existing IndexedDB legacy IDs migrate once and keep the same namespace after reload', async () => {
  const factory = new IDBFactory();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('old-history', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('attempts', { keyPath: 'id' });
      store.createIndex('at', 'at'); store.createIndex('distance', 'distance'); request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['attempts', 'meta'], 'readwrite');
    tx.objectStore('attempts').add({ ...entry(), id: 'legacy-0' }); tx.objectStore('meta').put(true, 'legacy-imported');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
  const archive = new HistoryArchive([], factory, 'old-history'), original = await archive.export();
  assert.equal(original[0].id, `legacy:${archive.sourceId}:0`); await archive.close();
  const reloaded = new HistoryArchive([], factory, 'old-history');
  assert.deepEqual(await reloaded.export(), original); await reloaded.close();
});
test('Conflicting IDs abort every attempt and best write in the import transaction', async () => {
  const original = entry(); const archive = new HistoryArchive([], new IDBFactory());
  await archive.merge([original], [original]);
  const conflicting = { ...original, distance: 290 };
  await assert.rejects(archive.importPreview([conflicting]), /conflicts/);
  await assert.rejects(archive.merge([entry(), conflicting], [conflicting]), /conflicts/);
  assert.equal((await archive.export()).length, 1); assert.equal((await archive.bests())[0].distance, 240);
  await archive.append(entry()); assert.equal((await archive.export()).length, 2); await archive.close();
});
test('Malformed, excessive and unsupported records fail validation before storage', async () => {
  const good = backup();
  for (const bad of [
    { ...good, version: 99 }, { ...good, attempts: [...good.attempts, ...good.attempts] },
    { ...good, attempts: [{ ...entry(), sync: 101 }] }, { ...good, attempts: [{ ...entry(), distance: '240' }] },
    { ...good, attempts: [{ ...entry(), path: [{ x: 1 }] }] }, { ...good, preferences: [] },
    { ...good, attempts: [{ ...entry(), strafes: Array.from({ length: 257 }, () => ({})) }] },
    { ...good, attempts: [{ ...entry(), mapId: '<script>' }] },
  ]) await assert.rejects(parseBackup(JSON.stringify(bad)));
  await assert.rejects(parseBackup('{'), /valid longjump/);
  await assert.rejects(parseBackup(JSON.stringify({ ...good, attempts: [{ ...entry(), distance: Infinity }] })));
});
test('Saved positions only restore against matching map geometry with safe standing support', async () => {
  const m = new Movement(); const version = await fingerprint('map');
  const positions = [{ mapId: 'longjump_source_go' as const, mapContentVersion: version,
    position: { ...m.position }, yaw: 0.2, pitch: 0 }];
  const parsed = await parseBackup(JSON.stringify({ ...backup(), checkpoints: positions }));
  assert.ok(checkpointForMap(parsed.checkpoints, 'longjump_source_go', version, m));
  assert.equal(checkpointForMap(parsed.checkpoints, 'longjump_source_go', 'changed', m), null);
  positions[0].position.z = 100;
  assert.equal(checkpointForMap(positions, 'longjump_source_go', version, m), null);
  positions[0].position.z = -5;
  assert.equal(checkpointForMap(positions, 'longjump_source_go', version, m), null);
});
test('Import refuses unavailable storage instead of claiming a durable save', async () => {
  const archive = new HistoryArchive([], undefined);
  await assert.rejects(archive.merge([entry()], []), /unavailable/);
  assert.equal((await archive.export()).length, 0);
});
