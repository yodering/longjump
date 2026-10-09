import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { HistoryArchive, type HistoryQuery } from '../src/history-archive';
import type { Entry } from '../src/history';

const entry = (index: number): Entry => ({ distance: 220 + index, at: index, sync: 80, tickRate: index % 2 ? 64 : 128,
  valid: index % 3 === 0, landed: true, mapId: 'longjump_source_go', autoBhop: false, strafes: [], path: [],
} as unknown as Entry);
const all: HistoryQuery = { map: 'all', tick: 'all', status: 'all', order: 'at', search: '', page: 0 };

test('Archive migrates once, retains over 100 attempts, and persists across reloads', async () => {
  const factory = new IDBFactory();
  const legacy = Array.from({ length: 100 }, (_, index) => entry(index));
  const archive = new HistoryArchive(legacy, factory);
  // A jump before the migration finishes must not be imported a second time.
  await archive.append(entry(100));
  for (let index = 101; index < 125; index++) await archive.append(entry(index));
  const first = await archive.page(all);
  assert.equal(first.total, 125); assert.equal(first.entries.length, 10); assert.equal(first.entries[0].at, 124); assert.equal(first.more, true);
  const last = await archive.page({ ...all, page: 12 });
  assert.equal(last.entries.length, 5); assert.equal(last.more, false);
  assert.equal((await archive.export()).length, 125);
  await archive.close();
  const reloaded = new HistoryArchive(legacy, factory);
  assert.equal((await reloaded.page(all)).total, 125);
  await reloaded.close();
});
test('Archive filters and orders pages without overlap, including distance and map search', async () => {
  const archive = new HistoryArchive(Array.from({ length: 40 }, (_, index) => entry(index)), new IDBFactory());
  const first = await archive.page(all), second = await archive.page({ ...all, page: 1 });
  assert.equal(new Set([...first.entries, ...second.entries].map(j => j.id)).size, 20);
  const valid = await archive.page({ ...all, status: 'valid', tick: '64', order: 'distance' });
  assert.equal(valid.entries[0].distance, 259);
  assert.ok(valid.entries.every(j => j.valid && j.tickRate === 64));
  assert.equal((await archive.page({ ...all, map: 'kz_longjumps_go' })).entries.length, 0);
  assert.equal((await archive.page({ ...all, search: '259.00' })).entries[0].at, 39);
  await archive.close();
});
test('Storage failure keeps attempts in memory and reports that they are not durable', async () => {
  const archive = new HistoryArchive([entry(1)], new IDBFactory());
  await archive.ready(); await archive.close();
  await archive.append(entry(2));
  assert.equal(archive.durable, false);
  const page = await archive.page(all);
  assert.equal(page.total, 2); assert.equal(page.entries[0].at, 2);
  assert.equal((await archive.export()).length, 2);
});
