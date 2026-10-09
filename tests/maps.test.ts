import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Movement, RULES, speed, type Box } from '../src/physics.ts';
import { MapLighting } from '../src/map-lighting.ts';
const idle = { forward: 0, side: 0, jump: false, duck: false, walk: false, yaw: Math.PI / 2 };
const range = (minimum: number, maximum: number) => Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i);
// kz_baxter's LJ room: 210 and 217–310, with second lanes for some distances and a few longer steps above 295.
const baxter = [210, ...range(217, 220), ...range(225, 239), 240, 240, ...range(241, 255), 256, ...range(257, 259), 260, 260, ...range(261, 269), 270, 270,
  ...range(271, 284), 285, 285, ...range(286, 289), 290, 290, ...range(291, 294), 295, 295, 300, 300, 305, 305, 308, 310, 310];
type Lane = { gap: number; startId: string; endId: string; spawn: { x: number; y: number; z: number }; yaw: number };
// Lanes run along +x (yaw 90°) or +y (yaw 0).
const along = (lane: Lane) => lane.yaw === 0 ? 'y' as const : 'x' as const;
for (const [name, gaps] of [['longjump_source_go', range(225, 260)], ['kz_longjumps_go', range(240, 249)], ['kz_baxter', baxter]] as const) {
  const path = new URL(`../public/maps/${name}/`, import.meta.url);
  const data = JSON.parse(readFileSync(new URL('map.json', path), 'utf8'));
  test(`${name}: every fixed gap comes from original brush bounds and every spawn is clear`, () => {
    assert.deepEqual(data.lanes.map((l: { gap: number }) => l.gap), gaps);
    const m = new Movement(); m.boxes = data.boxes;
    for (const lane of data.lanes as Lane[]) {
      const start = m.boxes.find((b: Box) => b.id === lane.startId)!;
      const end = m.boxes.find((b: Box) => b.id === lane.endId)!;
      assert.equal(end.min[along(lane)] - start.max[along(lane)], lane.gap);
      assert.equal(end.max.z, start.max.z);
      m.reset(lane.spawn); assert.equal(m.support()?.id, lane.startId);
      assert.equal(m.overlaps(m.position, RULES.height), false);
      for (let t = 0; t < 128; t++) m.step(idle);
      assert.deepEqual(m.position, lane.spawn);
    }
  });
  test(`${name}: compiled lightmaps and model lighting cover every block`, () => {
    assert.ok(existsSync(new URL(data.lightmap.texture, path)));
    assert.deepEqual(Object.keys(data.sky.faces).sort(), ['bk', 'dn', 'ft', 'lf', 'rt', 'up']);
    // Every drawn surface has a real texture (stock ones come from the CS:GO VPK), and decals are lit and textured.
    const drawn = new Set(data.meshes.map((m: { material: number }) => m.material));
    assert.deepEqual(data.materials.filter((m: { texture?: string }, i: number) => drawn.has(i) && !m.texture).map((m: { name: string }) => m.name), []);
    for (const material of data.decals.materials) assert.ok(existsSync(new URL(material.texture, path)));
    for (const mesh of data.decals.meshes) {
      assert.equal(mesh.uv2.length / 2, mesh.positions.length / 3);
      assert.ok(mesh.uvs.every((v: number) => v >= -1e-4 && v <= 1 + 1e-4));
    }
    for (const face of Object.values(data.sky.faces) as string[]) assert.ok(existsSync(new URL(face, path)));
    for (const mesh of data.meshes) {
      assert.equal(mesh.uv2.length / 2, mesh.positions.length / 3);
      assert.ok(mesh.uv2.every((v: number) => v > 0 && v < 1));
      if (!mesh.lmStep) continue;
      // Bumped faces: the three directional lightmaps sit beside the flat one and must stay inside the atlas.
      assert.equal(mesh.lmStep.length, mesh.positions.length / 3);
      mesh.lmStep.forEach((step: number, i: number) => assert.ok(mesh.uv2[i * 2] + 3 * step < 1));
      // A bumped face whose (packed) material declares no $bumpmap uses its flat lightmap, as in game.
      const normalMap = data.materials[mesh.material].normalMap;
      if (normalMap) assert.ok(existsSync(new URL(normalMap, path)));
    }
    const bin = readFileSync(new URL(data.lighting.samples, path));
    const lighting = new MapLighting({ ...data, lightingSamples: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) });
    for (const lane of data.lanes) {
      const eye = { ...lane.spawn, z: lane.spawn.z + 64 };
      const ambient = lighting.ambient(eye);
      assert.ok(ambient, `no ambient samples in the leaf at the ${lane.gap} block`);
      assert.ok(ambient.flat().some(v => v > 0.005));
    }
  });
  test(`${name}: all local textures exist and triangle winding agrees with exported normals`, () => {
    for (const mesh of data.meshes) {
      const material = data.materials[mesh.material];
      if (material.texture) assert.ok(existsSync(new URL(material.texture, path)));
      assert.equal(mesh.positions.length, mesh.normals.length);
      assert.equal(mesh.uvs.length * 1.5, mesh.positions.length);
      for (let i = 0; i < mesh.positions.length; i += 9) {
        const p = mesh.positions, n = mesh.normals;
        const a = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
        const b = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
        const dot = (a[1] * b[2] - a[2] * b[1]) * n[i] + (a[2] * b[0] - a[0] * b[2]) * n[i + 1] + (a[0] * b[1] - a[1] * b[0]) * n[i + 2];
        assert.ok(dot >= -0.1, `Reversed triangle ${i / 9}`);
      }
    }
  });
  for (const tickRate of [64, 128] as const) test(`${name}: ${tickRate}t manual-input strafes clear the original 246 block`, () => {
    const lane = data.lanes.find((l: Lane) => l.gap === 246) as Lane, axis = along(lane);
    const m = new Movement(); m.boxes = data.boxes; m.tickRate = tickRate;
    const start = m.boxes.find((b: Box) => b.id === lane.startId)!;
    m.reset({ ...lane.spawn, [axis]: start.max[axis] + 14 }); m.velocity[axis] = 250;
    // Drifting to the left of the run (+y along x, -x along y) calls for the right strafe key.
    const left = (v: { x: number; y: number }) => axis === 'x' ? v.y : -v.x;
    for (let t = 0; t < tickRate * 2 && !m.result; t++) {
      const side = left(m.velocity) > 0 ? 1 : -1;
      const projection = Math.max(0, 30 - 12 * 250 / tickRate * m.surfaceFriction);
      const yaw = Math.atan2(m.velocity.x, m.velocity.y) + side * Math.acos(projection / speed(m.velocity)) - side * Math.PI / 2;
      m.step({ ...idle, side, yaw, jump: t === 0, duck: t > tickRate / 2 });
    }
    assert.ok(m.result?.valid, `${m.result?.reason} at ${JSON.stringify(m.position)}`);
    assert.ok(m.result.distance >= 246); assert.equal(m.platform, lane.endId);
    const straight = new Movement(); straight.boxes = data.boxes; straight.tickRate = tickRate;
    straight.reset({ ...lane.spawn, [axis]: start.max[axis] + 14 }); straight.velocity[axis] = 250;
    for (let t = 0; t < tickRate * 2; t++) straight.step({ ...idle, forward: 1, yaw: lane.yaw, jump: t === 0, duck: t > tickRate / 2 });
    assert.equal(straight.result?.valid, false);
    assert.equal(straight.result?.landed, false);
    assert.ok(straight.grounded);
    assert.ok(straight.position.z < lane.spawn.z);
  });
}
