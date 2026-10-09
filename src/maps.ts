import type { Box, Vec } from './physics';

export const maps = [
  { id: 'kz_baxter', name: 'kz_baxter', detail: 'LJ room · 210–310 units', credits: 'Samuel · LJ room by xq · textures by TopHATTwaffle & Saspatoon', workshop: '1366794864' },
  { id: 'longjump_source_go', name: 'longjump_source_go', detail: 'Courtyard · 225–260 units', credits: 'AZiRES · CS:GO port by badgec / kernel', workshop: '249758765' },
  { id: 'kz_longjumps_go', name: 'kz_longjumps_go', detail: 'Long-jump wing · 240–249 units', credits: 'Draw → THEBUGUSER → badgec / kernel', workshop: '249444895' },
] as const;
export type MapId = typeof maps[number]['id'];
export type Lane = { gap: number; startId: string; endId: string; spawn: Vec; yaw: number };
export type ImportedMap = {
  boxes: Box[]; lanes: Lane[]; preview: { position: Vec; target: Vec }; resetFloor: number;
  entry: { position: Vec; yaw: number };
  materials: { name: string; color: number[]; texture?: string; alpha?: boolean; normalMap?: string; ssbump?: boolean }[];
  // lmStep: uv offset between a bumped face's four side-by-side lightmaps (absent when no face in the mesh is bumped).
  meshes: { material: number; positions: number[]; normals: number[]; uvs: number[]; uv2: number[]; lmStep?: number[] }[];
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
};
export type WorldLight = { type: number; origin: number[]; intensity: number[]; normal: number[]; stopdot: number; stopdot2: number; exponent: number; attenuation: number[] };
export type MapLightingData = { root: number; nodes: [number, number, number][]; planes: number[][]; samples: string;
  leafSamples: Record<string, [number, number]>; lights: WorldLight[] };
const cache = new Map<MapId, ImportedMap>();
export async function loadMap(id: MapId) {
  const existing = cache.get(id); if (existing) return existing;
  const response = await fetch(`${import.meta.env.BASE_URL}maps/${id}/map.json`);
  if (!response.ok) throw new Error(`Map download failed (${response.status})`);
  const data = await response.json() as ImportedMap;
  if (!data.lanes?.length || !data.boxes?.length || !data.meshes?.length) throw new Error('Map geometry is incomplete');
  const samples = await fetch(`${import.meta.env.BASE_URL}maps/${id}/${data.lighting.samples}`);
  if (!samples.ok) throw new Error(`Map lighting download failed (${samples.status})`);
  data.lightingSamples = await samples.arrayBuffer();
  cache.set(id, data); return data;
}
