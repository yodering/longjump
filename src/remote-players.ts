import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RULES, type Vec } from './physics';
import type { LightState } from './map-lighting';
import { applyLighting, createLighting, sourcePhongMaterial, type Lighting, type SourcePhong } from './source-phong';
import type { RoomPose } from './room';

// Remote players are drawn about this far in the past so motion between the
// 20 Hz snapshots can be interpolated instead of stepping.
export const INTERPOLATION_DELAY_MS = 100;
const MAX_EXTRAPOLATE_MS = 100, SNAP_DISTANCE = 256, LABEL_DISTANCE = 4000;
// Locomotion blending (units/s): below MOVING_SPEED a player stands; WALK_SPEED..RUN_SPEED crossfades walk to run.
const MOVING_SPEED = 40, WALK_SPEED = 110, RUN_SPEED = 170, BLEND_RATE = 10;
// CS:GO keeps the feet within 58 degrees of the view and twists the upper body the rest of the way.
const MAX_BODY_TWIST = 58 * Math.PI / 180, AIM_YAW_RANGE = 60 * Math.PI / 180, AIM_PITCH_RANGE = Math.PI / 2;
const LEAN_ACCELERATION = 1500, LIGHT_REFRESH_MS = 300;
const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'], LEANS = ['n', 'e', 's', 'w'];
// Reference poses applied on top of the blended clips, and the base pose each is measured from.
const ADDITIVE: Record<string, string> = { aim_up: 'idle', aim_down: 'idle', aim_left: 'idle', aim_right: 'idle',
  crouch_aim_up: 'crouch_idle', crouch_aim_down: 'crouch_idle', crouch_aim_left: 'crouch_idle', crouch_aim_right: 'crouch_idle',
  lean_n: 'idle', lean_e: 'idle', lean_s: 'idle', lean_w: 'idle', alive: 'idle' };
type Team = 'ct' | 't';
type Snapshot = { at: number; p: THREE.Vector3; v: THREE.Vector3; yaw: number; pitch: number; duck: number; grounded: boolean; team: Team };
type Prepared = { gltf: GLTF; materials: Map<string, { params: SourcePhong; base: THREE.Texture; normal: THREE.Texture | null; normalScale: THREE.Vector2; masks: THREE.Texture }> };
type Rig = { model: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; speeds: Record<string, number>; team: Team; materials: THREE.Material[] };
type Motion = { moving: number; running: number; crouch: number; air: number; land: number; airTime: number; wasGrounded: boolean;
  feetYaw: number | null; stillTime: number; lastVelocity: THREE.Vector3 | null; acceleration: THREE.Vector3 };
type Actor = { root: THREE.Group; stand: THREE.Mesh; label: THREE.Sprite; name: string; snapshots: Snapshot[]; rig: Rig | null; loading: Team | null;
  motion: Motion; lighting: Lighting; light: { state: LightState | null; at: number; position: THREE.Vector3 | null } };

// Source units (x right, y forward, z up) to three.js (x right, y up, -z forward).
const toThree = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1]);
const toSource = (p: THREE.Vector3): Vec => ({ x: p.x, y: -p.z, z: p.y });
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const standMaterial = new THREE.MeshLambertMaterial({ color: '#d8d6cc' });
const standGeometry = new THREE.CapsuleGeometry(RULES.hull, RULES.height - 2 * RULES.hull, 6, 16);
const models = new Map<Team, Promise<Prepared>>();

/** Turns a pose clip into a difference from its base pose (bones missing from the base use their rest pose). */
function makeAdditive(clip: THREE.AnimationClip, base: THREE.AnimationClip, scene: THREE.Object3D) {
  const inverse = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.'), node = scene.getObjectByName(track.name.slice(0, dot)), property = track.name.slice(dot + 1);
    const reference = base.tracks.find(t => t.name === track.name), size = track.getValueSize(), values = track.values;
    if (property === 'quaternion') {
      if (reference) inverse.fromArray(reference.values, 0); else if (node) inverse.copy(node.quaternion); else continue;
      inverse.invert();
      const ref = inverse.toArray();
      const flat = values as unknown as number[];
      for (let i = 0; i < values.length; i += size) THREE.Quaternion.multiplyQuaternionsFlat(flat, i, ref, 0, flat, i);
    } else if (property === 'position') {
      const ref = reference ? Array.from(reference.values.slice(0, 3)) : node ? node.position.toArray() : null;
      if (!ref) continue;
      for (let i = 0; i < values.length; i += size) for (let k = 0; k < 3; k++) values[i + k] -= ref[k];
    }
  }
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
}

// Loaded only once someone is in a room, so solo practice never downloads player models.
function playerModel(team: Team) {
  if (!models.has(team)) models.set(team, new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}players/player_${team}.glb`).then(async gltf => {
    const materials: Prepared['materials'] = new Map();
    const meshes: THREE.Mesh[] = []; gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    for (const mesh of meshes) {
      const original = mesh.material as THREE.MeshStandardMaterial, params = original.userData.source as SourcePhong | undefined;
      if (!params || !original.map || materials.has(original.name)) continue;
      const masks: THREE.Texture = await gltf.parser.getDependency('texture', params.maskTexture);
      materials.set(original.name, { params, base: original.map, normal: original.normalMap, normalScale: original.normalScale, masks });
    }
    const clips = new Map(gltf.animations.map(c => [c.name, c]));
    for (const [name, base] of Object.entries(ADDITIVE)) { const clip = clips.get(name), reference = clips.get(base); if (clip && reference) makeAdditive(clip, reference, gltf.scene); }
    return { gltf, materials };
  }));
  return models.get(team)!;
}

function label(name: string) {
  const canvas = document.createElement('canvas'), c = canvas.getContext('2d')!, font = getComputedStyle(document.documentElement).getPropertyValue('--font-ui') || 'sans-serif';
  c.font = `600 40px ${font}`;
  canvas.width = Math.ceil(c.measureText(name).width) + 32; canvas.height = 60;
  c.font = `600 40px ${font}`; c.textBaseline = 'middle';
  c.fillStyle = 'rgba(17, 17, 17, 0.6)'; c.beginPath(); c.roundRect(0, 0, canvas.width, canvas.height, 12); c.fill();
  c.fillStyle = '#ffffff'; c.fillText(name, 16, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  // Constant screen size, drawn over walls so friends are easy to find.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  sprite.scale.set(0.028 * canvas.width / canvas.height, 0.028, 1); sprite.renderOrder = 1000; sprite.center.set(0.5, 0);
  return sprite;
}

function rig(prepared: Prepared, team: Team, lighting: Lighting): Rig {
  // Each actor needs its own skeleton and its own lit materials; geometry and textures stay shared.
  const model = cloneSkinned(prepared.gltf.scene), materials: THREE.Material[] = [];
  model.traverse(o => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.frustumCulled = false;
    const source = prepared.materials.get((o.material as THREE.Material).name);
    if (source) { o.material = sourcePhongMaterial(source.params, source.base, source.normal, source.normalScale, source.masks, lighting); materials.push(o.material); }
  });
  const mixer = new THREE.AnimationMixer(model), actions = new Map<string, THREE.AnimationAction>();
  for (const clip of prepared.gltf.animations) {
    const action = mixer.clipAction(clip);
    if (/^(jump|land_)/.test(clip.name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    action.setEffectiveWeight(0).play(); actions.set(clip.name, action);
  }
  return { model, mixer, actions, speeds: (prepared.gltf.scene.userData.groundSpeed ?? {}) as Record<string, number>, team, materials };
}

export class RemotePlayers {
  group = new THREE.Group();
  private actors = new Map<string, Actor>();
  private offsets: number[] = [];
  private lastUpdate = 0;

  /** Adds and removes actors to match the room roster (excluding this player). */
  sync(players: Map<string, string>, you: string | null) {
    for (const [id, actor] of this.actors) if (!players.has(id) || id === you) this.remove(id, actor);
    for (const [id, name] of players) {
      if (id === you) continue;
      const actor = this.actors.get(id);
      if (!actor) this.add(id, name);
      else if (actor.name !== name) { actor.root.remove(actor.label); this.disposeLabel(actor.label); actor.label = label(name); actor.name = name; actor.root.add(actor.label); }
    }
  }
  private add(id: string, name: string) {
    // A capsule stands in until the player model has loaded (or if it fails to).
    const root = new THREE.Group(), stand = new THREE.Mesh(standGeometry, standMaterial), tag = label(name);
    stand.position.y = RULES.height / 2; root.add(stand, tag); root.visible = false;
    this.group.add(root);
    this.actors.set(id, { root, stand, label: tag, name, snapshots: [], rig: null, loading: null, lighting: createLighting(),
      light: { state: null, at: -Infinity, position: null },
      motion: { moving: 0, running: 0, crouch: 0, air: 0, land: 0, airTime: 0, wasGrounded: true, feetYaw: null, stillTime: 0, lastVelocity: null, acceleration: new THREE.Vector3() } });
  }
  private ensureRig(actor: Actor, team: Team) {
    if (actor.rig?.team === team || actor.loading === team) return;
    actor.loading = team;
    playerModel(team).then(prepared => {
      if (actor.loading !== team || !this.group.children.includes(actor.root)) return;
      if (actor.rig) this.disposeRig(actor);
      actor.rig = rig(prepared, team, actor.lighting); actor.root.add(actor.rig.model); actor.stand.visible = false; actor.loading = null;
    }, error => { console.warn('Player model failed to load', error); if (actor.loading === team) actor.loading = null; });
  }
  private disposeRig(actor: Actor) {
    const r = actor.rig!; actor.root.remove(r.model); r.mixer.stopAllAction(); r.mixer.uncacheRoot(r.model);
    for (const material of r.materials) material.dispose();
    actor.rig = null;
  }
  private disposeLabel(sprite: THREE.Sprite) { sprite.material.map?.dispose(); sprite.material.dispose(); }
  private remove(id: string, actor: Actor) {
    this.group.remove(actor.root); this.disposeLabel(actor.label); this.actors.delete(id);
    if (actor.rig) this.disposeRig(actor);
  }
  clear() { for (const [id, actor] of this.actors) this.remove(id, actor); this.offsets = []; }
  /** Forgets positions, e.g. after a map change, so nobody slides across the new map. */
  forgetPositions() { for (const actor of this.actors.values()) { actor.snapshots = []; actor.root.visible = false; actor.light.position = null; } }

  receive(at: number, poses: RoomPose[], now: number) {
    // Clock offset from the fastest recent delivery; slower packets just arrive late.
    this.offsets.push(now - at); if (this.offsets.length > 60) this.offsets.shift();
    for (const pose of poses) {
      const actor = this.actors.get(pose.id); if (!actor) continue;
      const snapshot = { at, p: toThree(pose.p), v: toThree(pose.v), yaw: pose.yaw, pitch: pose.pitch, duck: pose.d, grounded: pose.g,
        team: pose.m === 't' ? 't' as const : 'ct' as const };
      const last = actor.snapshots.at(-1);
      if (pose.r || (last && last.p.distanceTo(snapshot.p) > SNAP_DISTANCE)) { actor.snapshots = []; actor.motion.feetYaw = null; actor.motion.lastVelocity = null; }
      actor.snapshots.push(snapshot);
      if (actor.snapshots.length > 20) actor.snapshots.shift();
      this.ensureRig(actor, snapshot.team);
    }
  }

  /** camera: this frame's view; lightAt: the map's compiled light state at a Source position (null in the concrete room). */
  update(now: number, camera: THREE.Camera, lightAt: (p: Vec) => LightState | null = () => null) {
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastUpdate || now)) / 1000)); this.lastUpdate = now;
    if (!this.offsets.length) return;
    const renderAt = now - Math.min(...this.offsets) - INTERPOLATION_DELAY_MS;
    for (const actor of this.actors.values()) {
      const s = actor.snapshots; if (!s.length) continue;
      while (s.length > 2 && s[1].at <= renderAt) s.shift();
      let position: THREE.Vector3, velocity: THREE.Vector3, yaw: number, pitch: number, duck: number, grounded: boolean;
      if (s.length > 1 && renderAt >= s[0].at && renderAt <= s[1].at) {
        const t = (renderAt - s[0].at) / Math.max(1, s[1].at - s[0].at);
        position = s[0].p.clone().lerp(s[1].p, t); velocity = s[0].v.clone().lerp(s[1].v, t); duck = s[0].duck + (s[1].duck - s[0].duck) * t;
        yaw = s[0].yaw + wrap(s[1].yaw - s[0].yaw) * t; pitch = s[0].pitch + (s[1].pitch - s[0].pitch) * t;
        grounded = t < 0.5 ? s[0].grounded : s[1].grounded;
      } else {
        // Before the first or after the last snapshot: hold, with a short velocity extrapolation.
        const latest = renderAt < s[0].at ? s[0] : s[s.length - 1], ahead = Math.min(MAX_EXTRAPOLATE_MS, Math.max(0, renderAt - latest.at)) / 1000;
        position = latest.p.clone().addScaledVector(latest.v, ahead); velocity = latest.v.clone(); yaw = latest.yaw; pitch = latest.pitch; duck = latest.duck; grounded = latest.grounded;
      }
      const m = actor.motion, speed = Math.hypot(velocity.x, velocity.z);
      // Feet follow the view while moving; standing still they stay put until the view turns past
      // the body twist limit, then square up after a moment, as CS:GO's goal feet yaw does.
      if (m.feetYaw === null) m.feetYaw = yaw;
      m.stillTime = speed > 10 ? 0 : m.stillTime + dt;
      const turnRate = speed > 10 ? 4 + speed / 60 : m.stillTime > 1.2 && Math.abs(wrap(yaw - m.feetYaw)) > 0.6 ? 2 : 0;
      const toView = wrap(yaw - m.feetYaw);
      m.feetYaw += Math.sign(toView) * Math.min(Math.abs(toView), turnRate * dt);
      const twist = wrap(yaw - m.feetYaw);
      if (Math.abs(twist) > MAX_BODY_TWIST) m.feetYaw = yaw - Math.sign(twist) * MAX_BODY_TWIST;
      actor.root.position.copy(position); actor.root.rotation.y = -m.feetYaw; actor.root.visible = true;
      const height = RULES.height - (RULES.height - RULES.duckHeight) * duck;
      actor.stand.scale.y = height / RULES.height; actor.stand.position.y = height / 2;
      actor.label.position.y = height + 10;
      actor.label.visible = camera.position.distanceTo(position) < LABEL_DISTANCE;
      if (!actor.rig) continue;
      // Light the model where it stands, sampled at chest height and refreshed as it moves.
      const l = actor.light;
      if (!l.position || l.position.distanceTo(position) > 8 || now - l.at > LIGHT_REFRESH_MS) {
        const source = toSource(position); source.z += height / 2;
        l.state = lightAt(source); l.at = now; l.position = position.clone();
      }
      applyLighting(actor.lighting, l.state, camera.quaternion);
      this.animate(actor.rig, m, velocity, yaw, pitch, duck, grounded, dt);
    }
  }

  /** Weights CS:GO's baked knife clips from speed, direction, crouch and air state, then adds aim, lean and idle layers. */
  private animate(rig: Rig, m: Motion, velocity: THREE.Vector3, yaw: number, pitch: number, duck: number, grounded: boolean, dt: number) {
    const approach = (from: number, to: number) => from + (to - from) * Math.min(1, dt * BLEND_RATE);
    const set = (name: string, weight: number, timeScale = 1) => { const a = rig.actions.get(name); if (a) { a.setEffectiveWeight(weight); a.timeScale = timeScale; } };
    const feet = m.feetYaw ?? yaw, speed = Math.hypot(velocity.x, velocity.z);
    // Directions relative to the body: 0 = forward, 90 = right (three's forward is (sin yaw, -cos yaw)).
    const local = (v: THREE.Vector3) => ({ forward: v.x * Math.sin(feet) - v.z * Math.cos(feet), right: v.x * Math.cos(feet) + v.z * Math.sin(feet) });
    const blend8 = (angle: number, names: string[]) => {
      const sector = ((angle * 180 / Math.PI + 360) % 360) / (360 / names.length), low = Math.floor(sector) % names.length;
      return { low: names[low], high: names[(low + 1) % names.length], mix: sector - Math.floor(sector) };
    };
    const move = local(velocity), dir = blend8(Math.atan2(move.right, move.forward), DIRECTIONS);
    m.moving = approach(m.moving, Math.min(1, speed / MOVING_SPEED));
    m.running = approach(m.running, clamp01((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
    m.crouch = approach(m.crouch, duck);
    if (!grounded && m.wasGrounded) { m.airTime = 0; rig.actions.get('jump')?.reset().play(); }
    if (grounded && !m.wasGrounded && m.airTime > 0.25) { m.land = 1; rig.actions.get('land_light')?.reset().play(); }
    m.wasGrounded = grounded; m.airTime += dt;
    m.air = approach(m.air, grounded ? 0 : 1); m.land = Math.max(0, m.land - dt * 1.5);
    const ground = (1 - m.air) * (1 - m.land * 0.6), stand = 1 - m.crouch;
    set('idle', ground * stand * (1 - m.moving));
    set('crouch_idle', ground * m.crouch * (1 - m.moving));
    for (const [kind, weight] of [['walk', stand * (1 - m.running)], ['run', stand * m.running], ['crouch', m.crouch]] as const) {
      const lowName = `${kind}_${dir.low}`, highName = `${kind}_${dir.high}`;
      // Play the cycle at the speed its feet cover the ground.
      const native = (rig.speeds[lowName] ?? 150) * (1 - dir.mix) + (rig.speeds[highName] ?? 150) * dir.mix;
      const rate = Math.min(2, Math.max(0.5, speed / native));
      for (const direction of DIRECTIONS) set(`${kind}_${direction}`, 0, rate);
      set(lowName, ground * m.moving * weight * (1 - dir.mix), rate); set(highName, ground * m.moving * weight * dir.mix, rate);
    }
    const airWeight = m.air * (1 - m.land * 0.6);
    set('jump', airWeight * Math.max(0, 1 - m.airTime / 0.45)); set('fall', airWeight * Math.min(1, m.airTime / 0.45));
    set('land_light', m.land * 0.6); set('land_heavy', 0);
    // Upper-body aim: pitch (positive looks up) and the twist between the view and the body.
    const up = clamp01(pitch / AIM_PITCH_RANGE), down = clamp01(-pitch / AIM_PITCH_RANGE), twist = wrap(yaw - feet);
    const right = clamp01(twist / AIM_YAW_RANGE), left = clamp01(-twist / AIM_YAW_RANGE);
    for (const [prefix, amount] of [['', stand], ['crouch_', m.crouch]] as const) {
      set(`${prefix}aim_up`, up * amount); set(`${prefix}aim_down`, down * amount);
      set(`${prefix}aim_right`, right * amount); set(`${prefix}aim_left`, left * amount);
    }
    // Lean into acceleration on the ground, smoothed so snapshot jitter does not shake the hips.
    if (m.lastVelocity && dt > 0) m.acceleration.lerp(velocity.clone().sub(m.lastVelocity).divideScalar(dt), Math.min(1, dt * 6));
    m.lastVelocity = velocity.clone();
    const accel = local(m.acceleration), lean = blend8(Math.atan2(accel.right, accel.forward), LEANS);
    const leanAmount = (1 - m.air) * clamp01(Math.hypot(accel.forward, accel.right) / LEAN_ACCELERATION);
    for (const direction of LEANS) set(`lean_${direction}`, 0);
    set(`lean_${lean.low}`, leanAmount * (1 - lean.mix)); set(`lean_${lean.high}`, leanAmount * lean.mix);
    set('alive', 1 - m.air * 0.5);
    rig.mixer.update(dt);
  }
}
