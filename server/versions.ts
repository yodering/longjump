import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Box } from '../src/physics';
import { CollisionWorld } from '../src/collision';

const root = new URL('../', import.meta.url);

/** Hash of the rules sources. Vite embeds the same value as VITE_PHYSICS_VERSION. */
export function physicsVersion() {
  const rules = createHash('sha256');
  for (const path of ['src/physics.ts', 'src/collision.ts', 'src/commands.ts', 'src/bindings.ts']) rules.update(readFileSync(new URL(path, root)));
  return rules.digest('hex');
}

export type MapRules = { boxes: Box[]; world?: CollisionWorld | null; contentVersion: string };
/** Collision data and the content fingerprint the game computes after loading a map. */
export function loadMapRules(id: string): MapRules {
  const data = JSON.parse(readFileSync(new URL(`public/maps/${id}/map.json`, root), 'utf8'));
  // Whole maps keep their collision in a binary file; its hash joins the fingerprint (absent, and so unchanged, for box maps).
  const contentVersion = createHash('sha256').update(JSON.stringify({ boxes: data.boxes, entry: data.entry, lanes: data.lanes, collision: data.collision?.sha256 })).digest('hex');
  let world: CollisionWorld | null = null;
  if (data.collision) {
    const stored = readFileSync(new URL(`public/maps/${id}/${data.collision.file}`, root));
    const file = stored[0] === 0x1f && stored[1] === 0x8b ? gunzipSync(stored) : stored;
    world = new CollisionWorld(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  }
  return { boxes: data.boxes, world, contentVersion };
}
