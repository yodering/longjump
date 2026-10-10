import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CollisionWorld } from '../src/collision.ts';
import { Movement, RULES } from '../src/physics.ts';
import { loadMapRules } from '../server/versions.ts';

const idle = { forward: 0, side: 0, jump: false, duck: false, walk: false, yaw: 0 };
for (const id of ['de_mirage', 'de_nuke']) {
  const path = new URL(`../public/maps/${id}/`, import.meta.url);
  const data = JSON.parse(readFileSync(new URL('map.json', path), 'utf8'));
  const file = gunzipSync(readFileSync(new URL(data.collision.file, path)));
  const collision = new CollisionWorld(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

  test(`${id}: every spawn settles onto supported, clear ground and stays put`, () => {
    assert.ok(data.spawns.length >= 20);
    for (const spawn of data.spawns as { position: number[] }[]) {
      const m = new Movement(); m.boxes = []; m.world = collision; m.tickRate = 128;
      const [x, y, z] = spawn.position; m.reset({ x, y, z });
      for (let t = 0; t < 128; t++) m.step(idle);
      const rest = { ...m.position };
      assert.ok(m.grounded && m.support(), `${x} ${y} ${z} is supported`);
      assert.equal(m.overlaps(m.position, RULES.height), false);
      assert.ok(Math.abs(rest.z - z) < 40 && Math.hypot(rest.x - x, rest.y - y) < 1, 'settles where it spawned');
      for (let t = 0; t < 128; t++) m.step(idle);
      assert.deepEqual(m.position, rest);
    }
  });

  test(`${id}: the entry is a supported spawn, and geometry, props and lighting files exist`, () => {
    const m = new Movement(); m.boxes = []; m.world = collision; m.reset(data.entry.position);
    for (let t = 0; t < 64; t++) m.step(idle);
    assert.ok(m.support());
    assert.deepEqual(data.lanes, []);
    for (const file of [data.geometry.file, data.props.file, data.props.colorFile, data.lightmap.texture, data.lighting.samples]) assert.ok(existsSync(new URL(file, path)), file);
    for (const material of [...data.materials, ...data.props.materials]) if (material.texture) assert.ok(existsSync(new URL(material.texture, path)), material.texture);
    assert.deepEqual(Object.keys(data.sky.faces).sort(), ['bk', 'dn', 'ft', 'lf', 'rt', 'up']);
  });

  test(`${id}: the server loads the same collision the game does`, () => {
    const rules = loadMapRules(id);
    assert.deepEqual(rules.world?.counts, collision.counts);
    assert.deepEqual(rules.boxes, []);
  });
}
