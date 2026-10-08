import type { Result } from './physics';
import { jumpSound, type Voice } from './sound-tiers';

// GOKZ distance tiers are gameplay data colors, independent of menu appearance.
const tierColors: Record<Voice | 'meh', string> = { meh: '#c4c4c4', impressive: '#5aa0ff', perfect: '#4fd14f', godlike: '#e0453a', ownage: '#f0c419', wrecker: '#d17be6' };
type FeedResult = Pick<Result, 'distance' | 'valid' | 'landed' | 'strafes' | 'sync' | 'preSpeed' | 'maxSpeed' | 'edge' | 'height' | 'ticks' | 'overlap' | 'deadAir' | 'width'>;
export function jumpFeedMarkup(result: FeedResult) {
  const tier = jumpSound(result.distance, result.valid) ?? 'meh';
  const type = result.valid ? 'LJ' : result.landed ? 'LJ (INVALID)' : 'LJ (FAILED)';
  const metric = (value: string | number, label: string) => `<span class="kz-metric"><em>${value}</em> ${label}</span>`;
  return `<p><span class="kz-tag">KZ</span> | <span class="kz-distance" style="--jump-tier:${tierColors[tier]}">${type}: ${result.distance.toFixed(4)}</span> | `
    + [metric(result.strafes.length, 'Strafes'), metric(`${result.sync.toFixed(0)}%`, 'Sync'), metric(result.preSpeed.toFixed(2), 'Pre'), metric(result.maxSpeed.toFixed(2), 'Max')].join(' | ') + '</p>'
    + '<p>' + [metric(result.edge === null ? '—' : result.edge.toFixed(1), 'Edge'), metric(result.height.toFixed(2), 'Height'), metric(result.ticks, 'Airtime'), metric(result.overlap, 'Overlap'), metric(result.deadAir, 'Dead Air'), metric(`${result.width.toFixed(1)}°`, 'Width')].join(' | ') + '</p>';
}
