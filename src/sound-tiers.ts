// Vanilla practice thresholds; audio provenance is in research/audio/provenance.json.
export const soundTiers = [
  { name: 'impressive', label: 'Impressive', distance: 230 },
  { name: 'perfect', label: 'Perfect', distance: 235 },
  { name: 'godlike', label: 'Godlike', distance: 240 },
  { name: 'ownage', label: 'Ownage', distance: 243 },
  { name: 'wrecker', label: 'Wrecker', distance: 246 },
] as const;
export type Voice = typeof soundTiers[number]['name'];
export type Sound = Voice | 'checkpoint' | 'error';
export function jumpSound(distance: number, valid: boolean): Voice | null {
  if (!valid || !Number.isFinite(distance)) return null;
  return [...soundTiers].reverse().find(t => distance >= t.distance)?.name ?? null;
}
