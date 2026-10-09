import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RULES } from './physics';
import type { RoomPose } from './room';

// Remote players are drawn about this far in the past so motion between the
// 20 Hz snapshots can be interpolated instead of stepping.
export const INTERPOLATION_DELAY_MS = 100;
const MAX_EXTRAPOLATE_MS = 100, SNAP_DISTANCE = 256, LABEL_DISTANCE = 4000;
// Locomotion blending (units/s): below MOVING_SPEED a player stands; WALK_SPEED..RUN_SPEED crossfades walk to run.
const MOVING_SPEED = 40, WALK_SPEED = 110, RUN_SPEED = 170, BLEND_RATE = 10;
const DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
type Team = 'ct' | 't';
type Snapshot = { at: number; p: THREE.Vector3; v: THREE.Vector3; yaw: number; duck: number; grounded: boolean; team: Team };
type Rig = { model: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; speeds: Record<string, number>; team: Team };
type Blend = { moving: number; running: number; crouch: number; air: number; land: number; airTime: number; wasGrounded: boolean };
type Actor = { root: THREE.Group; stand: THREE.Mesh; label: THREE.Sprite; name: string; snapshots: Snapshot[]; rig: Rig | null; loading: Team | null; blend: Blend };

// Source units (x right, y forward, z up) to three.js (x right, y up, -z forward).
const toThree = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1]);
const standMaterial = new THREE.MeshLambertMaterial({ color: '#d8d6cc' });
const standGeometry = new THREE.CapsuleGeometry(RULES.hull, RULES.height - 2 * RULES.hull, 6, 16);
const models = new Map<Team, Promise<GLTF>>();
// Loaded only once someone is in a room, so solo practice never downloads player models.
const playerModel = (team: Team) => {
  if (!models.has(team)) models.set(team, new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}players/player_${team}.glb`));
  return models.get(team)!;
};

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

function rig(gltf: GLTF, team: Team): Rig {
  // Each actor needs its own skeleton; geometry, materials and textures stay shared.
  const model = cloneSkinned(gltf.scene);
  model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; });
  const mixer = new THREE.AnimationMixer(model), actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    if (/^(jump|land_)/.test(clip.name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    action.setEffectiveWeight(0).play(); actions.set(clip.name, action);
  }
  return { model, mixer, actions, speeds: (gltf.scene.userData.groundSpeed ?? {}) as Record<string, number>, team };
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
    this.actors.set(id, { root, stand, label: tag, name, snapshots: [], rig: null, loading: null,
      blend: { moving: 0, running: 0, crouch: 0, air: 0, land: 0, airTime: 0, wasGrounded: true } });
  }
  private ensureRig(actor: Actor, team: Team) {
    if (actor.rig?.team === team || actor.loading === team) return;
    actor.loading = team;
    playerModel(team).then(gltf => {
      if (actor.loading !== team || !this.group.children.includes(actor.root)) return;
      if (actor.rig) { actor.root.remove(actor.rig.model); actor.rig.mixer.stopAllAction(); }
      actor.rig = rig(gltf, team); actor.root.add(actor.rig.model); actor.stand.visible = false; actor.loading = null;
    }, error => { console.warn('Player model failed to load', error); if (actor.loading === team) actor.loading = null; });
  }
  private disposeLabel(sprite: THREE.Sprite) { sprite.material.map?.dispose(); sprite.material.dispose(); }
  private remove(id: string, actor: Actor) {
    this.group.remove(actor.root); this.disposeLabel(actor.label); this.actors.delete(id);
    if (actor.rig) { actor.rig.mixer.stopAllAction(); actor.rig.mixer.uncacheRoot(actor.rig.model); }
  }
  clear() { for (const [id, actor] of this.actors) this.remove(id, actor); this.offsets = []; }
  /** Forgets positions, e.g. after a map change, so nobody slides across the new map. */
  forgetPositions() { for (const actor of this.actors.values()) { actor.snapshots = []; actor.root.visible = false; } }

  receive(at: number, poses: RoomPose[], now: number) {
    // Clock offset from the fastest recent delivery; slower packets just arrive late.
    this.offsets.push(now - at); if (this.offsets.length > 60) this.offsets.shift();
    for (const pose of poses) {
      const actor = this.actors.get(pose.id); if (!actor) continue;
      const snapshot = { at, p: toThree(pose.p), v: toThree(pose.v), yaw: pose.yaw, duck: pose.d, grounded: pose.g, team: pose.m === 't' ? 't' as const : 'ct' as const };
      const last = actor.snapshots.at(-1);
      if (pose.r || (last && last.p.distanceTo(snapshot.p) > SNAP_DISTANCE)) actor.snapshots = [];
      actor.snapshots.push(snapshot);
      if (actor.snapshots.length > 20) actor.snapshots.shift();
      this.ensureRig(actor, snapshot.team);
    }
  }

  update(now: number, camera: THREE.Camera) {
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastUpdate || now)) / 1000)); this.lastUpdate = now;
    if (!this.offsets.length) return;
    const renderAt = now - Math.min(...this.offsets) - INTERPOLATION_DELAY_MS;
    for (const actor of this.actors.values()) {
      const s = actor.snapshots; if (!s.length) continue;
      while (s.length > 2 && s[1].at <= renderAt) s.shift();
      let position: THREE.Vector3, velocity: THREE.Vector3, yaw: number, duck: number, grounded: boolean;
      if (s.length > 1 && renderAt >= s[0].at && renderAt <= s[1].at) {
        const t = (renderAt - s[0].at) / Math.max(1, s[1].at - s[0].at);
        position = s[0].p.clone().lerp(s[1].p, t); velocity = s[0].v.clone().lerp(s[1].v, t); duck = s[0].duck + (s[1].duck - s[0].duck) * t;
        const turn = Math.atan2(Math.sin(s[1].yaw - s[0].yaw), Math.cos(s[1].yaw - s[0].yaw)); yaw = s[0].yaw + turn * t;
        grounded = t < 0.5 ? s[0].grounded : s[1].grounded;
      } else {
        // Before the first or after the last snapshot: hold, with a short velocity extrapolation.
        const latest = renderAt < s[0].at ? s[0] : s[s.length - 1], ahead = Math.min(MAX_EXTRAPOLATE_MS, Math.max(0, renderAt - latest.at)) / 1000;
        position = latest.p.clone().addScaledVector(latest.v, ahead); velocity = latest.v.clone(); yaw = latest.yaw; duck = latest.duck; grounded = latest.grounded;
      }
      // The origin is at the feet; the body faces the view yaw (Source forward is three's -z at yaw 0).
      actor.root.position.copy(position); actor.root.rotation.y = -yaw; actor.root.visible = true;
      const height = RULES.height - (RULES.height - RULES.duckHeight) * duck;
      actor.stand.scale.y = height / RULES.height; actor.stand.position.y = height / 2;
      actor.label.position.y = height + 10;
      actor.label.visible = camera.position.distanceTo(position) < LABEL_DISTANCE;
      if (actor.rig) this.animate(actor, actor.rig, velocity, yaw, duck, grounded, dt);
    }
  }

  /** Weights CS:GO's baked knife clips from speed, direction relative to the view, crouch and air state. */
  private animate(actor: Actor, rig: Rig, velocity: THREE.Vector3, yaw: number, duck: number, grounded: boolean, dt: number) {
    const b = actor.blend, approach = (from: number, to: number) => from + (to - from) * Math.min(1, dt * BLEND_RATE);
    const speed = Math.hypot(velocity.x, velocity.z);
    // Movement direction relative to facing: 0 = forward, 90 = right (three's forward is (sin yaw, -cos yaw)).
    const forward = velocity.x * Math.sin(yaw) - velocity.z * Math.cos(yaw), right = velocity.x * Math.cos(yaw) + velocity.z * Math.sin(yaw);
    const sector = ((Math.atan2(right, forward) * 180 / Math.PI + 360) % 360) / 45, low = Math.floor(sector) % 8, high = (low + 1) % 8, mix = sector - Math.floor(sector);
    b.moving = approach(b.moving, Math.min(1, speed / MOVING_SPEED));
    b.running = approach(b.running, Math.min(1, Math.max(0, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED))));
    b.crouch = approach(b.crouch, duck);
    if (!grounded && b.wasGrounded) { b.airTime = 0; rig.actions.get('jump')?.reset().play(); }
    if (grounded && !b.wasGrounded && b.airTime > 0.25) { b.land = 1; rig.actions.get('land_light')?.reset().play(); }
    b.wasGrounded = grounded; b.airTime += dt;
    b.air = approach(b.air, grounded ? 0 : 1); b.land = Math.max(0, b.land - dt * 1.5);
    const ground = (1 - b.air) * (1 - b.land * 0.6), stand = 1 - b.crouch;
    const set = (name: string, weight: number, timeScale = 1) => { const a = rig.actions.get(name); if (a) { a.setEffectiveWeight(weight); a.timeScale = timeScale; } };
    set('idle', ground * stand * (1 - b.moving));
    set('crouch_idle', ground * b.crouch * (1 - b.moving));
    for (const [kind, weight] of [['walk', stand * (1 - b.running)], ['run', stand * b.running], ['crouch', b.crouch]] as const) {
      const lowName = `${kind}_${DIRECTIONS[low]}`, highName = `${kind}_${DIRECTIONS[high]}`;
      // Play the cycle at the speed its feet cover the ground.
      const native = (rig.speeds[lowName] ?? 150) * (1 - mix) + (rig.speeds[highName] ?? 150) * mix;
      const rate = Math.min(2, Math.max(0.5, speed / native));
      for (const direction of DIRECTIONS) set(`${kind}_${direction}`, 0, rate);
      set(lowName, ground * b.moving * weight * (1 - mix), rate); set(highName, ground * b.moving * weight * mix, rate);
    }
    const airWeight = b.air * (1 - b.land * 0.6);
    set('jump', airWeight * Math.max(0, 1 - b.airTime / 0.45)); set('fall', airWeight * Math.min(1, b.airTime / 0.45));
    set('land_light', b.land * 0.6); set('land_heavy', 0);
    rig.mixer.update(dt);
  }
}
