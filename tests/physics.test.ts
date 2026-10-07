import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Movement, RULES, DIST_EPSILON, speed, accelerate, type Input } from '../src/physics.ts';
const idle: Input = { forward: 0, side: 0, jump: false, duck: false, walk: false, yaw: 0 };
function flat(m: Movement) { m.boxes = [{ id: 'flat', min: { x: -2000, y: -2000, z: -100 }, max: { x: 2000, y: 2000, z: 0 } }]; m.reset(); }
for (const tickRate of [64, 128] as const) {
  test(`${tickRate}t: run speed is 250 and diagonal movement gives no prestrafe`, () => {
    for (const side of [0, 1]) {
      const m = new Movement(); m.tickRate = tickRate; flat(m);
      for (let t = 0; t < tickRate * 2; t++) m.step({ ...idle, forward: 1, side });
      assert.ok(Math.abs(speed(m.velocity) - 250) < 0.001);
    }
  });
  test(`${tickRate}t: jump height matches CS:GO's tick-dependent 54.65 / 55.83 units`, () => {
    const m = new Movement(); m.tickRate = tickRate; flat(m); m.velocity.y = 250;
    for (let t = 0; t < tickRate && !m.result; t++) m.step({ ...idle, jump: t === 0 });
    assert.ok(m.result?.valid);
    assert.ok(Math.abs(m.result.height - (tickRate === 64 ? 54.654 : 55.826)) < 0.001, `height ${m.result.height}`);
    assert.equal(m.result.ticks, tickRate === 64 ? 47 : 95);
    assert.ok(Math.abs(m.result.distance - (tickRate === 64 ? 216.88 : 218.81)) < 0.01, `distance ${m.result.distance}`);
    // The landing tick finds ground within 2 units without moving; the next ground tick snaps to the floor + DIST_EPSILON.
    assert.ok(m.position.z > 0 && m.position.z <= 2);
    m.step(idle); assert.equal(m.position.z, DIST_EPSILON);
  });
  test(`${tickRate}t: jump tick applies StartGravity and FinishGravity around the impulse`, () => {
    const half = RULES.gravity / tickRate / 2;
    const standing = new Movement(); standing.tickRate = tickRate; flat(standing);
    standing.step({ ...idle, jump: true });
    assert.ok(Math.abs(standing.velocity.z - (RULES.jumpImpulse - 3 * half)) < 1e-9);
    const ducked = new Movement(); ducked.tickRate = tickRate; flat(ducked);
    ducked.step({ ...idle, duck: true }); ducked.step({ ...idle, duck: true, jump: true });
    assert.ok(Math.abs(ducked.velocity.z - (RULES.jumpImpulse - 2 * half)) < 1e-9);
  });
  test(`${tickRate}t: landed distance uses the interpolated touchdown point`, () => {
    const m = new Movement(); m.tickRate = tickRate; flat(m); m.velocity.y = 250;
    for (let t = 0; t < tickRate && !m.result; t++) m.step({ ...idle, jump: t === 0 });
    const touchdown = m.result!.path.at(-1)!;
    assert.equal(touchdown.z, 0);
    assert.ok(Math.abs(m.result!.distance - (touchdown.y + 240 + 32)) < 1e-9);
    assert.notEqual(touchdown.y, m.position.y);
  });
  test(`${tickRate}t: late air duck extends the jump and holding jump never auto-hops`, () => {
    const m = new Movement(); m.tickRate = tickRate; flat(m); m.velocity.y = 250;
    for (let t = 0; t < tickRate * 2; t++) m.step({ ...idle, jump: true, duck: t > tickRate / 2 });
    assert.ok(m.result?.valid); assert.ok(m.result.ducked);
    assert.ok(m.result.distance > 222 && m.result.distance < 228, `distance ${m.result.distance}`);
    assert.equal(m.grounded, true); assert.equal(m.jump, null); assert.equal(m.velocity.z, 0);
  });
  const gap = 246;
  test(`${tickRate}t: coordinated air strafes can clear ${gap}; forward-only cannot`, () => {
    const m = new Movement(gap); m.tickRate = tickRate; m.position.y = 14; m.velocity.y = 250;
    for (let t = 0; t < tickRate * 2 && !m.result; t++) {
      // Strafe back toward the lane centre so the bot never drifts off the block.
      const side = m.velocity.x > 0 ? -1 : 1;
      const projection = Math.max(0, 30 - 12 * 250 / tickRate * m.surfaceFriction);
      const yaw = Math.atan2(m.velocity.x, m.velocity.y) + side * Math.acos(Math.min(1, projection / speed(m.velocity))) - side * Math.PI / 2;
      m.step({ ...idle, side, yaw, jump: t === 0, duck: t > tickRate * 0.65 });
    }
    assert.ok(m.result?.valid, `Failed at ${m.position.x}, ${m.position.y}`); assert.ok(m.result.distance >= gap);
    assert.ok(m.result.strafes.length > 1); assert.ok(m.result.sync > 95);
    assert.ok(Math.abs(m.result.edge! - 2) < 1e-9); assert.ok(m.result.width > 0);
    const straight = new Movement(gap); straight.tickRate = tickRate; straight.position.y = 14; straight.velocity.y = 250;
    for (let t = 0; t < tickRate * 2 && !straight.result; t++) straight.step({ ...idle, forward: 1, jump: t === 0, duck: t > tickRate / 2 });
    assert.equal(straight.result?.landed, false); assert.ok(straight.result.distance < 240);
  });
  test(`${tickRate}t: misses stop measuring at takeoff elevation, not the bottom of the pit`, () => {
    const m = new Movement(280); m.tickRate = tickRate; m.position.y = 14; m.velocity.y = 250;
    for (let t = 0; t < tickRate * 2 && !m.result; t++) m.step({ ...idle, jump: t === 0 });
    assert.equal(m.result?.valid, false); assert.equal(m.result?.landed, false);
    assert.ok(Math.abs(m.result.distance - (tickRate === 64 ? 216.82 : 218.79)) < 0.01, `distance ${m.result.distance}`);
    const distance = m.result.distance;
    for (let t = 0; t < tickRate; t++) m.step(idle);
    assert.equal(m.result.distance, distance);
  });
}
test('Air acceleration caps the wish-direction projection, not total speed', () => {
  const v = { x: 0, y: 250, z: 0 };
  accelerate(v, 1, 0, 250, 12, 1 / 64, 30);
  assert.equal(v.x, 30); assert.equal(v.y, 250); assert.ok(speed(v) > 250);
  accelerate(v, 1, 0, 250, 12, 1 / 64, 30); assert.equal(v.x, 30);
});
test('Swept hull stops high-speed movement from tunneling through a block', () => {
  const m = new Movement(); m.boxes = [{ id: 'wall', min: { x: -50, y: 0, z: -100 }, max: { x: 50, y: 20, z: 200 } }];
  m.position = { x: 0, y: -100, z: 20 }; m.velocity = { x: 0, y: 3500, z: 0 }; m.grounded = false; m.tickRate = 64;
  m.step(idle); m.step(idle);
  assert.ok(Math.abs(m.position.y - (-16 - DIST_EPSILON)) < 1e-9); assert.equal(m.velocity.y, 0);
});
test('A failed jump is never a personal-best eligible result', () => {
  const m = new Movement(280); m.position.y = 14; m.velocity.y = 250;
  let resultCalls = 0; m.onResult = () => resultCalls++;
  for (let t = 0; t < 256; t++) m.step({ ...idle, jump: t === 0 });
  assert.equal(resultCalls, 1); assert.equal(m.result?.valid, false);
});
test('Deadstrafe quarters the next tick\'s air acceleration after rising at 140 or less', () => {
  for (const [vertical, expected] of [[100, 11.71875], [200, 30], [-100, 30]]) {
    const m = new Movement(); m.tickRate = 64; m.position.z = 100; m.grounded = false;
    m.velocity = { x: 0, y: 250, z: vertical };
    m.step({ ...idle, side: 1 }); assert.equal(m.velocity.x, 30, 'the categorizing tick itself is unaffected');
    m.velocity.x = 0; m.step({ ...idle, side: 1 }); assert.equal(m.velocity.x, expected);
  }
});
test('Air duck is instant and raises the feet by 9 units, keeping the hull center fixed', () => {
  const m = new Movement(); m.position.z = 100; m.grounded = false; m.tickRate = 128;
  m.step({ ...idle, duck: true });
  const fall = (RULES.gravity / 128 / 2) / 128;
  assert.ok(Math.abs(m.position.z - (100 + 9 - fall)) < 1e-9);
  assert.equal(m.ducked, true); assert.equal(m.viewOffset, RULES.duckViewHeight);
  // Releasing in the air unducks at once, lowering the feet again.
  const z = m.position.z; m.step(idle); assert.equal(m.ducked, false); assert.ok(m.position.z < z - 8);
});
test('Ground duck follows duck speed (press penalty 2, recovery 3/s, x0.8); the crouched hull only applies when fully ducked', () => {
  const m = new Movement(); flat(m); m.tickRate = 128;
  let ticks = 0;
  while (!m.ducked) { m.step({ ...idle, duck: true }); ticks++; }
  // Pressing duck costs 2 duck speed (8 -> 6), which then recovers at 3/s while the duck amount rises.
  let duckSpeed = 6, amount = 0, expected = 0;
  while (amount < 1) { duckSpeed = Math.min(8, duckSpeed + 3 / 128); amount += duckSpeed * 0.8 / 128; expected++; }
  assert.equal(ticks, expected);
  assert.equal(m.viewOffset, RULES.duckViewHeight);
});
test('Mid-air duck cuts air acceleration to 34%', () => {
  for (const duck of [false, true]) {
    const m = new Movement(); m.tickRate = 64; m.position.z = 100; m.grounded = false; m.velocity = { x: 0, y: 250, z: -200 };
    m.step({ ...idle, duck }); m.velocity.x = 0;
    m.step({ ...idle, duck, side: 1 });
    assert.ok(Math.abs(m.velocity.x - Math.min(30, 12 * 250 * (duck ? 0.34 : 1) / 64)) < 1e-9);
  }
});
test('Jump stamina scales max speed by (1 - stamina/100)^2, reducing early air acceleration', () => {
  const m = new Movement(); flat(m); m.tickRate = 128; m.velocity.y = 250;
  m.step({ ...idle, jump: true });
  assert.ok(Math.abs(m.stamina - 0.08 * (RULES.jumpImpulse - RULES.gravity / 128 / 2)) < 1e-9);
  // CheckParameters scales max speed before ReduceTimers decays stamina.
  const scale = (1 - m.stamina / 100) ** 2;
  m.velocity.x = 0; m.step({ ...idle, side: 1 });
  assert.ok(Math.abs(m.velocity.x - 12 * 250 * scale / 128) < 1e-6);
});
test('Standing up on the ground needs headroom, like CanUnduck', () => {
  const m = new Movement(); flat(m);
  m.boxes.push({ id: 'ceiling', min: { x: -100, y: -100, z: 60 }, max: { x: 100, y: 100, z: 80 } });
  m.reset({ x: 0, y: 0, z: 0 });
  for (let t = 0; t < 40; t++) m.step({ ...idle, duck: true });
  assert.equal(m.ducked, true);
  for (let t = 0; t < 40; t++) m.step(idle);
  assert.equal(m.ducked, true, 'blocked by the 60-unit ceiling');
  m.boxes.pop(); for (let t = 0; t < 40; t++) m.step(idle);
  assert.equal(m.ducked, false); assert.equal(m.position.z, 0);
});
test('An in-place jump is measured, but is ineligible for a long-jump best', () => {
  const m = new Movement();
  for (let t = 0; t < 128; t++) m.step({ ...idle, jump: t === 0 });
  assert.equal(m.result?.landed, true); assert.equal(m.result?.distance, 32);
  assert.equal(m.result?.valid, false); assert.equal(m.result?.reason, 'Short jump');
});
