import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Movement, RULES } from '../src/physics.ts';
import { mapEntry, mapLanes, blockAt, belowMap, CONCRETE_GAP } from '../src/practice.ts';
import { soundTiers, jumpSound } from '../src/sound-tiers.ts';
import type { ImportedMap } from '../src/maps.ts';
const idle = { forward: 0, side: 0, jump: false, duck: false, walk: false, yaw: 0 };
for (const name of ['longjump_source_go', 'kz_longjumps_go']) {
  const map = JSON.parse(readFileSync(new URL(`../public/maps/${name}/map.json`, import.meta.url), 'utf8')) as ImportedMap;
  test(`${name}: map entrance is supported and free to move from`, () => {
    const m = new Movement(); m.boxes = map.boxes; const entry = mapEntry(map); m.reset(entry.position);
    assert.ok(m.support()); assert.equal(m.overlaps(m.position, RULES.height), false);
    const before = { ...m.position };
    for (let t = 0; t < 20; t++) m.step({ ...idle, forward: 1, yaw: entry.yaw });
    assert.ok(Math.hypot(m.position.x - before.x, m.position.y - before.y) > 5);
    assert.equal(belowMap(map, m.position), false);
  });
  test(`${name}: misses leave the player on the walkable floor instead of resetting`, () => {
    const m = new Movement(); m.boxes = map.boxes; const lane = map.lanes.find(l => l.gap === 246)!;
    const start = map.boxes.find(b => b.id === lane.startId)!;
    m.reset({ ...lane.spawn, x: start.max.x + 14 }); m.velocity.x = 250;
    for (let t = 0; t < 256; t++) m.step({ ...idle, forward: 1, yaw: lane.yaw, jump: t === 0, duck: t > 64 });
    assert.equal(m.result?.valid, false); assert.ok(m.grounded);
    assert.ok(m.position.z < lane.spawn.z); assert.equal(belowMap(map, m.position), false);
    assert.equal(blockAt(mapLanes(map), lane.startId)?.gap, 246);
    assert.equal(blockAt(mapLanes(map), lane.endId)?.gap, 246);
    assert.equal(blockAt(mapLanes(map), m.support()!.id), undefined);
    const before = { ...m.position };
    // Standing back up takes 0.125 s at crouched speed, so give the walk a moment.
    for (let t = 0; t < 60; t++) m.step({ ...idle, forward: 1 });
    assert.ok(Math.abs(m.position.y - before.y) > 20);
  });
}
test('Concrete has fixed gaps and an entrance on its connecting walkway', () => {
  const m = new Movement(CONCRETE_GAP); m.reset(mapEntry(null).position);
  assert.equal(m.support()?.id, 'back');
  assert.deepEqual(mapLanes(null).map(l => l.gap), [220, 230, 240, 250, 260]);
  assert.equal(belowMap(null, { x: 0, y: 0, z: -181 }), true);
});
test('GOKZ voice tiers use exact thresholds and only one highest-tier clip', () => {
  assert.equal(jumpSound(229.99, true), null);
  assert.equal(jumpSound(240, true), 'godlike');
  assert.equal(jumpSound(242.99, true), 'godlike');
  assert.equal(jumpSound(243, true), 'ownage');
  assert.equal(jumpSound(245.99, true), 'ownage');
  assert.equal(jumpSound(246, true), 'wrecker');
  for (let i = 0; i < soundTiers.length; i++) {
    const tier = soundTiers[i]; assert.equal(jumpSound(tier.distance, true), tier.name);
    assert.equal(jumpSound(tier.distance - 0.001, true), i ? soundTiers[i - 1].name : null);
    assert.equal(jumpSound(tier.distance + 0.5, false), null);
    assert.ok(existsSync(new URL(`../public/audio/gokz/${tier.name}.mp3`, import.meta.url)));
  }
  assert.equal(jumpSound(NaN, true), null); assert.equal(jumpSound(Infinity, true), null);
  for (const sound of ['blip1', 'button10']) {
    const data = readFileSync(new URL(`../public/audio/source/${sound}.wav`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF'); assert.equal(data.subarray(8, 12).toString(), 'WAVE');
  }
});
