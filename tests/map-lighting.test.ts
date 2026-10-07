import test from 'node:test';
import assert from 'node:assert/strict';
import { MapLighting } from '../src/map-lighting.ts';
import type { ImportedMap } from '../src/maps.ts';

test('Leaves without ambient samples do not repeatedly accumulate extra point lights', () => {
  const buffer = new ArrayBuffer(30), view = new DataView(buffer);
  view.setInt16(0, -10, true);
  for (let side = 0; side < 6; side++) view.setUint32(6 + side * 4, 1, true);
  const point = (red: number) => ({ type: 1, origin: [100, 0, 0], intensity: [red, 0, 0],
    normal: [0, 0, 0], stopdot: 0, stopdot2: 0, exponent: 1, attenuation: [1, 0, 0] });
  const lighting = new MapLighting({ boxes: [], lightingSamples: buffer, lighting: {
    root: 0, nodes: [[0, -2, -1]], planes: [[1, 0, 0, 0]], leafSamples: { 0: [0, 1] },
    samples: 'lighting.bin', lights: [point(1), point(0.5)] } } as unknown as ImportedMap);
  const first = lighting.state({ x: -10, y: 0, z: 0 });
  const fallback = lighting.state({ x: 10, y: 0, z: 0 });
  const next = lighting.state({ x: 20, y: 0, z: 0 });
  assert.deepEqual(first.ambient, fallback.ambient);
  assert.deepEqual(next.ambient, fallback.ambient);
  assert.equal(next.ambient[0][0], 1.5);
});
