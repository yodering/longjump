// GOKZ vanilla longjump defaults, pinned in research/audio/provenance.json.
export const soundTiers = [
  { name: 'impressive', label: 'Impressive', distance: 235 },
  { name: 'perfect', label: 'Perfect', distance: 240 },
  { name: 'godlike', label: 'Godlike', distance: 245 },
  { name: 'ownage', label: 'Ownage', distance: 248 },
  { name: 'wrecker', label: 'Wrecker', distance: 250 },
] as const;
export type Voice = typeof soundTiers[number]['name'];
export type Sound = Voice | 'checkpoint' | 'error';
export function jumpSound(distance: number, valid: boolean): Voice | null {
  if (!valid || !Number.isFinite(distance)) return null;
  return [...soundTiers].reverse().find(t => distance >= t.distance)?.name ?? null;
}
