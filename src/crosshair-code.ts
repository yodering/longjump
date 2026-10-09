import type { CrosshairSettings } from './settings.ts';

// CS:GO crosshair share codes (CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx): 18 bytes written as a base-57
// number, least significant character first. Byte 0 is a checksum of the rest; byte 1 is the format
// version, 1 for CS:GO. Layout follows akiver/csgo-sharecode's legacy-v1 crosshair.
const DICTIONARY = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const BYTES = 18, CHARS = 25;
const presetColors = ['#ff0000', '#00ff00', '#ffff00', '#0000ff', '#00ffff'];
const int8 = (n: number) => (n << 24) >> 24;
const checksum = (bytes: number[]) => bytes.slice(1).reduce((a, b) => a + b, 0) & 0xff;

function toBytes(code: string) {
  const chars = code.trim().replace(/^CSGO/, '').replace(/-/g, '');
  if (!new RegExp(`^[${DICTIONARY}]{${CHARS}}$`).test(chars)) return null;
  let big = 0n;
  for (const char of [...chars].reverse()) big = big * 57n + BigInt(DICTIONARY.indexOf(char));
  const hex = big.toString(16).padStart(BYTES * 2, '0');
  if (hex.length > BYTES * 2) return null;
  return hex.match(/../g)!.map(h => parseInt(h, 16));
}

/** Reads a CS:GO crosshair code into static crosshair settings, or null when it is not one. */
export function decodeCrosshair(code: string): CrosshairSettings | null {
  const b = toBytes(code);
  if (!b || b[0] !== checksum(b) || b[1] !== 1) return null;
  const color = b[10] & 7, alphaEnabled = ((b[13] >> 4) & 4) === 4;
  return {
    gap: int8(b[2]) / 10, size: b[14] / 10, thickness: b[12] / 10,
    color: color === 5 ? '#' + [b[4], b[5], b[6]].map(n => n.toString(16).padStart(2, '0')).join('') : presetColors[color] ?? '#00ff00',
    alpha: alphaEnabled ? b[7] / 255 : 1, outline: (b[10] & 8) === 8, dot: ((b[13] >> 4) & 1) === 1,
  };
}

/** Writes settings as a classic static (cl_crosshairstyle 4) CS:GO crosshair code. */
export function encodeCrosshair(c: CrosshairSettings) {
  const rgb = c.color.slice(1).match(/../g)!.map(v => parseInt(v, 16));
  const tenths = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n * 10)));
  // Split values are CS:GO's defaults; a static crosshair ignores them.
  const bytes = [0, 1, tenths(c.gap, -128, 127) & 0xff, 2, ...rgb, Math.round(c.alpha * 255), 7, 30,
    5 | (Number(c.outline) << 3) | (10 << 4), 5 | (3 << 4), tenths(c.thickness, 0, 255),
    (4 << 1) | (Number(c.dot) << 4) | (1 << 6), tenths(c.size, 0, 255), 0, 0, 0];
  bytes[0] = checksum(bytes);
  let big = BigInt('0x' + bytes.map(n => n.toString(16).padStart(2, '0')).join('')), chars = '';
  for (let i = 0; i < CHARS; i++) { chars += DICTIONARY[Number(big % 57n)]; big /= 57n; }
  return `CSGO-${chars.match(/.{5}/g)!.join('-')}`;
}
