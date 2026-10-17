import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, LADDER, SOLID } from '../src/collision.ts';
import { DIST_EPSILON, Movement, RULES, type Box, type Input } from '../src/physics.ts';
import { parseReplay, verifyReplay } from '../src/replay.ts';

// collision.bin with boxes only, as scripts/import_full_map.py writes it (LJC2 adds a contents byte per box and brush).
function world(boxes: { box: Box; contents: number }[], magic = 'LJC2') {
  const floats = new Float32Array(boxes.flatMap(({ box: b }) => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]));
  const parts = [new TextEncoder().encode(magic), new Uint8Array(new Uint32Array([boxes.length, 0, 0, 0]).buffer), new Uint8Array(floats.buffer)];
  if (magic === 'LJC2') parts.push(new Uint8Array(boxes.map(b => b.contents)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return new CollisionWorld(out.buffer);
}
const box = (id: string, min: [number, number, number], max: [number, number, number]): Box =>
  ({ id, min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
// A floor, a 300-unit ledge from y = 116, and a ladder on its face (y 100..116) that faces -y.
const scene = [
  { box: box('floor', [-500, -500, -100], [500, 500, 0]), contents: SOLID },
  { box: box('ledge', [-500, 116, -100], [500, 500, 300]), contents: SOLID },
  { box: box('ladder', [-16, 100, 0], [16, 116, 300]), contents: SOLID | LADDER },
];
const idle: Input = { forward: 0, side: 0, jump: false, duck: false, walk: false, yaw: 0, pitch: 0 };
const climb = RULES.climbSpeed * RULES.ladderScale;

function setup(magic = 'LJC2', tickRate: 64 | 128 = 128) {
  const m = new Movement(); m.boxes = []; m.world = world(scene, magic); m.tickRate = tickRate;
  m.reset({ x: 0, y: 40, z: DIST_EPSILON });
  return m;
}
// Walk forward (+y) into the ladder until it takes hold.
function mount(m: Movement, input: Partial<Input> = {}) {
  for (let t = 0; t < m.tickRate * 2 && !m.ladderNormal; t++) m.step({ ...idle, forward: 1, ...input });
  assert.ok(m.ladderNormal, 'the ladder takes hold');
}

test('Walking into a ladder climbs it at the CS:GO climb speed', () => {
  for (const tickRate of [64, 128] as const) {
    const m = setup('LJC2', tickRate); mount(m);
    assert.deepEqual(m.ladderNormal, { x: 0, y: -1, z: 0 });
    for (let t = 0; t < tickRate / 2; t++) m.step({ ...idle, forward: 1 });
    assert.ok(Math.abs(m.velocity.z - climb) < 1e-9 && !m.grounded, `${tickRate}: ${m.velocity.z}`);
    assert.ok(Math.abs(m.velocity.x) < 1e-9 && Math.abs(m.velocity.y) < 1e-9);
  }
});

test('A ladder holds the player still without input, and S climbs down to the floor', () => {
  const m = setup(); mount(m);
  for (let t = 0; t < 64; t++) m.step({ ...idle, forward: 1 });
  const z = m.position.z;
  for (let t = 0; t < 128; t++) m.step(idle);
  assert.equal(m.position.z, z, 'no gravity on a ladder');
  assert.ok(m.ladderNormal);
  for (let t = 0; t < 256; t++) m.step({ ...idle, forward: -1 });
  assert.ok(m.grounded && Math.abs(m.position.z - DIST_EPSILON) < 1e-6, `back on the floor at ${m.position.z}`);
});

test('Looking up the ladder climbs faster; CS dampening keeps the climb vertical', () => {
  const m = setup(); mount(m);
  m.step({ ...idle, forward: 1, pitch: Math.PI / 4 });
  // Half the climb goes into the face and is turned upward: (sin 45° + cos 45°) of it.
  assert.ok(Math.abs(m.velocity.z - climb * Math.SQRT2) < 1e-6, `${m.velocity.z}`);
  assert.ok(Math.abs(m.velocity.y) < 1e-9);
});

test('Climbing over the top lands on the ledge and leaves the ladder', () => {
  const m = setup(); mount(m);
  for (let t = 0; t < 128 * 4; t++) m.step({ ...idle, forward: 1 });
  assert.ok(m.grounded && !m.ladderNormal, 'standing on top');
  assert.ok(Math.abs(m.position.z - (300 + DIST_EPSILON)) < 1e-6, `${m.position.z}`);
});

test('Jumping off a ladder pushes 270 u/s away from its face and never counts as a long jump', () => {
  const m = setup(); mount(m);
  for (let t = 0; t < 64; t++) m.step({ ...idle, forward: 1 });
  m.step({ ...idle, jump: true, jumpPressed: true });
  assert.equal(m.ladderNormal, null);
  assert.ok(Math.abs(m.velocity.y + RULES.ladderJump) < 1e-9, `${m.velocity.y}`);
  // Grabbing the ladder from the floor with jump held jumps off it on the same tick, and that attempt is invalid.
  const g = setup(); g.reset({ x: 0, y: 100 - RULES.hull - DIST_EPSILON, z: DIST_EPSILON });
  g.step({ ...idle, forward: 1, jump: true, jumpPressed: true });
  // W still air-accelerates back toward the ladder on that tick.
  assert.ok(g.jump && !g.jump.valid && g.velocity.y < -240 && g.velocity.z > 0, `${g.velocity.y}`);
});

test('Collision files without contents (LJC1) keep ladders as plain walls', () => {
  const m = setup('LJC1');
  for (let t = 0; t < 256; t++) m.step({ ...idle, forward: 1 });
  assert.equal(m.ladderNormal, null);
  assert.ok(m.grounded && m.position.z < 1);
});

test('Replays carry pitch and reject a takeoff on a ladder', () => {
  const m = setup(); mount(m);
  const state = m.snapshot();
  const replay = parseReplay({ version: 1, tickRate: 128, mapId: 'test', mapContentVersion: '', physicsVersion: '', state,
    inputs: [{ ...idle, jump: true, pitch: 0.5 }] });
  assert.equal(replay.inputs[0].pitch, 0.5);
  assert.deepEqual(replay.state.ladderNormal, { x: 0, y: -1, z: 0 });
  assert.throws(() => verifyReplay(replay, [], m.world), /solid ground/);
  assert.throws(() => parseReplay({ ...replay, inputs: [{ ...idle, pitch: 4 }] }), /input/);
});

test('Replay states keep only movement fields, so a post cannot override server settings', () => {
  const m = setup(); const state = { ...m.snapshot(), tickRate: 64, world: null, boxes: [], autoBhop: true };
  const replay = parseReplay({ version: 1, tickRate: 128, mapId: 'test', mapContentVersion: '', physicsVersion: '', state, inputs: [idle] });
  for (const key of ['tickRate', 'world', 'boxes', 'autoBhop']) assert.ok(!(key in replay.state), key);
  const restored = new Movement(); restored.tickRate = 128; restored.restore(replay.state);
  assert.equal(restored.tickRate, 128);
});

test('A ladder flush with a clip brush is still climbable', () => {
  // Clip first, so the nearest-then-lowest rule picks it over the ladder at the same distance (as on de_nuke).
  const clip = { box: box('clip', [-16, 100, 0], [16, 101, 300]), contents: SOLID };
  const m = new Movement(); m.boxes = []; m.world = world([clip, ...scene]); m.reset({ x: 0, y: 40, z: DIST_EPSILON });
  mount(m);
  assert.deepEqual(m.ladderNormal, { x: 0, y: -1, z: 0 });
});
