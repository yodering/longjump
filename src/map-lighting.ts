import type { Box, Vec } from './physics';
import type { ImportedMap, WorldLight } from './maps';

// Source's per-model light state, from a map's compiled lighting: the ambient cube interpolated from the
// samples in the eye's BSP leaf, the sun (emit_skylight) if the sky is visible, and the strongest visible
// point/spot light. Remaining lights are folded into the ambient cube (AddLightToLightCube). Source axes.
export type LightState = { ambient: number[][]; lights: { direction: Vec; color: number[] }[] };
const AXES: Vec[] = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
// Leaf ambient cubes are ColorRGBExp32 in 0..1 units (TexLightToLinear: c * 2^exponent); lightmaps are in 0..255 units.
const rgbe = (v: number) => { const scale = 2 ** ((v >>> 24) << 24 >> 24); return [(v & 255) * scale, (v >>> 8 & 255) * scale, (v >>> 16 & 255) * scale]; };

export class MapLighting {
  private view: DataView;
  private last: { position: Vec; state: LightState } | null = null;
  private lastAmbient: number[][] | null = null;
  private map: ImportedMap;
  constructor(map: ImportedMap) { this.map = map; this.view = new DataView(map.lightingSamples); }
  leaf(p: Vec) {
    const { nodes, planes, root } = this.map.lighting;
    let node = root;
    while (node >= 0) {
      const [plane, front, back] = nodes[node], [nx, ny, nz, d] = planes[plane];
      node = nx * p.x + ny * p.y + nz * p.z - d >= 0 ? front : back;
    }
    return -node - 1;
  }
  // Inverse-distance blend of the leaf's ambient samples.
  ambient(p: Vec) {
    const range = this.map.lighting.leafSamples[this.leaf(p)];
    if (!range) return null;
    const cube = AXES.map(() => [0, 0, 0]);
    let total = 0;
    for (let i = range[0]; i < range[0] + range[1]; i++) {
      const o = i * 30, dx = this.view.getInt16(o, true) - p.x, dy = this.view.getInt16(o + 2, true) - p.y, dz = this.view.getInt16(o + 4, true) - p.z;
      const weight = 1 / (Math.hypot(dx, dy, dz) + 1);
      total += weight;
      for (let side = 0; side < 6; side++) { const c = rgbe(this.view.getUint32(o + 6 + side * 4, true)); for (let k = 0; k < 3; k++) cube[side][k] += c[k] * weight; }
    }
    return total ? cube.map(c => c.map(v => v / total)) : null;
  }
  // Ray against the collision boxes; true if nothing blocks the segment.
  visible(from: Vec, to: Vec, boxes: Box[]) {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    for (const b of boxes) {
      let enter = 0, exit = 1, miss = false;
      for (const a of ['x', 'y', 'z'] as const) {
        if (d[a] === 0) { if (from[a] <= b.min[a] || from[a] >= b.max[a]) { miss = true; break; } continue; }
        const t1 = (b.min[a] - from[a]) / d[a], t2 = (b.max[a] - from[a]) / d[a];
        enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
        if (enter >= exit) { miss = true; break; }
      }
      if (!miss) return false;
    }
    return true;
  }
  state(p: Vec): LightState {
    // The state only changes with position; skip the work while the eye is still.
    if (this.last && Math.hypot(p.x - this.last.position.x, p.y - this.last.position.y, p.z - this.last.position.z) < 1) return this.last.state;
    const samples = this.ambient(p);
    if (samples) this.lastAmbient = samples;
    const ambient = this.lastAmbient?.map(side => [...side]) ?? AXES.map(() => [0, 0, 0]);
    const lights: LightState['lights'] = [], boxes = this.map.boxes;
    const sun = this.map.lighting.lights.find(l => l.type === 3);
    if (sun) {
      const toSun = { x: -sun.normal[0], y: -sun.normal[1], z: -sun.normal[2] };
      if (this.visible(p, { x: p.x + toSun.x * 16384, y: p.y + toSun.y * 16384, z: p.z + toSun.z * 16384 }, boxes)) lights.push({ direction: toSun, color: sun.intensity });
    }
    const local = this.map.lighting.lights.filter(l => l.type !== 3).map(l => ({ light: l, ...this.pointLight(l, p) }))
      .filter(l => l.amount > 0 && this.visible(p, l.target, boxes)).sort((a, b) => b.amount - a.amount);
    if (local[0]) lights.push({ direction: local[0].direction, color: local[0].color });
    for (const extra of local.slice(1)) AXES.forEach((axis, side) => {
      const facing = axis.x * extra.direction.x + axis.y * extra.direction.y + axis.z * extra.direction.z;
      if (facing > 0) for (let k = 0; k < 3; k++) ambient[side][k] += facing * extra.color[k];
    });
    const state = { ambient, lights };
    this.last = { position: { ...p }, state };
    return state;
  }
  // Engine falloff for emit_point / emit_spotlight: intensity / (c + l*d + q*d²), with the spot cone.
  private pointLight(l: WorldLight, p: Vec) {
    const delta = { x: l.origin[0] - p.x, y: l.origin[1] - p.y, z: l.origin[2] - p.z };
    const distance = Math.max(1, Math.hypot(delta.x, delta.y, delta.z)), direction = { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance };
    const [c, lin, q] = l.attenuation;
    let scale = 1 / Math.max(1e-6, c + lin * distance + q * distance * distance);
    if (l.type === 2) {
      const dot = -(direction.x * l.normal[0] + direction.y * l.normal[1] + direction.z * l.normal[2]);
      if (dot <= l.stopdot2) scale = 0;
      else if (dot < l.stopdot) scale *= Math.pow((dot - l.stopdot2) / (l.stopdot - l.stopdot2), l.exponent || 1);
    }
    const color = l.intensity.map(v => v * scale);
    // Stop the visibility ray short of the light so fixtures it sits inside do not occlude it.
    const target = { x: l.origin[0] - direction.x * 4, y: l.origin[1] - direction.y * 4, z: l.origin[2] - direction.z * 4 };
    return { color, direction, amount: color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11, target };
  }
}
