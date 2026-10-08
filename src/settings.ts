import { maps, type MapId } from './maps.ts';
import { normalizeBindings, type Bindings } from './bindings.ts';

export const resolutions = { native: 'Native', '1920x1080': '1920 × 1080 · 16:9', '1600x900': '1600 × 900 · 16:9',
  '1440x1080': '1440 × 1080 · 4:3', '1280x960': '1280 × 960 · 4:3', '1024x768': '1024 × 768 · 4:3',
  '1280x1024': '1280 × 1024 · 5:4' } as const;
export type Resolution = keyof typeof resolutions;
export type ViewSettings = { fov: number; x: number; y: number; z: number; bobLower: number; bobLat: number; bobVert: number; bobCycle: number };
export type CrosshairSettings = { size: number; gap: number; thickness: number; color: string; alpha: number; dot: boolean; outline: boolean };
export type Settings = { mapId: MapId; volume: number; tickRate: 64 | 128; sensitivity: number; mouseYaw: number; mousePitch: number;
  invertY: boolean; autoBhop: boolean; jumpStats: boolean; sound: boolean; trail: boolean; viewmodel: boolean; leftHand: boolean; team: 'ct' | 't';
  appearance: 'dark' | 'light'; resolution: Resolution; scaling: 'stretch' | 'fit'; view: ViewSettings; crosshair: CrosshairSettings; bindings: Bindings };
export const viewPresets: Record<string, ViewSettings> = {
  desktop: { fov: 60, x: 1, y: 1, z: -1, bobLower: 21, bobLat: 0.4, bobVert: 0.25, bobCycle: 0.98 },
  couch: { fov: 54, x: 0, y: 0, z: 0, bobLower: 21, bobLat: 0.4, bobVert: 0.25, bobCycle: 0.98 },
  classic: { fov: 68, x: 2.5, y: 0, z: -1.5, bobLower: 21, bobLat: 0.4, bobVert: 0.25, bobCycle: 0.98 },
};
export const viewRanges = { fov: [54, 68, 1], x: [-2, 2.5, 0.1], y: [-2, 2, 0.1], z: [-2, 2, 0.1],
  bobLower: [5, 30, 1], bobLat: [0.1, 2, 0.05], bobVert: [0.1, 2, 0.05], bobCycle: [0.1, 2, 0.01] } as const;
export const defaults: Settings = { mapId: 'longjump_source_go', volume: 0.6, tickRate: 64, sensitivity: 2.4,
  mouseYaw: 0.022, mousePitch: 0.022, invertY: false, autoBhop: false, jumpStats: false, sound: true, trail: true,
  viewmodel: true, leftHand: false, team: 'ct', appearance: 'dark', resolution: 'native', scaling: 'stretch', view: { ...viewPresets.desktop },
  crosshair: { size: 4, gap: 2, thickness: 1, color: '#eeeeee', alpha: 1, dot: false, outline: true }, bindings: normalizeBindings(null) };
export function bounded(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' ? value as Partial<Settings> : {};
  const settings = structuredClone(defaults);
  if (maps.some(m => m.id === raw.mapId)) settings.mapId = raw.mapId!;
  settings.tickRate = raw.tickRate === 128 ? 128 : 64;
  settings.appearance = raw.appearance === 'light' ? 'light' : 'dark';
  settings.team = raw.team === 't' ? 't' : 'ct';
  if (raw.resolution && Object.hasOwn(resolutions, raw.resolution)) settings.resolution = raw.resolution;
  settings.scaling = raw.scaling === 'fit' ? 'fit' : 'stretch';
  settings.sensitivity = bounded(raw.sensitivity, defaults.sensitivity, 0.01, 20);
  settings.volume = bounded(raw.volume, defaults.volume, 0, 1);
  settings.mouseYaw = bounded(raw.mouseYaw, defaults.mouseYaw, 0.001, 0.1);
  settings.mousePitch = bounded(raw.mousePitch, defaults.mousePitch, 0.001, 0.1);
  for (const name of ['invertY', 'autoBhop', 'jumpStats', 'sound', 'trail', 'viewmodel', 'leftHand'] as const)
    if (typeof raw[name] === 'boolean') settings[name] = raw[name];
  for (const name of Object.keys(viewRanges) as (keyof ViewSettings)[]) {
    const [min, max] = viewRanges[name]; settings.view[name] = bounded(raw.view?.[name], defaults.view[name], min, max);
  }
  const c = raw.crosshair;
  settings.crosshair.size = bounded(c?.size, defaults.crosshair.size, 0, 20);
  settings.crosshair.gap = bounded(c?.gap, defaults.crosshair.gap, -5, 20);
  settings.crosshair.thickness = bounded(c?.thickness, defaults.crosshair.thickness, 0.5, 5);
  settings.crosshair.alpha = bounded(c?.alpha, defaults.crosshair.alpha, 0, 1);
  if (typeof c?.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)) settings.crosshair.color = c.color;
  for (const name of ['dot', 'outline'] as const) if (typeof c?.[name] === 'boolean') settings.crosshair[name] = c[name];
  settings.bindings = normalizeBindings(raw.bindings);
  return settings;
}
