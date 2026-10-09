import type { Result } from './physics.ts';
import { maps, type MapId } from './maps.ts';

export type Entry = Result & { mapId?: MapId | 'concrete'; tickRate: number; gap: number; at: number; ljBind?: boolean; autoBhop?: boolean;
  physicsVersion?: string; mapContentVersion?: string };

// Storage can contain older or incomplete records. Validate everything the history UI reads.
export function readHistory(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Entry => entry !== null && typeof entry === 'object'
    && Number.isFinite(entry.distance) && Number.isFinite(entry.sync)
    && (entry.tickRate === 64 || entry.tickRate === 128)
    && typeof entry.valid === 'boolean' && Array.isArray(entry.strafes));
}

export function sameCategory(a: Pick<Entry, 'mapId' | 'tickRate' | 'autoBhop'>, b: Pick<Entry, 'mapId' | 'tickRate' | 'autoBhop'>) {
  return a.mapId === b.mapId && a.tickRate === b.tickRate && a.autoBhop === b.autoBhop;
}

// Store records separately from the capped recent history so a PB never ages out.
export function saveBest(records: Entry[], entry: Entry): Entry[] {
  if (!entry.valid || !entry.landed || !maps.some(map => map.id === entry.mapId) || !Number.isFinite(entry.distance)
    || (entry.autoBhop !== undefined && typeof entry.autoBhop !== 'boolean')
    || (entry.ljBind !== undefined && typeof entry.ljBind !== 'boolean')) return records;
  const previous = records.find(record => sameCategory(record, entry));
  if (previous && previous.distance >= entry.distance) return records;
  return [...records.filter(record => !sameCategory(record, entry)), entry];
}

export function readBests(value: unknown, history: Entry[] = []): Entry[] {
  return [...readHistory(value), ...history].reduce(saveBest, [] as Entry[]);
}
