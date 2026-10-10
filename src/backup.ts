import { readBests, type Entry } from './history';
import type { SavedEntry } from './history-archive';
import { maps, type MapId } from './maps';
import { normalizeSettings, type Settings } from './settings';
import type { Position } from './practice';
import { RULES, type Movement } from './physics';

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
export const MAX_ATTEMPTS = 100_000;
export type SavedPosition = Position & { mapId: MapId; mapContentVersion: string };
export type Backup = { version: 2; sourceId: string; exportedAt: string; attempts: SavedEntry[]; bests: Entry[];
  preferences?: Settings; checkpoints: SavedPosition[] };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup record.');
  return value as Record<string, unknown>;
};
function number(value: unknown, fallback = 0, min = -1e8, max = 1e8) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Backup contains an invalid number.');
  return value;
}
function bool(value: unknown, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('Backup contains an invalid flag.');
  return value;
}
function text(value: unknown, fallback = '', max = 256) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error('Backup contains invalid text.');
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Backup contains too many or invalid records.');
  return value;
}
const vector = (value: unknown) => {
  const v = object(value);
  if (['x', 'y', 'z'].some(axis => typeof v[axis] !== 'number')) throw new Error('Incomplete position in backup.');
  return { x: number(v.x), y: number(v.y), z: number(v.z) };
};
export function backupEntry(value: unknown): Entry {
  const e = object(value);
  if (e.tickRate !== 64 && e.tickRate !== 128) throw new Error('Unsupported tick rate in backup.');
  if (typeof e.valid !== 'boolean' || e.distance === undefined || e.sync === undefined) throw new Error('Incomplete jump in backup.');
  if (e.mapId !== undefined && e.mapId !== 'concrete' && !maps.some(m => m.id === e.mapId)) throw new Error('Unknown map in backup.');
  const entry: Entry = {
    distance: number(e.distance, 0, 0, 1e6), sync: number(e.sync, 0, 0, 100), tickRate: e.tickRate,
    mapId: e.mapId as Entry['mapId'], gap: number(e.gap, 0, 0, 1e6), at: number(e.at, 0, 0, 8.64e15),
    preSpeed: number(e.preSpeed, 0, 0), maxSpeed: number(e.maxSpeed, 0, 0), duration: number(e.duration, 0, 0),
    ticks: number(e.ticks, 0, 0), height: number(e.height, 0, 0), overlap: number(e.overlap, 0, 0),
    deadAir: number(e.deadAir, 0, 0), width: number(e.width, 0, 0), edge: e.edge === null || e.edge === undefined ? null : number(e.edge, 0, 0),
    valid: e.valid, landed: bool(e.landed), ducked: bool(e.ducked), reason: text(e.reason),
    path: array(e.path ?? [], 4096).map(vector),
    strafes: array(e.strafes, 256).map(value => {
      const s = object(value);
      return { direction: number(s.direction), ticks: number(s.ticks, 0, 0), synced: number(s.synced, 0, 0),
        gain: number(s.gain, 0, 0), loss: number(s.loss, 0, 0), maxSpeed: number(s.maxSpeed, 0, 0), width: number(s.width, 0, 0) };
    }),
  };
  if (e.autoBhop !== undefined) entry.autoBhop = bool(e.autoBhop);
  if (e.ljBind !== undefined) entry.ljBind = bool(e.ljBind);
  for (const key of ['physicsVersion', 'mapContentVersion'] as const)
    if (e[key] !== undefined) entry[key] = text(e[key], '', 128);
  return entry;
}
export async function fingerprint(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function parseBackup(contents: string): Promise<Backup> {
  if (new TextEncoder().encode(contents).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 128 MB limit.');
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw new Error('Choose a valid longjump JSON backup.'); }
  const raw = object(value);
  if (raw.version !== 1 && raw.version !== 2) throw new Error('This backup version is not supported.');
  const sourceId = raw.version === 1 ? await fingerprint(contents) : text(raw.sourceId, '', 128);
  if (!sourceId || !/^[a-zA-Z0-9:-]+$/.test(sourceId)) throw new Error('Invalid backup identity.');
  const ids = new Set<string>();
  const attempts = array(raw.attempts, MAX_ATTEMPTS).map((value, index): SavedEntry => {
    const entry = backupEntry(value), rawId = object(value).id;
    const supplied = text(rawId, '', 256);
    const id = raw.version === 1 && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(supplied)
      ? `import:${sourceId}:${index}` : supplied;
    if (!id || !/^[a-zA-Z0-9:-]+$/.test(id) || ids.has(id)) throw new Error('Backup contains invalid or repeated attempt IDs.');
    ids.add(id); return { ...entry, id };
  });
  const bests = readBests(array(raw.bests ?? [], 1024).map(backupEntry), attempts);
  const checkpoints = readCheckpoints(raw.checkpoints);
  return { version: 2, sourceId, exportedAt: text(raw.exportedAt), attempts, bests, checkpoints,
    preferences: raw.preferences === undefined ? undefined : normalizeSettings(object(raw.preferences)) };
}
export function readCheckpoints(value: unknown): SavedPosition[] {
  const checkpoints = array(value ?? [], maps.length).map(value => {
    const c = object(value);
    if (!maps.some(map => map.id === c.mapId) || typeof c.mapContentVersion !== 'string' || !/^[0-9a-f]{64}$/.test(c.mapContentVersion))
      throw new Error('Invalid saved position in backup.');
    return { mapId: c.mapId as MapId, mapContentVersion: c.mapContentVersion, position: vector(c.position),
      yaw: number(c.yaw), pitch: number(c.pitch, 0, -89 * Math.PI / 180, 89 * Math.PI / 180) };
  });
  if (new Set(checkpoints.map(c => c.mapId)).size !== checkpoints.length) throw new Error('Repeated saved positions in backup.');
  return checkpoints;
}
export function checkpointForMap(checkpoints: SavedPosition[], id: MapId, version: string, movement: Movement): Position | null {
  const c = checkpoints.find(c => c.mapId === id && c.mapContentVersion === version);
  if (!c || movement.overlaps(c.position, RULES.height)) return null;
  const p = c.position, h = RULES.hull;
  const support = movement.boxes.some(b => p.x + h > b.min.x && p.x - h < b.max.x && p.y + h > b.min.y
    && p.y - h < b.max.y && p.z >= b.max.z && p.z - b.max.z <= 2) || !!movement.world && !!movement.support(p);
  return support ? { position: { ...p }, yaw: c.yaw, pitch: c.pitch } : null;
}
export function equivalentAttempt(a: SavedEntry, b: SavedEntry) {
  return JSON.stringify(backupEntry(a)) === JSON.stringify(backupEntry(b));
}
