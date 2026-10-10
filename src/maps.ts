import type { Box, Vec } from './physics';
import { CollisionWorld } from './collision';

export const maps = [
  { id: 'kz_baxter', name: 'kz_baxter', detail: 'LJ room · 210–310 units', credits: 'Samuel · LJ room by xq · textures by TopHATTwaffle & Saspatoon', workshop: '1366794864' },
  { id: 'longjump_source_go', name: 'longjump_source_go', detail: 'Courtyard · 225–260 units', credits: 'AZiRES · CS:GO port by badgec / kernel', workshop: '249758765' },
  { id: 'kz_longjumps_go', name: 'kz_longjumps_go', detail: 'Long-jump wing · 240–249 units', credits: 'Draw → THEBUGUSER → badgec / kernel', workshop: '249444895' },
  { id: 'de_mirage', name: 'de_mirage', detail: 'Whole map · jump anywhere flat', credits: 'Valve · Counter-Strike: Global Offensive', workshop: '' },
  { id: 'de_nuke', name: 'de_nuke', detail: 'Whole map · jump anywhere flat', credits: 'Valve · Counter-Strike: Global Offensive', workshop: '' },
] as const;
export type MapId = typeof maps[number]['id'];
export type Lane = { gap: number; startId: string; endId: string; spawn: Vec; yaw: number };
export type ImportedMap = {
  boxes: Box[]; lanes: Lane[]; preview: { position: Vec; target: Vec }; resetFloor: number;
  entry: { position: Vec; yaw: number };
  materials: { name: string; color: number[]; texture?: string; texture2?: string; alpha?: boolean; normalMap?: string; ssbump?: boolean }[];
  // lmStep: uv offset between a bumped face's four side-by-side lightmaps (absent when no face in the mesh is bumped).
  // Whole maps (format 2) load indexed geometry from world.bin; blend is a WorldVertexTransition displacement's alpha.
  meshes: { material: number; positions: ArrayLike<number>; normals?: number[]; uvs: ArrayLike<number>; uv2: ArrayLike<number>;
    lmStep?: ArrayLike<number>; index?: Uint32Array; blend?: Float32Array }[];
  // Compiled lighting: a lightmap atlas, plus the BSP tree, leaf ambient samples and world lights for models.
  lightmap: { texture: string; width: number; height: number };
  // Static infodecals, projected onto world surfaces at import as the engine does (lit by those surfaces' lightmaps).
  decals: { materials: { name: string; texture: string; blend: 'alpha' | 'modulate'; lit: boolean }[];
    meshes: { material: number; positions: number[]; uvs: number[]; uv2: number[] }[] };
  sky: { name: string; faces: Record<'rt' | 'lf' | 'bk' | 'ft' | 'up' | 'dn', string> } | null;
  // point_worldtext labels (Source origin, pitch/yaw/roll in degrees, text height in units), e.g. kz_baxter's block numbers.
  worldText?: { text: string; origin: [number, number, number]; angles: [number, number, number]; size: number; color: [number, number, number] }[];
  lighting: MapLightingData;
  lightingSamples: ArrayBuffer;
  // Whole maps: the full map's collision (collision.bin), parsed on load into `world`.
  format?: 2;
  geometry?: { file: string; vertices: number; indices: number };
  collision?: { file: string; sha256: string; min: number[]; max: number[] };
  world?: CollisionWorld;
  // Static props: each model's geometry once, instanced with a 3x4 transform (Source axes) and its own baked colours.
  props?: { file: string; colorFile: string; vertices: number; indices: number; colors: number;
    materials: { name: string; texture?: string; alpha?: boolean }[];
    // Positions are int16 over each model's bounds: offset + value * scale.
    models: { name: string; meshes: PropMesh[]; offset?: number[]; scale?: number[] }[];
    instances: { model: number; matrix: number[]; colorStart: number }[] };
  propGeometry?: { positions: Int16Array; uvs: Uint16Array; indices: Uint16Array; colors: Uint8Array };
};
export type PropMesh = { material: number; vertexStart: number; vertexCount: number; indexStart: number; indexCount: number };
type WholeMesh = { material: number; vertexStart: number; vertexCount: number; indexStart: number; indexCount: number; bumped: boolean; blend: boolean };
export type WorldLight = { type: number; origin: number[]; intensity: number[]; normal: number[]; stopdot: number; stopdot2: number; exponent: number; attenuation: number[] };
export type MapLightingData = { root: number; nodes: [number, number, number][]; planes: number[][]; samples: string;
  leafSamples: Record<string, [number, number]>; lights: WorldLight[] };
const cache = new Map<MapId, ImportedMap>();
export async function loadMap(id: MapId) {
  const existing = cache.get(id); if (existing) return existing;
  const response = await fetch(`${import.meta.env.BASE_URL}maps/${id}/map.json`);
  if (!response.ok) throw new Error(`Map download failed (${response.status})`);
  const data = await response.json() as ImportedMap;
  if (data.format === 2) await loadWholeMap(id, data);
  else if (!data.lanes?.length || !data.boxes?.length || !data.meshes?.length) throw new Error('Map geometry is incomplete');
  const samples = await fetch(`${import.meta.env.BASE_URL}maps/${id}/${data.lighting.samples}`);
  if (!samples.ok) throw new Error(`Map lighting download failed (${samples.status})`);
  data.lightingSamples = await samples.arrayBuffer();
  cache.set(id, data); return data;
}

// Binaries are stored gzipped; a host that already decoded them (Content-Encoding) hands over the plain bytes.
export async function inflate(buffer: ArrayBuffer) {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer;
  return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function download(id: MapId, file: string) {
  const response = await fetch(`${import.meta.env.BASE_URL}maps/${id}/${file}`);
  if (!response.ok) throw new Error(`Map download failed (${response.status})`);
  return inflate(await response.arrayBuffer());
}
// world.bin: positions f32x3, uvs f32x2, uv2 f32x2, lmStep f32, blend f32 per vertex, then u32 indices local to each mesh.
async function loadWholeMap(id: MapId, data: ImportedMap) {
  if (!data.geometry || !data.collision) throw new Error('Map geometry is incomplete');
  const [geometry, collision, props, colors] = await Promise.all([download(id, data.geometry.file), download(id, data.collision.file),
    ...(data.props ? [download(id, data.props.file), download(id, data.props.colorFile)] : [])]);
  const n = data.geometry.vertices, at = (k: number) => k * n * 4;
  const positions = new Float32Array(geometry, 0, n * 3), uvs = new Float32Array(geometry, at(3), n * 2), uv2 = new Float32Array(geometry, at(5), n * 2);
  const steps = new Float32Array(geometry, at(7), n), blend = new Float32Array(geometry, at(8), n), indices = new Uint32Array(geometry, at(9), data.geometry.indices);
  data.meshes = (data.meshes as unknown as WholeMesh[]).map(m => {
    const v = (array: Float32Array, size: number) => array.subarray(m.vertexStart * size, (m.vertexStart + m.vertexCount) * size);
    return { material: m.material, positions: v(positions, 3), uvs: v(uvs, 2), uv2: v(uv2, 2), index: indices.subarray(m.indexStart, m.indexStart + m.indexCount),
      ...(m.bumped ? { lmStep: v(steps, 1) } : {}), ...(m.blend ? { blend: v(blend, 1) } : {}) };
  });
  data.world = new CollisionWorld(collision);
  if (props && colors && data.props) {
    // props.bin: int16 positions (padded to 4 bytes), float16 uvs, u16 indices; prop-colors.bin: u8 RGB per instance vertex.
    const { vertices, indices } = data.props, uvStart = Math.ceil(vertices * 6 / 4) * 4;
    data.propGeometry = { positions: new Int16Array(props, 0, vertices * 3), uvs: new Uint16Array(props, uvStart, vertices * 2),
      indices: new Uint16Array(props, uvStart + vertices * 4, indices), colors: new Uint8Array(colors) };
  }
}
