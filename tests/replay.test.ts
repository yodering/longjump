import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReplay, verifyReplay } from '../src/replay.ts';
import { flat, idle, recordJump as record } from './jump-fixture.ts';

for (const tickRate of [64, 128] as const) {
  test(`${tickRate}t: a recorded jump replays to the identical result`, () => {
    const { result, replay } = record(tickRate);
    assert.ok(result.valid, result.reason);
    const again = verifyReplay(parseReplay(JSON.parse(JSON.stringify(replay))), flat);
    assert.equal(again.distance, result.distance); assert.equal(again.valid, true); assert.equal(again.ticks, result.ticks);
  });
}

test('Tampered or truncated replays are rejected or produce their own distance', () => {
  const { result, replay } = record(128);
  const copy = () => parseReplay(JSON.parse(JSON.stringify(replay)));
  const faster = copy(); faster.state.velocity.y = 3000;
  // A forged run-up is capped at takeoff and changes the flight, so the recorded commands no longer fit it.
  try { assert.ok(verifyReplay(faster, flat).preSpeed <= 275 + 1e-9); } catch (error) { assert.match(String(error), /ends before|continues after/); }
  const floating = copy(); floating.state.position.z += 1.5;
  assert.throws(() => verifyReplay(floating, flat), /solid ground/);
  const airborne = copy(); airborne.state.grounded = false;
  assert.throws(() => verifyReplay(airborne, flat), /solid ground/);
  const rising = copy(); rising.state.velocity.z = 200;
  assert.throws(() => verifyReplay(rising, flat), /solid ground/);
  const short = copy(); short.inputs = short.inputs.slice(0, -1);
  assert.throws(() => verifyReplay(short, flat), /ends before/);
  const long = copy(); long.inputs.push({ ...idle });
  assert.throws(() => verifyReplay(long, flat), /continues after/);
  const late = copy(); late.inputs.unshift({ ...idle, forward: 1 });
  assert.throws(() => verifyReplay(late, flat), /takeoff tick/);
  const steered = copy(); steered.inputs = steered.inputs.map(i => ({ ...i, side: 0 }));
  assert.notEqual(verifyReplay(steered, flat).distance, result.distance);
  // Auto-hop or other client flags cannot be smuggled through the replay.
  const hopping = copy(); hopping.state.jumpHeld = true;
  assert.throws(() => verifyReplay(hopping, flat), /takeoff tick/);
});

test('Malformed replay data is rejected before simulation', () => {
  const { replay } = record(64);
  const bad = (change: (r: Record<string, any>) => void) => { const r = JSON.parse(JSON.stringify(replay)); change(r); return () => parseReplay(r); };
  assert.throws(bad(r => { r.tickRate = 100; }));
  assert.throws(bad(r => { r.inputs[0].forward = 0.3; }));
  assert.throws(bad(r => { r.inputs[0].yaw = 'x'; }));
  assert.throws(bad(r => { r.state.stamina = 500; }));
  assert.throws(bad(r => { r.state.position.x = null; }));
  assert.throws(bad(r => { r.inputs = Array.from({ length: 64 * 3 + 1 }, () => idle); }));
  assert.throws(bad(r => { r.inputs = []; }));
});
