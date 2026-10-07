import test from 'node:test';
import assert from 'node:assert/strict';
import { importConfig, exportConfig, splitCommands } from '../src/config.ts';
import { normalizeSettings } from '../src/settings.ts';
import { assignBinding } from '../src/bindings.ts';

test('Config parsing respects quoted semicolons and comments; imports LJ aliases without executing scripts', () => {
  const current = normalizeSettings(null);
  const result = importConfig(`// full existing autoexec
    bind "UPARROW" "+forward"; sensitivity "1.25" // comment
    alias "+lj" "+duck; +jump; -forward; -back"
    alias "-lj" "-duck; -jump"
    bind "mouse2" "+lj"
    bind "mwheeldown" "+jump"
    bind "a" "+moveleft; r_cleardecals"
    exec private.cfg
    bind "b" "buy ak47"
    sv_airaccelerate 999
    /* comment */ viewmodel_offset_x "2.5"
    cl_righthand "0"`, current);
  assert.equal(result.settings.sensitivity, 1.25);
  assert.deepEqual(result.settings.bindings.longJump, ['Mouse2']);
  assert.deepEqual(result.settings.bindings.heavy, []);
  assert.ok(result.settings.bindings.forward.includes('ArrowUp'));
  assert.deepEqual(result.settings.bindings.jump, current.bindings.jump);
  assert.deepEqual(result.settings.bindings.left, current.bindings.left);
  assert.equal(result.settings.view.x, 2.5); assert.equal(result.settings.leftHand, true);
  assert.equal(result.ignored.length, 3);
  assert.deepEqual(current, normalizeSettings(null));
  assert.deepEqual(splitCommands('alias "+lj" "+duck; +jump"; bind "v" "+lj" // hi\n sensitivity 2'),
    ['alias "+lj" "+duck; +jump"', 'bind "v" "+lj"', 'sensitivity 2']);
});
test('Unknown, recursive and null-strafe aliases are skipped; recognized alias release must match', () => {
  const result = importConfig(`alias +loop "+loop"; bind v +loop;
    alias +null "-moveright; +moveleft"; alias -null "-moveleft"; bind a +null;
    alias +broken "+duck; +jump; -forward; -back"; alias -broken "-jump"; bind mouse2 +broken;
    alias +hop "+jump"; alias -hop "-jump"; bind space +hop`, normalizeSettings(null));
  assert.equal(result.applied.length, 1); assert.equal(result.ignored.length, 3);
  assert.deepEqual(result.settings.bindings.longJump, []);
  assert.deepEqual(result.settings.bindings.left, ['KeyA']);
});
test('Imported numbers are bounded; custom RGB only affects the custom color mode', () => {
  const result = importConfig(`sensitivity 999; viewmodel_fov 999; viewmodel_offset_z -99;
    m_pitch -0.022; cl_crosshaircolor 1; cl_crosshaircolor_r 240; cl_crosshaircolor_g 5; cl_crosshaircolor_b 0;
    cl_crosshairalpha 10; cl_crosshairusealpha 0`, normalizeSettings(null));
  assert.equal(result.settings.sensitivity, 20); assert.equal(result.settings.view.fov, 68);
  assert.equal(result.settings.view.z, -2); assert.equal(result.settings.invertY, true);
  assert.equal(result.settings.crosshair.color, '#00ff00'); assert.equal(result.settings.crosshair.alpha, 1);
  const custom = importConfig('cl_crosshaircolor 5; cl_crosshaircolor_r 240; cl_crosshaircolor_g 5; cl_crosshaircolor_b 0', result.settings);
  assert.equal(custom.settings.crosshair.color, '#f00500');
});
test('Exported cfg round-trips supported settings, unassigned default keys and reassigned mouse binds', () => {
  const s = normalizeSettings(null); s.bindings.jump = ['WheelDown']; s.bindings.inspect = [];
  assignBinding(s.bindings, 'longJump', 'Mouse2'); s.sensitivity = 1.13; s.invertY = true;
  s.view.fov = 68; s.view.x = 2.5; s.crosshair.color = '#aabbcc';
  const result = importConfig(exportConfig(s), normalizeSettings(null));
  assert.deepEqual(result.settings, s); assert.deepEqual(result.ignored, []);
});
test('Malformed stored preferences recover defaults, preserve explicit unbound actions and ignore old game FOV', () => {
  const s = normalizeSettings({ sensitivity: null, view: { fov: 'NaN' }, crosshair: { color: '</script>' },
    fov: 120, resolution: '__proto__', bindings: { jump: [], duck: ['Escape', 'Mouse2'] } });
  assert.equal(s.sensitivity, 2.4); assert.equal(s.view.fov, 60); assert.equal(s.resolution, 'native');
  assert.deepEqual(s.bindings.jump, []); assert.deepEqual(s.bindings.duck, ['Mouse2']);
  assert.equal(s.bindings.heavy.length, 0); assert.equal(s.crosshair.color, '#eeeeee');
});
