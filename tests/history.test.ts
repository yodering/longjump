import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistory, readBests, saveBest, type Entry } from '../src/history.ts';

test('Malformed and incomplete saved history cannot break startup', () => {
  const record = { distance: 246, sync: 85, tickRate: 128, valid: true, strafes: [] };
  assert.deepEqual(readHistory(null), []);
  assert.deepEqual(readHistory({}), []);
  assert.deepEqual(readHistory([null, 7, {}, { ...record, sync: undefined },
    { ...record, strafes: null }, { ...record, tickRate: 100 }, record]), [record]);
  assert.equal(readHistory(Array.from({ length: 120 }, () => record)).length, 100);
});

const entry = (changes: Partial<Entry> = {}): Entry => ({
  distance: 240, sync: 85, tickRate: 128, valid: true, landed: true, strafes: [],
  mapId: 'longjump_source_go', at: 1, autoBhop: false, ...changes,
} as Entry);

test('Best records survive eviction from recent history and browser storage round trips', () => {
  let recent = [entry({ distance: 246 })];
  let records = readBests(null, recent);
  for (let i = 0; i < 110; i++) {
    const next = entry({ distance: 235, at: i + 2 });
    records = saveBest(records, next); recent = readHistory([next, ...recent]);
  }
  assert.equal(recent.length, 100);
  assert.equal(Math.max(...recent.map(j => j.distance)), 235);
  assert.equal(readBests(JSON.parse(JSON.stringify(records)), recent)[0].distance, 246);
});
test('Records distinguish maps, ticks, auto-hop, LJ binds and legacy settings', () => {
  const attempts = [entry(), entry({ mapId: 'kz_longjumps_go' }), entry({ tickRate: 64 }),
    entry({ autoBhop: true }), entry({ ljBind: true }), entry({ autoBhop: undefined })];
  const records = readBests(null, attempts);
  assert.equal(records.length, 6);
  assert.equal(saveBest(records, entry({ distance: 250 })).length, 6);
  assert.equal(saveBest(records, entry({ distance: 250 })).filter(j => j.distance === 250).length, 1);
  assert.deepEqual(readBests(null, [entry({ mapId: undefined })]), []);
});
test('Misses, invalid jumps and unsupported record categories never replace a valid PB', () => {
  const records = readBests(null, [entry()]);
  for (const attempt of [entry({ distance: 260, valid: false }), entry({ distance: 260, landed: false }),
    entry({ distance: NaN }), entry({ mapId: 'unknown' as Entry['mapId'] })]) {
    assert.deepEqual(saveBest(records, attempt), records);
  }
});
