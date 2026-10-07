import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistory } from '../src/history.ts';

test('Malformed and incomplete saved history cannot break startup', () => {
  const record = { distance: 246, sync: 85, tickRate: 128, valid: true, strafes: [] };
  assert.deepEqual(readHistory(null), []);
  assert.deepEqual(readHistory({}), []);
  assert.deepEqual(readHistory([null, 7, {}, { ...record, sync: undefined },
    { ...record, strafes: null }, { ...record, tickRate: 100 }, record]), [record]);
  assert.equal(readHistory(Array.from({ length: 120 }, () => record)).length, 100);
});
