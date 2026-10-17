import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CollisionWorld, LADDER } from '../src/collision.ts';
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

  test(`${id}: every ladder can be grabbed and climbed`, () => {
    // Ladder bounds straight from collision.bin: contents follow the boxes, brushes, planes and triangles.
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength), [boxes, brushes, planes, triangles] = [4, 8, 12, 16].map(o => view.getUint32(o, true));
    const contentsAt = 20 + (boxes * 6 + brushes * 8 + planes * 4 + triangles * 9) * 4;
    const ladders: number[][] = [];
    for (let i = 0; i < boxes + brushes; i++) if (view.getUint8(contentsAt + i) & LADDER) {
      const at = i < boxes ? 20 + i * 24 : 20 + boxes * 24 + brushes * 8 + (i - boxes) * 24;
      ladders.push([0, 1, 2, 3, 4, 5].map(k => view.getFloat32(at + k * 4, true)));
    }
    assert.equal(ladders.length, data.collision.ladders);
    const stuck: string[] = [];
    for (const [x0, y0, z0, x1, y1, z1] of ladders) {
      // Stand just clear of either face of the thin axis, anywhere along the ladder's width (tilted brushes have loose
      // bounds and neighbouring brushes can stick out), walk into it and climb. Ladders walled in by clips are skipped.
      const alongX = x1 - x0 < y1 - y0, z = z0 + Math.max(0, (z1 - z0 - RULES.height) / 2), m = new Movement();
      m.boxes = []; m.world = collision; m.tickRate = 128;
      const probes = [];
      for (const sign of [1, -1]) for (let s = 0; s <= 1; s += 0.125) for (let d = RULES.hull; d <= RULES.hull + 8; d++) {
        const at = alongX ? { x: (sign > 0 ? x0 : x1) - sign * d, y: y0 + (y1 - y0) * s, z } : { x: x0 + (x1 - x0) * s, y: (sign > 0 ? y0 : y1) - sign * d, z };
        if (!m.overlaps(at, RULES.height)) { probes.push({ at, yaw: alongX ? sign * Math.PI / 2 : sign > 0 ? 0 : Math.PI }); break; }
      }
      const climbed = probes.some(({ at, yaw }) => {
        m.reset(at);
        for (let t = 0; t < 32 && !m.ladderNormal; t++) m.step({ ...idle, forward: 1, yaw, pitch: 0 });
        if (!m.ladderNormal) return false;
        for (let t = 0; t < 32; t++) m.step({ ...idle, forward: 1, yaw, pitch: 0 });
        return m.position.z > at.z + 20;
      });
      if (!climbed) stuck.push([x0, y0, z0, x1, y1, z1].map(Math.round).join(' '));
    }
    // de_mirage's second ladder is walled in by clips behind scaffolding. de_nuke's short ladder sits 0.02 units back in
    // a 24-unit recess, narrower than the hull, so the walls either side always stop LadderMove's trace first.
    assert.deepEqual(stuck, { de_mirage: ['156 -1992 -168 168 -1952 -8'], de_nuke: ['-240 -1195 -251 -216 -1194 -155'] }[id]);
  });

  test(`${id}: the server loads the same collision the game does`, () => {
    const rules = loadMapRules(id);
    assert.deepEqual(rules.world?.counts, collision.counts);
    assert.deepEqual(rules.boxes, []);
  });
}
