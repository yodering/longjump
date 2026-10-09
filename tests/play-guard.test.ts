import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayGuard } from '../src/play-guard.ts';

test('Tab close confirmation is active only during play, including without keyboard capture', () => {
  const target = new EventTarget();
  const guard = new PlayGuard(target as unknown as Window);
  const close = () => { const event = new Event('beforeunload', { cancelable: true }); target.dispatchEvent(event); return event.defaultPrevented; };
  assert.equal(close(), false);
  guard.setPlaying(true, false); assert.equal(close(), true);
  guard.setPlaying(false, false); assert.equal(close(), false);
});

test('Keyboard capture protects only W in fullscreen and releases it on pause', async () => {
  const calls: string[][] = []; let unlocks = 0;
  const guard = new PlayGuard(new EventTarget() as unknown as Window, {
    lock: async keys => { calls.push(keys); }, unlock: () => { unlocks++; },
  });
  guard.setPlaying(true, false); assert.deepEqual(calls, []);
  await guard.capture(true); assert.deepEqual(calls, [['KeyW']]);
  guard.setPlaying(false, true); assert.ok(unlocks >= 2);
});

test('A pending keyboard permission cannot retain a lock after pause; denial keeps close confirmation', async () => {
  let finish!: () => void, unlocks = 0;
  const target = new EventTarget();
  const guard = new PlayGuard(target as unknown as Window, {
    lock: () => new Promise<void>(resolve => { finish = resolve; }), unlock: () => { unlocks++; },
  });
  guard.setPlaying(true, true); guard.setPlaying(false, false);
  finish(); await Promise.resolve(); assert.equal(unlocks, 2);
  const denied = new PlayGuard(target as unknown as Window, { lock: async () => { throw new Error('denied'); }, unlock: () => {} });
  denied.setPlaying(true, true); await Promise.resolve();
  const event = new Event('beforeunload', { cancelable: true }); target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});
