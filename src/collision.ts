// Whole-map collision for imported competitive maps: axial brush boxes, bevelled convex brushes (other brushes and
// static prop hulls) and displacement triangles, read from collision.bin (written by scripts/import_full_map.py).
// The player's hull is swept against them as the engine does: boxes with the same slab test as physics.ts, brushes
// with CM_ClipBoxToBrush (cmodel.cpp) on planes pushed out by the hull, and triangles as that clip against their
// separating-axis planes (face, axes and edge x axis bevels), which is the hull's Minkowski sum with the triangle.
// Results never depend on the order the grid returns primitives: the nearest hit wins, then the lowest primitive.
export type Vec3 = { x: number; y: number; z: number };
export type WorldHit = { fraction: number; normal: Vec3; startsolid: boolean; allsolid: boolean; id: string };

// Engine DIST_EPSILON (also in physics.ts): traces stop this far short of a surface.
const EPSILON = 0.03125;
const CELL = 256;
const BOX = 0, BRUSH = 1, TRIANGLE = 2;

export class CollisionWorld {
  readonly min: Vec3; readonly max: Vec3;
  private boxes: Float32Array; private brushes: Uint32Array; private brushBounds: Float32Array;
  private planes: Float32Array; private triangles: Float32Array; private triangleBounds: Float32Array;
  private cellStart: Int32Array; private cellItems: Int32Array; private columns: number; private rows: number;
  private stamp: Uint32Array; private tick = 0;
  private scratch = new Float64Array(26 * 4);

  constructor(buffer: ArrayBuffer) {
    const header = new DataView(buffer);
    if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'LJC1') throw new Error('Unrecognised collision data');
    const [boxes, brushes, planes, triangles] = [4, 8, 12, 16].map(o => header.getUint32(o, true));
    let offset = 20;
    const take = <T>(make: (o: number, n: number) => T, count: number, bytes: number) => { const value = make(offset, count); offset += count * bytes; return value; };
    this.boxes = take((o, n) => new Float32Array(buffer, o, n), boxes * 6, 4);
    this.brushes = take((o, n) => new Uint32Array(buffer, o, n), brushes * 2, 4);
    this.brushBounds = take((o, n) => new Float32Array(buffer, o, n), brushes * 6, 4);
    this.planes = take((o, n) => new Float32Array(buffer, o, n), planes * 4, 4);
    this.triangles = take((o, n) => new Float32Array(buffer, o, n), triangles * 9, 4);
    this.triangleBounds = new Float32Array(triangles * 6);
    for (let t = 0; t < triangles; t++) for (let a = 0; a < 3; a++) {
      const v = [0, 1, 2].map(k => this.triangles[t * 9 + k * 3 + a]);
      this.triangleBounds[t * 6 + a] = Math.min(...v); this.triangleBounds[t * 6 + 3 + a] = Math.max(...v);
    }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const each = (fn: (type: number, index: number, bounds: Float32Array, at: number) => void) => {
      for (let i = 0; i < boxes; i++) fn(BOX, i, this.boxes, i * 6);
      for (let i = 0; i < brushes; i++) fn(BRUSH, i, this.brushBounds, i * 6);
      for (let i = 0; i < triangles; i++) fn(TRIANGLE, i, this.triangleBounds, i * 6);
    };
    each((_, __, b, o) => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b[o + a]); hi[a] = Math.max(hi[a], b[o + 3 + a]); } });
    this.min = { x: lo[0], y: lo[1], z: lo[2] }; this.max = { x: hi[0], y: hi[1], z: hi[2] };
    // A column grid over x/y in compressed rows: cellStart[c]..cellStart[c + 1] index cellItems.
    this.columns = Math.max(1, Math.ceil((hi[0] - lo[0]) / CELL) + 1); this.rows = Math.max(1, Math.ceil((hi[1] - lo[1]) / CELL) + 1);
    const counts = new Int32Array(this.columns * this.rows + 1);
    const cells = (b: Float32Array, o: number, fn: (cell: number) => void) => {
      const [x0, y0] = this.cell(b[o], b[o + 1]), [x1, y1] = this.cell(b[o + 3], b[o + 4]);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * this.columns + x);
    };
    each((_, __, b, o) => cells(b, o, c => counts[c + 1]++));
    for (let c = 0; c < counts.length - 1; c++) counts[c + 1] += counts[c];
    this.cellStart = counts; this.cellItems = new Int32Array(counts[counts.length - 1]);
    const fill = counts.slice(0, -1);
    each((type, index, b, o) => cells(b, o, c => { this.cellItems[fill[c]++] = type << 28 | index; }));
    this.stamp = new Uint32Array(boxes + brushes + triangles);
  }

  get counts() { return { boxes: this.boxes.length / 6, brushes: this.brushes.length / 2, triangles: this.triangles.length / 9 }; }

  private cell(x: number, y: number): [number, number] {
    return [Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.min.x) / CELL))), Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.min.y) / CELL)))];
  }

  /** Sweeps a hull with feet at `start` (x/y half-width `half`, `height` tall) to `end`. */
  trace(start: Vec3, end: Vec3, half: number, height: number): WorldHit | null {
    const lo = [Math.min(start.x, end.x) - half - 1, Math.min(start.y, end.y) - half - 1, Math.min(start.z, end.z) - 1];
    const hi = [Math.max(start.x, end.x) + half + 1, Math.max(start.y, end.y) + half + 1, Math.max(start.z, end.z) + height + 1];
    if (hi[0] < this.min.x || lo[0] > this.max.x || hi[1] < this.min.y || lo[1] > this.max.y || hi[2] < this.min.z || lo[2] > this.max.z) return null;
    const [x0, y0] = this.cell(lo[0], lo[1]), [x1, y1] = this.cell(hi[0], hi[1]);
    if (++this.tick === 0xffffffff) { this.stamp.fill(0); this.tick = 1; }
    const best: WorldHit & { key: number } = { fraction: 1, normal: { x: 0, y: 0, z: 0 }, startsolid: false, allsolid: false, id: '', key: Infinity };
    const offsets = [0, this.boxes.length / 6, this.boxes.length / 6 + this.brushes.length / 2];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = y * this.columns + x;
      for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
        const item = this.cellItems[k], type = item >>> 28, index = item & 0xfffffff, key = offsets[type] + index;
        if (this.stamp[key] === this.tick) continue;
        this.stamp[key] = this.tick;
        const bounds = type === BOX ? this.boxes : type === BRUSH ? this.brushBounds : this.triangleBounds;
        const o = index * 6;
        if (bounds[o] > hi[0] || bounds[o + 3] < lo[0] || bounds[o + 1] > hi[1] || bounds[o + 4] < lo[1] || bounds[o + 2] > hi[2] || bounds[o + 5] < lo[2]) continue;
        if (type === BOX) this.clipBox(index, start, end, half, height, key, best);
        else if (type === BRUSH) this.clipPlanes(this.planes, this.brushes[index * 2] * 4, this.brushes[index * 2 + 1], start, end, half, height, key, best, 'b');
        else { const count = this.trianglePlanes(index); if (count) this.clipPlanes(this.scratch, 0, count, start, end, half, height, key, best, 't'); }
      }
    }
    if (best.key === Infinity && !best.startsolid) return null;
    return { fraction: best.fraction, normal: best.normal, startsolid: best.startsolid, allsolid: best.allsolid, id: best.id };
  }

  // The same Minkowski slab test physics.ts uses for map boxes (IntersectRayWithBoxBrush's contact plane choice).
  private clipBox(index: number, start: Vec3, end: Vec3, half: number, height: number, key: number, best: WorldHit & { key: number }) {
    const b = this.boxes, o = index * 6;
    const lo = [b[o] - half, b[o + 1] - half, b[o + 2] - height], hi = [b[o + 3] + half, b[o + 4] + half, b[o + 5]];
    const s = [start.x, start.y, start.z], d = [end.x - start.x, end.y - start.y, end.z - start.z];
    const inside = (q: number[]) => q.every((v, a) => v > lo[a] && v < hi[a]);
    if (inside(s)) {
      best.startsolid = true;
      if (inside([end.x, end.y, end.z])) this.take(best, 0, { x: 0, y: 0, z: 0 }, key, `x${index}`, true);
      return;
    }
    let enter = -Infinity, exit = Infinity, rawEnter = -Infinity, rawExit = Infinity, axis = 0, sign = 0;
    for (let a = 0; a < 3; a++) {
      if (d[a] === 0) { if (s[a] <= lo[a] || s[a] >= hi[a]) return; continue; }
      const t1 = (lo[a] - s[a]) / d[a], t2 = (hi[a] - s[a]) / d[a];
      const first = Math.min(t1, t2), last = Math.max(t1, t2);
      rawEnter = Math.max(rawEnter, first); rawExit = Math.min(rawExit, last);
      if (first < 0 && last > 1) continue;
      const epsilon = EPSILON / Math.abs(d[a]);
      if (first - epsilon > enter) { enter = first - epsilon; axis = a; sign = d[a] > 0 ? -1 : 1; }
      exit = Math.min(exit, last + epsilon);
    }
    if (rawEnter > rawExit || rawExit <= 0 || rawEnter > 1 || rawEnter < 0 || enter > exit) return;
    const normal = { x: 0, y: 0, z: 0 }; normal[(['x', 'y', 'z'] as const)[axis]] = sign;
    this.take(best, Math.max(0, enter), normal, key, `x${index}`, false);
  }

  // CM_ClipBoxToBrush with the hull's extents folded into each plane distance.
  private clipPlanes(planes: Float32Array | Float64Array, first: number, count: number, start: Vec3, end: Vec3, half: number, height: number,
    key: number, best: WorldHit & { key: number }, prefix: string) {
    const h = height / 2, sz = start.z + h, ez = end.z + h;
    let enter = -99999, leave = 1, startout = false, getout = false, clip = -1;
    for (let p = first; p < first + count * 4; p += 4) {
      const nx = planes[p], ny = planes[p + 1], nz = planes[p + 2];
      const dist = planes[p + 3] + Math.abs(nx) * half + Math.abs(ny) * half + Math.abs(nz) * h;
      const d1 = start.x * nx + start.y * ny + sz * nz - dist, d2 = end.x * nx + end.y * ny + ez * nz - dist;
      if (d2 > 0) getout = true;
      if (d1 > 0) startout = true;
      if (d1 > 0 && d2 >= d1) return;
      if (d1 <= 0 && d2 <= 0) continue;
      if (d1 > d2) { const f = (d1 - EPSILON) / (d1 - d2); if (f > enter) { enter = f; clip = p; } }
      else { const f = (d1 + EPSILON) / (d1 - d2); if (f < leave) leave = f; }
    }
    const id = `${prefix}${key}`;
    if (!startout) { best.startsolid = true; if (!getout) this.take(best, 0, { x: 0, y: 0, z: 0 }, key, id, true); return; }
    if (enter < leave && enter > -99999 && clip >= 0)
      this.take(best, Math.max(0, enter), { x: planes[clip], y: planes[clip + 1], z: planes[clip + 2] }, key, id, false);
  }

  private take(best: WorldHit & { key: number }, fraction: number, normal: Vec3, key: number, id: string, allsolid: boolean) {
    if (allsolid) best.allsolid = true;
    if (fraction < best.fraction || (fraction === best.fraction && key < best.key)) {
      if (fraction >= 1) return;
      best.fraction = fraction; best.normal = normal; best.key = key; best.id = id;
    }
  }

  // A triangle's separating axes as planes through its own extent: both faces, the three axes both ways, and each
  // edge crossed with each axis both ways. Their intersection is the triangle, and pushing them out by the hull
  // gives exactly the hull's sweep against it.
  private trianglePlanes(index: number) {
    const t = this.triangles, o = index * 9, out = this.scratch;
    const v = [[t[o], t[o + 1], t[o + 2]], [t[o + 3], t[o + 4], t[o + 5]], [t[o + 6], t[o + 7], t[o + 8]]];
    const e = [0, 1, 2].map(i => [0, 1, 2].map(a => v[(i + 1) % 3][a] - v[i][a]));
    const n = [e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < 1e-6) return 0;
    let count = 0;
    const add = (x: number, y: number, z: number) => {
      const l = Math.hypot(x, y, z);
      if (l < 1e-6) return;
      x /= l; y /= l; z /= l;
      for (const s of [1, -1]) {
        const d = Math.max(...v.map(p => s * (p[0] * x + p[1] * y + p[2] * z)));
        out[count * 4] = s * x; out[count * 4 + 1] = s * y; out[count * 4 + 2] = s * z; out[count * 4 + 3] = d; count++;
      }
    };
    add(n[0], n[1], n[2]);
    add(1, 0, 0); add(0, 1, 0); add(0, 0, 1);
    for (const edge of e) { add(0, -edge[2], edge[1]); add(edge[2], 0, -edge[0]); add(-edge[1], edge[0], 0); }
    return count;
  }
}
