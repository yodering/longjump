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
