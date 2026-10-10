import { createMap, type Vec } from './physics.ts';
import type { ImportedMap, Lane } from './maps.ts';

export const CONCRETE_GAP = 240;
export type Position = { position: Vec; yaw: number; pitch: number };
export function mapEntry(map: ImportedMap | null): Position {
  return map ? { position: { ...map.entry.position }, yaw: map.entry.yaw, pitch: 0 }
    : { position: { x: 0, y: -600, z: 0 }, yaw: 0, pitch: 0 };
}
export function mapLanes(map: ImportedMap | null): Lane[] {
  if (map) return map.lanes;
  return [220, 230, CONCRETE_GAP, 250, 260].map((gap, i) => ({ gap, startId: `start-${i}`, endId: `end-${i}`, spawn: { x: (i - 2) * 320, y: -490, z: 0 }, yaw: 0 }));
}
export function blockAt(lanes: Lane[], supportId: string) {
  return lanes.find(l => l.startId === supportId || l.endId === supportId);
}
export function belowMap(map: ImportedMap | null, feet: Vec) {
  // Imported grass and pit floors are walkable. Only falling out of the map resets.
  const bottom = map ? (map.collision ? map.collision.min[2] : Math.min(...map.boxes.map(b => b.min.z))) - 180 : -180;
  return feet.z < bottom;
}
export function concreteBoxes() { return createMap(CONCRETE_GAP); }
