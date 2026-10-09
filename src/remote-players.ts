import * as THREE from 'three';
import { RULES } from './physics';
import type { RoomPose } from './room';

// Remote players are drawn about this far in the past so motion between the
// 20 Hz snapshots can be interpolated instead of stepping.
export const INTERPOLATION_DELAY_MS = 100;
const MAX_EXTRAPOLATE_MS = 100, SNAP_DISTANCE = 256, LABEL_DISTANCE = 4000;
type Snapshot = { at: number; p: THREE.Vector3; v: THREE.Vector3; yaw: number; duck: number };
type Actor = { root: THREE.Group; body: THREE.Mesh; visor: THREE.Mesh; label: THREE.Sprite; name: string; snapshots: Snapshot[] };

// Source units (x right, y forward, z up) to three.js (x right, y up, -z forward).
const toThree = (p: [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1]);
const bodyMaterial = new THREE.MeshLambertMaterial({ color: '#d8d6cc' });
const visorMaterial = new THREE.MeshLambertMaterial({ color: '#3b3f3a' });
const bodyGeometry = new THREE.CapsuleGeometry(RULES.hull, RULES.height - 2 * RULES.hull, 6, 16);
const visorGeometry = new THREE.BoxGeometry(14, 6, 10);

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

export class RemotePlayers {
  group = new THREE.Group();
  private actors = new Map<string, Actor>();
  private offsets: number[] = [];

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
    const root = new THREE.Group(), body = new THREE.Mesh(bodyGeometry, bodyMaterial), visor = new THREE.Mesh(visorGeometry, visorMaterial), tag = label(name);
    root.add(body, visor, tag); root.visible = false;
    this.group.add(root); this.actors.set(id, { root, body, visor, label: tag, name, snapshots: [] });
  }
  private disposeLabel(sprite: THREE.Sprite) { sprite.material.map?.dispose(); sprite.material.dispose(); }
  private remove(id: string, actor: Actor) { this.group.remove(actor.root); this.disposeLabel(actor.label); this.actors.delete(id); }
  clear() { for (const [id, actor] of this.actors) this.remove(id, actor); this.offsets = []; }
  /** Forgets positions, e.g. after a map change, so nobody slides across the new map. */
  forgetPositions() { for (const actor of this.actors.values()) { actor.snapshots = []; actor.root.visible = false; } }

  receive(at: number, poses: RoomPose[], now: number) {
    // Clock offset from the fastest recent delivery; slower packets just arrive late.
    this.offsets.push(now - at); if (this.offsets.length > 60) this.offsets.shift();
    for (const pose of poses) {
      const actor = this.actors.get(pose.id); if (!actor) continue;
      const snapshot = { at, p: toThree(pose.p), v: toThree(pose.v), yaw: pose.yaw, duck: pose.d };
      const last = actor.snapshots.at(-1);
      if (pose.r || (last && last.p.distanceTo(snapshot.p) > SNAP_DISTANCE)) actor.snapshots = [];
      actor.snapshots.push(snapshot);
      if (actor.snapshots.length > 20) actor.snapshots.shift();
    }
  }

  update(now: number, camera: THREE.Camera) {
    if (!this.offsets.length) return;
    const renderAt = now - Math.min(...this.offsets) - INTERPOLATION_DELAY_MS;
    for (const actor of this.actors.values()) {
      const s = actor.snapshots; if (!s.length) continue;
      while (s.length > 2 && s[1].at <= renderAt) s.shift();
      let position: THREE.Vector3, yaw: number, duck: number;
      if (s.length > 1 && renderAt >= s[0].at && renderAt <= s[1].at) {
        const t = (renderAt - s[0].at) / Math.max(1, s[1].at - s[0].at);
        position = s[0].p.clone().lerp(s[1].p, t); duck = s[0].duck + (s[1].duck - s[0].duck) * t;
        const turn = Math.atan2(Math.sin(s[1].yaw - s[0].yaw), Math.cos(s[1].yaw - s[0].yaw)); yaw = s[0].yaw + turn * t;
      } else {
        // Before the first or after the last snapshot: hold, with a short velocity extrapolation.
        const latest = renderAt < s[0].at ? s[0] : s[s.length - 1], ahead = Math.min(MAX_EXTRAPOLATE_MS, Math.max(0, renderAt - latest.at)) / 1000;
        position = latest.p.clone().addScaledVector(latest.v, ahead); yaw = latest.yaw; duck = latest.duck;
      }
      // The origin is at the feet; crouching shortens the hull from 72 to 54 units.
      const height = RULES.height - (RULES.height - RULES.duckHeight) * duck;
      actor.body.scale.y = height / RULES.height; actor.body.position.y = height / 2;
      actor.visor.position.set(Math.sin(yaw) * 13, height - 12, -Math.cos(yaw) * 13); actor.visor.rotation.y = -yaw;
      actor.label.position.y = height + 10;
      actor.root.position.copy(position); actor.root.visible = true;
      actor.label.visible = camera.position.distanceTo(position) < LABEL_DISTANCE;
    }
  }
}
