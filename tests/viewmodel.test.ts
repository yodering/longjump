import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Viewmodel } from '../src/viewmodel.ts';
import { viewPresets } from '../src/settings.ts';

test('Viewmodel preferences update its projection and offsets independently of the world camera', () => {
  const viewmodel = Object.create(Viewmodel.prototype) as Viewmodel;
  const holder = new THREE.Group();
  Object.assign(viewmodel, { camera: new THREE.PerspectiveCamera(60, 4 / 3), root: new THREE.Group(), holder,
    bobTime: 0, lastSpeed: 0, lastFacing: null, current: null });
  const preference = { ...viewPresets.classic };
  viewmodel.configure(preference); preference.x = 0;
  viewmodel.resize(16 / 9);
  const expected = 2 * Math.atan(Math.tan(68 * Math.PI / 360) * 0.75) * 180 / Math.PI;
  assert.equal(viewmodel.camera.aspect, 16 / 9); assert.equal(viewmodel.camera.fov, expected);
  viewmodel.update({ speed: 0, grounded: true, yaw: 0, pitch: 0, dt: 1 / 60, leftHand: true });
  assert.equal(holder.position.x, 2.5); assert.equal(holder.position.y, -1.5); assert.equal(Math.abs(holder.position.z), 0);
  assert.equal(viewmodel.root.scale.x, -1);
});

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

test('Reset clears viewmodel motion from a moving, turned pose before rendering the spawn', () => {
  Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 });
  const model = new Viewmodel(), fresh = new Viewmodel();
  const state = { speed: 250, grounded: true, yaw: 1.5, pitch: 0.4, dt: 1 / 60, leftHand: false };
  for (let i = 0; i < 60; i++) model.update(state);
  model.resetMotion();
  const spawn = { ...state, speed: 0, yaw: 0, pitch: 0 };
  model.update(spawn); fresh.update(spawn);
  assert.deepEqual(model.root.children[0].position.toArray(), fresh.root.children[0].position.toArray());
  assert.deepEqual(model.root.children[0].quaternion.toArray(), fresh.root.children[0].quaternion.toArray());
});
