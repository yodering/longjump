import test from 'node:test';
import assert from 'node:assert/strict';
import { displayLayout } from '../src/display.ts';

test('1440×1080 keeps 4:3 projection while stretched presentation fills a 16:9 display', () => {
  const layout = displayLayout('1440x1080', 'stretch', 1920, 1080, 2);
  assert.equal(layout.aspect, 4 / 3); assert.equal(layout.bufferWidth, 1440); assert.equal(layout.bufferHeight, 1080);
  assert.equal(layout.cssWidth, 1920); assert.equal(layout.cssHeight, 1080); assert.equal(layout.left, 0);
});
test('Black bars fit without cropping and recenter on browser resize', () => {
  const wide = displayLayout('1440x1080', 'fit', 1920, 1080);
  assert.equal(wide.cssWidth, 1440); assert.equal(wide.left, 240); assert.equal(wide.top, 0);
  const narrow = displayLayout('1920x1080', 'fit', 1000, 1000);
  assert.ok(Math.abs(narrow.cssWidth - 1000) < 1e-9);
  assert.ok(Math.abs(narrow.cssHeight - 562.5) < 1e-9);
  assert.ok(Math.abs(narrow.top - 218.75) < 1e-9);
});
test('Native uses the window aspect with capped device-pixel density, fixed presets stay exact', () => {
  const native = displayLayout('native', 'stretch', 1200, 800, 3);
  assert.equal(native.bufferWidth, 2400); assert.equal(native.bufferHeight, 1600); assert.equal(native.aspect, 1.5);
  assert.equal(displayLayout('1024x768', 'stretch', 1200, 800, 3).bufferWidth, 1024);
});
