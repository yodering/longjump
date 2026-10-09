import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCrosshair, encodeCrosshair } from '../src/crosshair-code.ts';

test('Decodes a CS:GO crosshair share code', () => {
  // akiver/csgo-sharecode legacy-v1 sample: gap -1.3, rgb 175 81 213, alpha 137, thickness 1.2, length 4.6, dot and outline on.
  assert.deepEqual(decodeCrosshair('CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG'),
    { gap: -1.3, size: 4.6, thickness: 1.2, color: '#af51d5', alpha: 137 / 255, outline: true, dot: true });
  assert.equal(decodeCrosshair('CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkH'), null);
  assert.equal(decodeCrosshair('not a code'), null);
});
test('Encoded crosshairs decode to the same settings', () => {
  const crosshair = { size: 2.5, gap: -2, thickness: 0.5, color: '#00ff7f', alpha: 1, dot: false, outline: true };
  const code = encodeCrosshair(crosshair);
  assert.match(code, /^CSGO(-[A-Za-z0-9]{5}){5}$/);
  assert.deepEqual(decodeCrosshair(code), crosshair);
});
