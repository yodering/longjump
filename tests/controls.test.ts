import test from 'node:test';
import assert from 'node:assert/strict';
import { Controls, assignBinding, normalizeBindings } from '../src/bindings.ts';
import { Movement } from '../src/physics.ts';

test('LJ bind cancels forward/back until physical release and re-press, without changing side input', () => {
  const bindings = normalizeBindings(null); assignBinding(bindings, 'longJump', 'Mouse2');
  const controls = new Controls(bindings);
  controls.down('KeyW'); controls.down('KeyD');
  assert.equal(controls.tick(0).forward, 0.5);
  controls.down('Mouse2');
  const takeoff = controls.tick(0);
  assert.equal(takeoff.forward, 0); assert.equal(takeoff.side, 1);
  assert.equal(takeoff.jump, true); assert.equal(takeoff.duck, true); assert.equal(takeoff.lj, true);
  controls.up('Mouse2');
  assert.equal(controls.tick(0).jump, false); assert.equal(controls.snapshot(0).duck, false);
  assert.equal(controls.tick(0).forward, 0);
  controls.up('KeyW'); controls.down('KeyW'); assert.equal(controls.tick(0).forward, 0.5);
  assert.equal(bindings.heavy.length, 0);
});
test('Quick key, wheel and LJ taps survive until a physics tick; held keys never auto-bhop', () => {
  const bindings = normalizeBindings(null); assignBinding(bindings, 'longJump', 'KeyV');
  const controls = new Controls(bindings);
  controls.down('KeyW'); controls.down('KeyV'); controls.up('KeyV');
  const tap = controls.tick(0); assert.equal(tap.jump, true); assert.equal(tap.duck, true); assert.equal(tap.forward, 0);
  assert.equal(controls.tick(0).duck, false);
  controls.pulse('WheelDown'); assert.equal(controls.tick(0).jump, true); assert.equal(controls.tick(0).jump, false);
  controls.down('Space'); const movement = new Movement();
  let results = 0; movement.onResult = () => results++;
  for (let i = 0; i < 256; i++) movement.step(controls.tick(0));
  assert.equal(results, 1); assert.equal(movement.grounded, true);
});
test('Alternate bindings release independently and pause clears held, blocked and queued input', () => {
  const controls = new Controls(normalizeBindings(null));
  controls.down('ControlLeft'); controls.down('ControlRight'); controls.tick(0);
  controls.up('ControlLeft'); assert.equal(controls.tick(0).duck, true);
  controls.down('Space'); controls.clear(); assert.equal(controls.tick(0).duck, false); assert.equal(controls.tick(0).jump, false);
});

for (const tickRate of [64, 128]) {
  test(`${tickRate}t: a wheel notch on every command hops on every landing`, () => {
    // Browser wheel events arrive about once per frame, so every command can carry a notch.
    const controls = new Controls(normalizeBindings(null));
    const movement = new Movement(); movement.tickRate = tickRate;
    movement.boxes = [{ id: 'floor', min: { x: -2000, y: -2000, z: -100 }, max: { x: 2000, y: 2000, z: 0 } }];
    let takeoffs = 0, groundTicks = 0;
    for (let i = 0; i < tickRate * 3; i++) {
      const grounded = movement.grounded;
      controls.pulse('WheelDown'); movement.step(controls.tick(0));
      if (grounded && !movement.grounded) takeoffs++;
      if (grounded && movement.grounded) groundTicks++;
    }
    assert.ok(takeoffs > 3); assert.equal(groundTicks, 0);
    for (let i = 0; i < tickRate * 2; i++) movement.step(controls.tick(0));
    assert.equal(movement.grounded, true);
    assert.equal(movement.autoBhop, false);
    controls.pulse('WheelDown'); movement.step(controls.tick(0));
    assert.equal(movement.grounded, false);
  });
  test(`${tickRate}t: an airborne scroll does not buffer a hop, scrolling under held Space does not rearm it, and a re-press does`, () => {
    const controls = new Controls(normalizeBindings(null));
    const movement = new Movement(); movement.tickRate = tickRate;
    controls.pulse('WheelUp'); movement.step(controls.tick(0));
    controls.pulse('WheelUp'); movement.step(controls.tick(0));
    for (let i = 0; i < tickRate * 2; i++) movement.step(controls.tick(0));
    assert.equal(movement.grounded, true);
    controls.down('Space'); movement.step(controls.tick(0));
    assert.equal(movement.grounded, false);
    for (let i = 0; i < tickRate * 2; i++) {
      controls.pulse('WheelDown'); movement.step(controls.tick(0));
    }
    assert.equal(movement.grounded, true);
    controls.up('Space'); controls.down('Space'); movement.step(controls.tick(0));
    assert.equal(movement.grounded, false);
  });
}
test('Null binds let the newest strafe key win and resume the held one on release', () => {
  const controls = new Controls(normalizeBindings(null)); controls.nullBind = true;
  controls.down('KeyD'); assert.equal(controls.tick(0).side, 0.5); assert.equal(controls.tick(0).side, 1);
  controls.down('KeyA');
  // The same tick sees D released and A pressed, as the alias script's -moveright; +moveleft.
  const swap = controls.tick(0); assert.equal(swap.side, -0.5); assert.equal(swap.overlap, false);
  assert.equal(controls.tick(0).side, -1);
  controls.up('KeyA'); assert.equal(controls.tick(0).side, 0.5); assert.equal(controls.tick(0).side, 1);
  // Releasing the overridden key does nothing; the active one keeps moving.
  controls.down('KeyA'); controls.tick(0); controls.up('KeyD'); assert.equal(controls.tick(0).side, -1);
  assert.equal(controls.fork().nullBind, true);
});
test('Without null binds, both strafe keys cancel out as overlap', () => {
  const controls = new Controls(normalizeBindings(null));
  controls.down('KeyD'); controls.down('KeyA'); controls.tick(0);
  const both = controls.tick(0); assert.equal(both.side, 0); assert.equal(both.overlap, true);
});
