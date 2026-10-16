import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../src/collision.ts';
import { DIST_EPSILON, Movement, type Box, type Result } from '../src/physics.ts';
import { parseReplay, verifyReplay } from '../src/replay.ts';
import { flat, idle, recordJump } from './jump-fixture.ts';

type Plane = [number, number, number, number];
// collision.bin as scripts/import_full_map.py writes it.
function world(boxes: Box[], brushes: Plane[][] = [], triangles: number[][] = []) {
  const planes = brushes.flat(), bounds = brushes.map(() => [-4000, -4000, -4000, 4000, 4000, 4000]);
  const floats = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
  const parts = [new TextEncoder().encode('LJC1'), new Uint8Array(new Uint32Array([boxes.length, brushes.length, planes.length, triangles.length]).buffer),
    floats(boxes.flatMap(b => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z])),
    new Uint8Array(new Uint32Array(brushes.flatMap((b, i) => [brushes.slice(0, i).reduce((n, p) => n + p.length, 0), b.length])).buffer),
    floats(bounds.flat()), floats(planes.flat()), floats(triangles.flat())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return new CollisionWorld(out.buffer);
}
const floor = flat[0];
const slab: Plane[] = [[1, 0, 0, floor.max.x], [-1, 0, 0, -floor.min.x], [0, 1, 0, floor.max.y], [0, -1, 0, -floor.min.y], [0, 0, 1, floor.max.z], [0, 0, -1, -floor.min.z]];
const [x0, y0, x1, y1] = [floor.min.x, floor.min.y, floor.max.x, floor.max.y];
const tiles = [[x0, y0, 0, x1, y0, 0, x1, y1, 0], [x0, y0, 0, x1, y1, 0, x0, y1, 0]];

function jump(setup: (m: Movement) => void, tickRate: 64 | 128 = 128) {
  // Resting height: surfaces are solid where the hull touches them, so the engine keeps the feet 1/32 above.
  const m = new Movement(); setup(m); m.tickRate = tickRate; m.reset({ x: 0, y: 0, z: DIST_EPSILON });
  let result: Result | null = null; m.onResult = r => { result = r; };
  let yaw = 0;
  for (let t = 0; t < tickRate * 4 && !result; t++) {
    const airborne = !!m.jump, side = airborne ? (Math.floor(t / (tickRate / 4)) % 2 ? 1 : -1) : 0;
    if (airborne) yaw += side * 0.012;
    m.step({ ...idle, forward: airborne ? 0 : 1, side, yaw, jump: t === tickRate });
  }
  return result as Result | null;
}

test('A world box collides exactly like a map box', () => {
  const asBoxes = jump(m => { m.boxes = flat; });
  const asWorld = jump(m => { m.boxes = []; m.world = world(flat); });
  assert.ok(asBoxes?.valid && asWorld?.valid);
  assert.deepEqual({ ...asWorld, path: undefined }, { ...asBoxes, path: undefined });
});

test('Brushes and displacement triangles give the same flat-ground jump as a box', () => {
  const expected = jump(m => { m.boxes = flat; })!;
  for (const [name, w] of [['brush', world([], [slab])], ['triangles', world([], [], tiles)]] as const) {
    const result = jump(m => { m.boxes = []; m.world = w; })!;
    assert.ok(result.valid, `${name}: ${result.reason}`);
    assert.ok(Math.abs(result.distance - expected.distance) < 1e-6, `${name}: ${result.distance} vs ${expected.distance}`);
  }
});

test('Standing on a sloped triangle is ground, and walls stop the hull a hair short', () => {
  const ramp = world([], [], [[-500, -500, 0, 500, -500, 0, 500, 500, 200], [-500, -500, 0, 500, 500, 200, -500, 500, 200]]);
  const m = new Movement(); m.boxes = []; m.world = ramp; m.reset({ x: 0, y: 0, z: 150 });
  for (let t = 0; t < 128; t++) m.step(idle);
  assert.ok(m.grounded && m.support(), 'rests on the 11° ramp');
  const wall = world([{ id: 'wall', min: { x: 100, y: -500, z: -100 }, max: { x: 120, y: 500, z: 300 } }], [], tiles);
  const w = new Movement(); w.boxes = []; w.world = wall; w.reset({ x: 0, y: 0, z: DIST_EPSILON });
  const tr = w.trace(w.position, { x: 200, y: 0, z: DIST_EPSILON });
  assert.ok(tr.fraction < 1 && Math.abs(tr.end.x - (100 - 16 - 0.03125)) < 1e-6, `stopped at ${tr.end.x}`);
  assert.equal(tr.normal.x, -1);
});

test('The leaderboard reruns a whole-map jump to the identical result', () => {
  const w = world([], [], tiles);
  const { replay } = recordJump(128);
  const onBoxes = verifyReplay(parseReplay(JSON.parse(JSON.stringify(replay))), flat);
  const onWorld = verifyReplay(parseReplay(JSON.parse(JSON.stringify(replay))), [], w);
  assert.equal(onWorld.valid, true);
  assert.ok(Math.abs(onWorld.distance - onBoxes.distance) < 1e-6);
});

test('At the foot of a steep slope, a quarter of the hull still finds the floor (TryTouchGroundInQuadrants)', () => {
  // A 63° wedge rising from x = 20 (its face's normal z is 0.45), on a displacement floor. Brushes come before
  // triangles, so where the hull touches both, the full ground trace reports the steep face.
  const k = Math.sqrt(5);
  const wedge: Plane[] = [[-2 / k, 0, 1 / k, -40 / k], [0, 0, -1, 100], [1, 0, 0, 200], [0, 1, 0, 500], [0, -1, 0, 500], [0, 0, 1, 360]];
  const m = new Movement(); m.boxes = []; m.world = world([], [wedge], tiles); m.reset({ x: 0, y: 0, z: DIST_EPSILON });
  m.reset(m.trace(m.position, { x: 40, y: 0, z: DIST_EPSILON }).end);
  const start = { ...m.position };
  assert.ok(start.x > 3 && start.x < 4, `touching the wedge at x = ${start.x}`);
  const full = m.trace(start, { ...start, z: start.z - 2 });
  assert.ok(full.normal.z < 0.7, 'the full hull reports the steep face');
  for (let t = 0; t < 128; t++) { m.step(idle); assert.ok(m.grounded, `grounded on tick ${t}`); }
  assert.deepEqual(m.position, start);
});

test('A takeoff at the foot of a steep slope counts as solid ground for the leaderboard', () => {
  const k = Math.sqrt(5);
  const wedge: Plane[] = [[-2 / k, 0, 1 / k, -40 / k], [0, 0, -1, 100], [1, 0, 0, 200], [0, 1, 0, 500], [0, -1, 0, 500], [0, 0, 1, 360]];
  const w = world([], [wedge], tiles), m = new Movement(); m.boxes = []; m.world = w; m.reset({ x: 0, y: 0, z: DIST_EPSILON });
  m.reset(m.trace(m.position, { x: 40, y: 0, z: DIST_EPSILON }).end);
  const support = m.support();
  assert.ok(support && Math.abs(m.position.z - (support.z + DIST_EPSILON)) < 1e-6, `support at ${support?.z}`);
});
