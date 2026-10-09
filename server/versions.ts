import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Box } from '../src/physics';

const root = new URL('../', import.meta.url);

/** Hash of the rules sources. Vite embeds the same value as VITE_PHYSICS_VERSION. */
export function physicsVersion() {
  const rules = createHash('sha256');
  for (const path of ['src/physics.ts', 'src/commands.ts', 'src/bindings.ts']) rules.update(readFileSync(new URL(path, root)));
  return rules.digest('hex');
}

export type MapRules = { boxes: Box[]; contentVersion: string };
/** Collision data and the content fingerprint the game computes after loading a map. */
export function loadMapRules(id: string): MapRules {
  const data = JSON.parse(readFileSync(new URL(`public/maps/${id}/map.json`, root), 'utf8'));
  const contentVersion = createHash('sha256').update(JSON.stringify({ boxes: data.boxes, entry: data.entry, lanes: data.lanes })).digest('hex');
  return { boxes: data.boxes, contentVersion };
}
