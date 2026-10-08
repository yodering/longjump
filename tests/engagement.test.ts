import test from 'node:test';
import assert from 'node:assert/strict';
import { Engagement, type EventData } from '../src/engagement.ts';
import type { Result } from '../src/physics.ts';

const context = { map: 'longjump_source_go', tick_rate: 64, auto_bhop: false };
function session() {
  let time = 0;
  const events: { name: string; data: EventData }[] = [];
  const engagement = new Engagement((name, data) => events.push({ name, data }), context, () => time);
  return { engagement, events, advance: (ms: number) => { time += ms; } };
}
test('Engagement counts active playtime in deltas, excludes pauses and starts once per page', () => {
  const { engagement, events, advance } = session();
  engagement.mapLoaded(); advance(10_000); engagement.flush();
  engagement.setPlaying(true); advance(30_000); engagement.flush();
  advance(5000); engagement.setPlaying(false); engagement.setPlaying(false);
  advance(60_000); engagement.flush();
  engagement.setPlaying(true); engagement.setPlaying(true); advance(2000); engagement.setPlaying(false);
  assert.equal(events.filter(event => event.name === 'play_started').length, 1);
  assert.deepEqual(events.filter(event => event.name === 'playtime').map(event => event.data.active_seconds), [30, 5, 2]);
});
test('Map and physics changes flush playtime against the old settings before updating events', () => {
  const { engagement, events, advance } = session();
  engagement.mapLoaded(); engagement.setPlaying(true); advance(1000);
  const next = { map: 'kz_longjumps_go', tick_rate: 128, auto_bhop: true };
  engagement.configure(next); engagement.mapLoaded(); advance(1000); engagement.flush();
  assert.deepEqual(events[2], { name: 'playtime', data: { ...context, active_seconds: 1 } });
  assert.deepEqual(events[3], { name: 'map_changed', data: next });
  assert.deepEqual(events[4], { name: 'playtime', data: { ...next, active_seconds: 1 } });
});
test('Jump engagement reports useful stats only while playing, without paths or local history', () => {
  const { engagement, events } = session();
  const result = { distance: 246.32345, sync: 91.222, strafes: [{}, {}], landed: true, valid: true,
    path: [{ x: 0, y: 0, z: 0 }] } as Result;
  engagement.jumpCompleted(result); assert.equal(events.length, 0);
  engagement.setPlaying(true); engagement.jumpCompleted(result);
  assert.deepEqual(events[1], { name: 'jump_completed', data: { ...context, distance: 246.32, sync: 91.2,
    strafes: 2, landed: true, valid: true } });
});
test('Analytics failures never stop gameplay state or active-time accounting', () => {
  let time = 0;
  const engagement = new Engagement(() => { throw new Error('blocked'); }, context, () => time);
  assert.doesNotThrow(() => {
    engagement.mapLoaded(); engagement.setPlaying(true); time += 1000; engagement.flush(); engagement.setPlaying(false);
  });
});
