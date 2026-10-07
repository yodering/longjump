import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Viewmodel } from '../src/viewmodel.ts';

test('Interrupted knife actions keep only one animation completion listener', () => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const listeners = new Set<unknown>();
  const add = mixer.addEventListener.bind(mixer), remove = mixer.removeEventListener.bind(mixer);
  mixer.addEventListener = (type, listener) => { listeners.add(listener); add(type, listener); };
  mixer.removeEventListener = (type, listener) => { listeners.delete(listener); remove(type, listener); };
  // Exercise the real animation mixer without creating a WebGL renderer or DOM fallback model.
  const viewmodel = Object.create(Viewmodel.prototype) as Viewmodel;
  const clips = new Map(['idle1', 'lookat01', 'light_miss1', 'light_miss2']
    .map(name => [name, new THREE.AnimationClip(name, 1, [])]));
  Object.assign(viewmodel, { current: { mixer, clips } });
  for (let i = 0; i < 100; i++) {
    viewmodel.play(i % 2 ? 'inspect' : 'light');
    mixer.update(0.01);
    assert.equal(listeners.size, 1);
  }
  mixer.update(2);
  assert.equal(listeners.size, 0);
  assert.equal(mixer.existingAction(clips.get('idle1')!)?.isRunning(), true);
});
