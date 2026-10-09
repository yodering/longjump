import test from 'node:test';
import assert from 'node:assert/strict';
import { Commands, lockMouse, type UserCommand } from '../src/commands.ts';
import { Controls, normalizeBindings } from '../src/bindings.ts';
import { Movement, speed } from '../src/physics.ts';

test('Source key fractions distinguish press, hold, release, tap and re-press', () => {
  const c = new Controls(normalizeBindings(null));
  c.down('KeyD'); assert.equal(c.tick(0).side, 0.5);
  assert.equal(c.tick(0).side, 1);
  c.up('KeyD'); assert.equal(c.tick(0).side, 0);
  c.down('KeyA'); c.up('KeyA'); assert.equal(c.tick(0).side, -0.25);
  c.down('KeyD'); c.tick(0);
  c.up('KeyD'); c.down('KeyD'); assert.equal(c.tick(0).side, 0.75);
  assert.equal(c.tick(0).side, 1);
});

test('Alternate movement bindings do not introduce false releases', () => {
  const bindings = normalizeBindings(null); bindings.right.push('ArrowRight');
  const c = new Controls(bindings);
  c.down('KeyD'); c.tick(0); c.down('ArrowRight'); c.up('KeyD');
  assert.equal(c.tick(0).side, 1);
});

test('Catch-up ticks receive only the buttons and yaw available at their timestamp', () => {
  const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
  c.button('down', 'KeyD', 17); c.look(0.1, 18);
  c.button('pulse', 'WheelDown', 27); c.look(0.2, 29);
  const ticks: UserCommand[] = [];
  c.advance(32, 128, input => ticks.push(input));
  assert.deepEqual(ticks.map(t => [t.side, t.yaw, t.jump]), [
    [0, 0, false], [0, 0, false], [0.5, 0.1, false], [1, 0.2, true],
  ]);
});

for (const tickRate of [64, 128] as const) {
  test(`${tickRate}t: pending Space/wheel jumps render before the next tick without consuming the command`, () => {
    for (const [kind, token] of [['down', 'Space'], ['pulse', 'WheelDown']] as const) {
      const m = new Movement(); m.tickRate = tickRate;
      const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
      c.button(kind, token, 1);
      c.advance(4, tickRate, input => m.step(input));
      assert.equal(m.jump, null);
      const before = JSON.stringify(m);
      const input = c.preview(4);
      assert.equal(input.jump, true); assert.equal(input.jumpPressed, true);
      assert.ok(m.renderEye(c.alpha, input).z > m.eye(1).z);
      assert.equal(JSON.stringify(m), before);
      assert.deepEqual(c.preview(4), input);
      c.advance(1000 / tickRate, tickRate, command => {
        assert.deepEqual(command, input); m.step(command);
      });
      assert.ok(m.jump);
    }
  });
}

test('Prediction uses pending axes/yaw but never future events or duplicate jump callbacks', () => {
  const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
  c.button('down', 'KeyD', 2); c.look(0.2, 3); c.button('pulse', 'WheelDown', 20);
  const preview = c.preview(4);
  assert.equal(preview.side, 0.5); assert.equal(preview.yaw, 0.2); assert.equal(preview.jump, false);
  const m = new Movement(); m.position.z = 1; m.grounded = false; m.velocity.z = -100;
  m.jump = { start: { ...m.position }, preSpeed: 250, maxSpeed: 250, ticks: 80, synced: 80,
    overlap: 0, deadAir: 0, height: 55, lastYaw: 0, strafes: [], path: [{ ...m.position }],
    startPlatform: m.platform, edge: 0, ducked: false, valid: true };
  let calls = 0; m.onResult = () => calls++;
  const before = JSON.stringify(m);
  m.renderEye(0.75, preview);
  assert.equal(calls, 0); assert.equal(JSON.stringify(m), before);
});

test('Current callback time accepts delivered input that the older rAF timestamp would defer', () => {
  const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
  c.button('pulse', 'WheelDown', 14);
  const commands: UserCommand[] = [];
  // A callback stamped 10 ms actually runs at 17 ms, after the input arrived.
  c.advance(17, 128, command => commands.push(command));
  assert.equal(commands.length, 2); assert.equal(commands[1].jump, true);
});

// A deterministic manual six-strafe command recording, including run-up,
// releasing W, changing A/D, wheel jump and a late duck. Feed browser events
// before each draw exactly as the real event handlers do.
function replay(tickRate: 64 | 128, frameDurations: number[]) {
  const m = new Movement(); m.tickRate = tickRate;
  m.boxes = [{ id: 'floor', min: { x: -2000, y: -2000, z: -100 }, max: { x: 2000, y: 2000, z: 0 } }];
  m.reset();
  const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
  const events: { at: number; run: () => void }[] = [];
  const button = (at: number, kind: 'down' | 'up' | 'pulse', key: string) => events.push({ at, run: () => c.button(kind, key, at) });
  button(0, 'down', 'KeyW'); button(1000, 'up', 'KeyW'); button(1000, 'pulse', 'WheelDown');
  for (let strafe = 0; strafe < 6; strafe++) {
    const key = strafe % 2 ? 'KeyD' : 'KeyA', start = 1000 + strafe * 125;
    button(start, 'down', key); button(start + 125, 'up', key);
    for (let sample = 0; sample < 25; sample++) {
      const at = start + sample * 5;
      const yaw = (strafe % 2 ? -1 + sample / 12 : 1 - sample / 12) * 0.18;
      events.push({ at, run: () => c.look(yaw, at) });
    }
  }
  button(1660, 'down', 'ControlLeft');
  events.sort((a, b) => a.at - b.at);
  const positions: number[][] = [], commands: UserCommand[] = [];
  let event = 0, frame = 0, now = 0;
  while (now < 2000) {
    now = Math.min(2000, now + frameDurations[frame++ % frameDurations.length]);
    while (event < events.length && events[event].at <= now) events[event++].run();
    c.advance(now, tickRate, input => {
      commands.push(input); m.step(input);
      positions.push([m.position.x, m.position.y, m.position.z, speed(m.velocity), m.stamina]);
    });
    m.renderEye(c.alpha, c.preview(now));
  }
  return { commands, positions, result: m.result };
}
for (const tickRate of [64, 128] as const) {
  test(`${tickRate}t: strafe trajectory and distance survive 30/60/144/240 FPS and uneven frames`, () => {
    const expected = replay(tickRate, [1000 / 240]);
    assert.equal(expected.positions.length, tickRate * 2);
    assert.ok(expected.result?.valid);
    assert.ok(expected.result.distance > 220);
    assert.equal(expected.result.strafes.length, 6);
    for (const durations of [[1000 / 30], [1000 / 60], [1000 / 144], [7, 22, 80, 4, 19, 11]]) {
      assert.deepEqual(replay(tickRate, durations), expected);
    }
  });
}

test('Pause/respawn flush pending impulses and prevent catch-up after a reset inside a tick', () => {
  const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
  c.button('pulse', 'WheelDown', 1); c.button('down', 'KeyW', 2);
  c.live.clear(); c.reset(100, 1);
  const inputs: UserCommand[] = [];
  c.advance(150, 128, input => { inputs.push(input); c.reset(150, 1); });
  assert.equal(inputs.length, 1); assert.equal(inputs[0].jump, false); assert.equal(inputs[0].forward, 0);
  c.advance(158, 128, input => inputs.push(input));
  assert.equal(inputs.length, 2); assert.equal(inputs[1].yaw, 1);
});

test('Long suspensions discard stale jump taps but keep held movement', () => {
  const c = new Commands(normalizeBindings(null)); c.reset(0, 0);
  c.button('down', 'KeyW', 10); c.button('pulse', 'WheelDown', 20);
  c.advance(1000, 128, () => assert.fail('suspension must not replay physics'));
  c.advance(1008, 128, input => { assert.equal(input.jump, false); assert.equal(input.forward, 1); });
});

test('Raw mouse input falls back only for unsupported browsers', async () => {
  const calls: unknown[] = [];
  await lockMouse({ requestPointerLock: async options => {
    calls.push(options); if (options) throw new DOMException('Raw input unsupported', 'NotSupportedError');
  } });
  assert.deepEqual(calls, [{ unadjustedMovement: true }, undefined]);
  calls.length = 0;
  await lockMouse({ requestPointerLock: async options => {
    calls.push(options); if (options) throw new DOMException('Platform cannot lock raw input', 'UnknownError');
  } });
  assert.deepEqual(calls, [{ unadjustedMovement: true }, undefined]);
  let count = 0;
  await assert.rejects(lockMouse({ requestPointerLock: async () => { count++; throw new DOMException('No focus', 'SecurityError'); } }));
  assert.equal(count, 1);
});
