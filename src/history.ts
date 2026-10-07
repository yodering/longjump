import type { Result } from './physics.ts';
import type { MapId } from './maps.ts';

export type Entry = Result & { mapId?: MapId; tickRate: number; gap: number; at: number };

// Storage can contain older or incomplete records. Validate everything the history UI reads.
export function readHistory(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Entry => entry !== null && typeof entry === 'object'
    && Number.isFinite(entry.distance) && Number.isFinite(entry.sync)
    && (entry.tickRate === 64 || entry.tickRate === 128)
    && typeof entry.valid === 'boolean' && Array.isArray(entry.strafes)).slice(0, 100);
}
