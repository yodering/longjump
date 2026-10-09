import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lighting, sourcePhongMaterial, type SourcePhong } from './source-phong.ts';
import type { LightState } from './map-lighting';
import { viewPresets, type ViewSettings } from './settings.ts';

// CS:GO's default knife viewmodels (converted by scripts/import_viewmodels.py), drawn in their own scene
// over the world like a Source viewmodel. View space: x = right, y = up, -z = forward, in Source units.
export type Team = 'ct' | 't';
export type ViewAction = 'draw' | 'inspect' | 'light' | 'heavy';
export type ViewState = { speed: number; grounded: boolean; yaw: number; pitch: number; dt: number; leftHand: boolean };
// CS:GO defaults: viewmodel_presetpos 1 ("Desktop") sets viewmodel_fov 60 and offsets x 1, y 1, z -1.
// cl_bob* defaults from weapon_csbase.cpp; a 250-speed knife gives a 0.21 s bob cycle.
const BOB_UP = 0.5;
type V3 = [number, number, number];
const DEG = Math.PI / 180;
// Source AngleVectors (pitch, yaw, roll in degrees; x forward, y left, z up).
function angleVectors(pitch: number, yaw: number, roll: number) {
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(pitch * DEG), Math.cos(pitch * DEG), Math.sin(yaw * DEG), Math.cos(yaw * DEG), Math.sin(roll * DEG), Math.cos(roll * DEG)];
  const forward: V3 = [cp * cy, cp * sy, -sp];
  const right: V3 = [-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp];
  const up: V3 = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  return { forward, right, up };
}
const ma = (a: V3, s: number, b: V3): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function bobCycle(time: number, period: number) {
  const cycle = (time - Math.trunc(time / period) * period) / period;
  return cycle < BOB_UP ? Math.PI * cycle / BOB_UP : Math.PI + Math.PI * (cycle - BOB_UP) / (1 - BOB_UP);
}
const CLIPS: Record<ViewAction, string[]> = { draw: ['draw'], inspect: ['lookat01'], light: ['light_miss1', 'light_miss2'], heavy: ['heavy_miss1'] };

// Light state for the concrete room, which has no compiled lighting, matched to its browser sun.
const SUN_DIRECTION = new THREE.Vector3(-500, 1100, 350).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.95, 0.84).multiplyScalar(1.6);
const AMBIENT_CUBE = [[0.24, 0.25, 0.25], [0.2, 0.21, 0.21], [0.42, 0.46, 0.47], [0.1, 0.1, 0.09], [0.22, 0.23, 0.23], [0.22, 0.23, 0.23]]
  .map(([r, g, b]) => new THREE.Color(r, g, b));

type Loaded = { root: THREE.Object3D; mixer: THREE.AnimationMixer; clips: Map<string, THREE.AnimationClip>;
  finished?: (event: { action: THREE.AnimationAction }) => void };

// Hand-built stand-in shown while the converted model loads, or if it cannot load.
function fallback() {
  const model = new THREE.Group();
  const glove = new THREE.MeshStandardMaterial({ color: '#1d1f1e', roughness: 0.75 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced1', metalness: 0.35, roughness: 0.32 });
  const hand = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.9, 3.6), glove); hand.position.set(0.2, -0.25, -0.6); model.add(hand);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 9), steel); blade.position.set(0.1, 0.9, -6); blade.rotation.x = 0.32; model.add(blade);
  model.position.set(6.2, -6.4, -13.5);
  return model;
}

export class Viewmodel {
  settings: ViewSettings = { ...viewPresets.desktop };
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
  root = new THREE.Group();
  team: Team = 'ct';
  private holder = new THREE.Group();
  private stand = fallback();
  private models = new Map<Team, Promise<Loaded | null>>();
  private current: Loaded | null = null;
  private idle: THREE.AnimationAction | null = null;
  private bobTime = 0; private lastSpeed = 0; private lastFacing: V3 | null = null;
  constructor() {
    this.scene.add(new THREE.HemisphereLight('#f0f4f2', '#3a3f38', 1.4));
    const key = new THREE.DirectionalLight('#fff3d6', 2.2); key.position.set(-4, 8, 6); this.scene.add(key);
    this.holder.add(this.stand);
    this.root.add(this.holder); this.scene.add(this.root);
  }
  private load(team: Team) {
    if (!this.models.has(team)) this.models.set(team, new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}viewmodels/knife_${team}.glb`).then(async gltf => {
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.frustumCulled = false; meshes.push(o); } });
      // Swap the glTF materials for Source's phong shader, using the VMT constants exported with each material.
      for (const mesh of meshes) {
        const original = mesh.material as THREE.MeshStandardMaterial, params = original.userData.source as SourcePhong | undefined;
        if (!params || !original.map) continue;
        const masks: THREE.Texture = await gltf.parser.getDependency('texture', params.maskTexture);
        mesh.material = sourcePhongMaterial(params, original.map, original.normalMap, original.normalScale, masks);
        original.dispose();
      }
      return { root: gltf.scene, mixer: new THREE.AnimationMixer(gltf.scene), clips: new Map(gltf.animations.map(c => [c.name, c])) };
    }).catch(error => { console.error('Viewmodel failed to load', error); return null; }));
    return this.models.get(team)!;
  }
  async setTeam(team: Team) {
    this.team = team;
    const loaded = await this.load(team);
    if (!loaded || this.team !== team) return;
    this.holder.clear(); this.holder.add(loaded.root);
    this.current = loaded; this.idle = null;
    this.play('draw');
  }
  // Plays a one-shot sequence, then returns to idle1 like ACT_VM_IDLE.
  play(action: ViewAction) {
    const model = this.current;
    if (!model) return;
    const options = CLIPS[action], clip = model.clips.get(options[Math.floor(Math.random() * options.length)]);
    const idleClip = model.clips.get('idle1');
    if (!clip || !idleClip) return;
    if (model.finished) model.mixer.removeEventListener('finished', model.finished);
    model.mixer.stopAllAction();
    const once = model.mixer.clipAction(clip); once.reset().setLoop(THREE.LoopOnce, 1); once.clampWhenFinished = true; once.play();
    const finished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== once) return;
      model.mixer.removeEventListener('finished', finished);
      model.finished = undefined;
      this.idle = model.mixer.clipAction(idleClip); this.idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      this.idle.crossFadeFrom(once, 0.1, false);
    };
    model.finished = finished;
    model.mixer.addEventListener('finished', finished);
  }
  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.fov = 2 * Math.atan(Math.tan(this.settings.fov * Math.PI / 360) * 0.75) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }
  configure(settings: ViewSettings) { this.settings = { ...settings }; this.resize(this.camera.aspect); }
  // Teleports have no continuous velocity or facing history to trail behind.
  resetMotion() { this.bobTime = 0; this.lastSpeed = 0; this.lastFacing = null; }
  // CBaseViewModel::CalcViewModelView with CS:GO's CalcViewModelBobHelper / AddViewModelBobHelper and CalcViewModelLag.
  // yaw/pitch are the game's (radians, positive yaw turns right, positive pitch looks up); speed is horizontal.
  update({ speed, grounded, yaw, pitch, dt, leftHand }: ViewState) {
    this.current?.mixer.update(dt);
    if (dt <= 0) return;
    const eye = { pitch: -pitch / DEG, yaw: -yaw / DEG };
    const view = angleVectors(eye.pitch, eye.yaw, 0);
    // Offsets along the original eye vectors.
    let origin: V3 = [0, 0, 0];
    origin = ma(origin, this.settings.y, view.forward); origin = ma(origin, this.settings.z, view.up); origin = ma(origin, this.settings.x, view.right);
    // CalcViewModelBobHelper: speed changes are rate-limited, then drive a 0.21 s cycle.
    const limit = dt * 640;
    const s = Math.max(-320, Math.min(320, Math.max(this.lastSpeed - limit, Math.min(this.lastSpeed + limit, speed))));
    this.lastSpeed = s;
    const cycle = (1000 - 250) / 3.5 * 0.001 * this.settings.bobCycle;
    const runLower = this.settings.bobLower * 0.2 * (s * 0.006);
    this.bobTime += dt * (s / 320);
    const multiplier = grounded ? 0.00625 : 0.00125;
    let vertical = s * multiplier * this.settings.bobVert;
    vertical = vertical * 0.3 + vertical * 0.7 * Math.sin(bobCycle(this.bobTime, cycle));
    vertical = Math.max(-7, Math.min(4, vertical - runLower));
    let lateral = s * multiplier * this.settings.bobLat;
    lateral = Math.max(-8, Math.min(8, lateral * 0.3 + lateral * 0.7 * Math.sin(bobCycle(this.bobTime, cycle * 2))));
    // AddViewModelBobHelper
    const angles = { pitch: eye.pitch - vertical * 0.4, yaw: eye.yaw - lateral * 0.3, roll: vertical * 0.5 };
    origin = ma(origin, vertical * 0.4, view.forward); origin[2] += vertical * 0.1; origin = ma(origin, lateral * 0.2, view.right);
    // CalcViewModelLag: the model trails changes in facing, then a pitch-dependent shift.
    const forward = angleVectors(angles.pitch, angles.yaw, angles.roll).forward;
    if (!this.lastFacing) this.lastFacing = forward;
    const diff: V3 = [forward[0] - this.lastFacing[0], forward[1] - this.lastFacing[1], forward[2] - this.lastFacing[2]];
    const magnitude = Math.hypot(...diff), rate = 5 * (magnitude > 1.5 ? magnitude / 1.5 : 1);
    const facing = ma(this.lastFacing, rate * dt, diff), n = Math.hypot(...facing) || 1;
    this.lastFacing = [facing[0] / n, facing[1] / n, facing[2] / n];
    origin = ma(origin, -5, diff);
    origin = ma(origin, -eye.pitch * 0.035, view.forward); origin = ma(origin, -eye.pitch * 0.03, view.right); origin = ma(origin, -eye.pitch * 0.02, view.up);
    // Into camera space: three.js x = right, y = up, -z = forward.
    this.holder.position.set(dot3(origin, view.right), dot3(origin, view.up), -dot3(origin, view.forward));
    const vm = angleVectors(angles.pitch, angles.yaw, angles.roll);
    const toCamera = (v: V3) => new THREE.Vector3(dot3(v, view.right), dot3(v, view.up), -dot3(v, view.forward));
    this.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toCamera(vm.right), toCamera(vm.up), toCamera(vm.forward).negate()));
    // cl_righthand 0 mirrors the viewmodel.
    this.root.scale.x = leftHand ? -1 : 1;
  }
  // camera: the world camera's rotation, so lights stay fixed in the world as the view turns.
  // state: the map's compiled light state at the eye (Source axes), or null for the concrete room.
  render(renderer: THREE.WebGLRenderer, camera: THREE.Quaternion, state: LightState | null) {
    const toView = camera.clone().invert();
    if (state) {
      // Source (x, y, z) -> three.js (x, z, -y); cube sides reorder to +x -x +y -y +z -z on three.js axes.
      [0, 1, 4, 5, 3, 2].forEach((side, i) => lighting.ambientCube.value[i].setRGB(...state.ambient[side] as [number, number, number]));
      for (let i = 0; i < 2; i++) {
        const light = state.lights[i];
        if (light) {
          lighting.lightDir.value[i].set(light.direction.x, light.direction.z, -light.direction.y).normalize().applyQuaternion(toView);
          lighting.lightColor.value[i].setRGB(...light.color as [number, number, number]);
        } else lighting.lightColor.value[i].setRGB(0, 0, 0);
      }
      // LDR lightmaps are 2x overbright in gamma space: linear lighting x 2^1.2 matches the map surfaces.
      lighting.lightScale.value = Math.pow(2, 1.2);
    } else {
      lighting.lightDir.value[0].copy(SUN_DIRECTION).applyQuaternion(toView);
      lighting.lightColor.value[0].copy(SUN_COLOR); lighting.lightColor.value[1].setRGB(0, 0, 0);
      AMBIENT_CUBE.forEach((c, i) => lighting.ambientCube.value[i].copy(c));
      lighting.lightScale.value = 1;
    }
    lighting.viewToWorld.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(camera));
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
