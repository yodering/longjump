import './style.css';
import { Movement, speed, type Result, type Vec } from './physics';
import { World } from './world';
import { maps, loadMap, type MapId, type ImportedMap } from './maps';
import { mapEntry, mapLanes, blockAt, belowMap, CONCRETE_GAP, concreteBoxes, type Position } from './practice';
import { Sounds } from './sounds';
import { soundTiers, jumpSound, type Sound, type Voice } from './sound-tiers';
import { readHistory, type Entry } from './history';
import { normalizeSettings } from './settings';
import { Controls, tokenLabel, type Action } from './bindings';
import { SettingsPanel } from './settings-panel';

function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
const settings = normalizeSettings(read<unknown>('vnl-settings', {}));
let history = readHistory(read<unknown>('vnl-history', []));
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="world" aria-label="Three-dimensional long jump practice room"></div>
  <header class="topbar">
    <a class="brand" href="#" aria-label="VNL · Long Jump home"><span class="brand-mark">VNL</span><span class="brand-sub">Long Jump</span></a>
    <div class="room-label"><span id="header-map">Loading map</span> <span class="divider">/</span> <span id="header-tick">128 TICK</span></div>
    <button id="menu-button" class="quiet-button">Menu <kbd>Esc</kbd></button>
  </header>
  <main id="menu" class="menu">
    <div class="menu-content">
      <h1>Long jump</h1>
      <p class="description">Vanilla CS:GO movement</p>
      <div class="current-map"><span>Map</span><strong id="menu-map">Loading…</strong></div>
      <nav class="tabs" aria-label="Practice menu"><button data-tab="practice" class="active">Practice</button><button data-tab="maps">Maps</button><button data-tab="settings">Settings</button><button data-tab="session">History <span id="history-count">0</span></button></nav>
      <section id="practice-tab" class="tab-content">
        <p class="practice-note">Move around the map to choose a block.<br>All gaps are fixed.</p>
        <div class="checkpoint-help"><span><kbd data-bind-label="save"></kbd> Save position</span><span><kbd data-bind-label="return"></kbd> Return</span><span><kbd data-bind-label="reset"></kbd> Reset</span></div>
        <div class="profile-row"><span>Vanilla</span><button id="tick-toggle">${settings.tickRate} tick <span>↔</span></button></div>
        <div class="physics-values"><span>Air accel <b>12</b></span><span>Gravity <b>800</b></span><span>Max speed <b>250</b></span></div>
        <p id="map-lanes" class="setting-note"></p>
      </section>
      <section id="maps-tab" class="tab-content" hidden>
        <div class="map-options">${maps.map(m => `<button data-map="${m.id}" aria-pressed="false"><b>${m.name}</b><small>${m.detail}</small></button>`).join('')}</div>
        <div id="map-credit" class="map-credit"></div>
      </section>
      <section id="settings-tab" class="tab-content" hidden>
        <label class="setting-range" for="sensitivity">Mouse sensitivity <output id="sensitivity-output">${settings.sensitivity}</output></label><input id="sensitivity" type="number" min="0.01" max="20" step="0.01" value="${settings.sensitivity}"/>
        <label class="toggle-row">Strafe hints <input id="guide" type="checkbox" ${settings.guide ? 'checked' : ''}/></label>
        <label class="toggle-row">Viewmodel <input id="viewmodel" type="checkbox" ${settings.viewmodel ? 'checked' : ''}/></label>
        <label class="toggle-row">Knife <select id="team"><option value="ct" ${settings.team === 'ct' ? 'selected' : ''}>CT default</option><option value="t" ${settings.team === 't' ? 'selected' : ''}>T default</option></select></label>
        <label class="toggle-row">Left-handed viewmodel <input id="leftHand" type="checkbox" ${settings.leftHand ? 'checked' : ''}/></label>
        <label class="toggle-row">Last-jump trail <input id="trail" type="checkbox" ${settings.trail ? 'checked' : ''}/></label>
        <label class="toggle-row">KZ sounds <input id="sound" type="checkbox" ${settings.sound ? 'checked' : ''}/></label>
        <label class="setting-range" for="volume">Sound volume <output id="volume-output">${Math.round(settings.volume * 100)}%</output></label><input id="volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"/>
        <details class="sound-samples"><summary>Sound samples</summary><div>${soundTiers.map(t => `<button data-sample="${t.name}">${t.label} <small>${t.distance}+</small></button>`).join('')}<button data-sample="checkpoint">Checkpoint beep</button><button data-sample="error">Error beep</button></div><p class="setting-note">GOKZ vanilla long-jump defaults.</p></details>
        <p id="mouse-scale-note" class="setting-note"></p>
      </section>
      <section id="session-tab" class="tab-content" hidden><div id="session-list"></div></section>
      <button id="start" class="start-button"><span>Play</span></button>
      <div id="start-note" class="start-note">Click Play to capture the mouse.</div>
      <div class="menu-controls"><div><kbd data-bind-label="forward"></kbd><kbd data-bind-label="left"></kbd><kbd data-bind-label="back"></kbd><kbd data-bind-label="right"></kbd><span>Move</span></div><div><kbd data-bind-label="jump"></kbd><span>Jump</span></div><div><kbd data-bind-label="duck"></kbd><span>Duck</span></div></div>
    </div>
    <footer class="menu-footer"><span>Esc to pause</span><button id="about-button" aria-label="About movement and maps">About</button></footer>
  </main>
  <div id="hud" hidden>
    <div class="lane-badge"><span id="hud-map">CLASSIC</span> <span>/</span> <span id="hud-block">FREE ROAM</span></div>
    <div id="crosshair" class="cs-crosshair"><i></i><i></i><i></i><i></i><b></b></div>
    <aside class="jump-panel">
      <div class="panel-label">LAST JUMP <span id="result-status">READY</span></div>
      <div class="distance"><span id="distance">—</span><small>UNITS</small></div>
      <div class="jump-metrics"><div><span>PRE SPEED</span><b id="pre-speed">—</b></div><div><span>MAX SPEED</span><b id="max-speed">—</b></div><div><span>STRAFES</span><b id="strafes">—</b></div><div><span>SYNC</span><b id="sync">—</b></div><div><span>EDGE</span><b id="edge">—</b></div><div><span>HEIGHT</span><b id="height">—</b></div></div>
      <canvas id="jump-plot" hidden width="480" height="140" aria-label="Top-down path of the last jump"></canvas>
      <table id="strafe-table" hidden class="strafe-table"><thead><tr><th>#</th><th>KEY</th><th>SYNC</th><th>GAIN</th><th>LOSS</th><th>MAX</th><th>AIR</th><th>WIDTH</th></tr></thead><tbody></tbody></table>
      <div class="pb-row"><span>PERSONAL BEST <small id="pb-tick">${settings.tickRate}T</small></span><strong id="pb">—</strong></div>
      <div id="last-note" class="last-note">Jump to record stats.</div>
    </aside>
    <div id="hint" class="hint">Build to 250. Jump near the edge.</div>
    <div class="info-panel" aria-live="off"><div>Speed: <b id="speed">0</b> <span id="takeoff-speed"></span></div><div>Keys: <span id="keys">_ _ _ _ _ _</span></div></div>
    <div id="kz-chat" class="kz-chat" aria-live="polite"></div>
    <div class="play-controls"><span><kbd data-bind-label="reset"></kbd> RESET</span><span><kbd data-bind-label="save"></kbd> SAVE</span><span><kbd data-bind-label="return"></kbd> RETURN</span><button id="fullscreen" aria-label="Toggle fullscreen">⛶</button></div>
    <div id="toast" role="status"></div>
  </div>
  <dialog id="about"><button id="close-about" class="quiet-button">Close ×</button><h2>Movement &amp; maps</h2><p>An independent recreation of vanilla CS:GO long-jump practice. The classic maps use geometry and packed textures converted from the original 2014 Workshop files. Map creators retain their credits; the Concrete room is our own design.</p><p>The fixed-tick controller uses vanilla acceleration, friction, gravity, hull size, air duck, jump impulse, and the reduced air acceleration near the apex (“deadstrafe”). Select 64 or 128 tick. There is no auto-strafe or auto-bhop.</p><p>Distances use horizontal displacement + the 32-unit player hull. Sync measures airborne ticks with positive speed gain. Stats are a local approximation of KZ jumpstats, not certified server scores.</p><p>This is a playable prototype, not a complete Source engine port. Duck transitions, collision ordering, stamina, and stats still need comparisons against CS:GO demos for exact parity.</p><p>longjump_source_go includes the original courtyard. kz_longjumps_go includes its static 240–249 LJ wing; moving blocks, high jumps, map triggers and angled collision are not supported. Original decals, baked lighting and 2D skyboxes are reproduced; other Source shader effects remain approximate.</p><a href="https://github.com/KZGlobalTeam/gokz/wiki/Modes" target="_blank" rel="noreferrer">GOKZ vanilla movement reference ↗</a></dialog>
`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const movement = new Movement(CONCRETE_GAP); movement.tickRate = settings.tickRate;
let world: World;
let classic: ImportedMap | null = null, loadingMap = false;
let jumpBlock = 0;
try { world = new World($('world'), CONCRETE_GAP); }
catch { $('start').setAttribute('disabled', ''); $('start-note').textContent = 'WebGL is unavailable. Enable hardware acceleration and reload.'; throw new Error('WebGL renderer unavailable'); }
const controls = new Controls(settings.bindings);
let yaw = 0, pitch = 0, locked = false, started = false, settingsPreview = false, jumpUsedLJ = false;
let checkpoint: Position | null = null;
let accumulator = 0, lastTime = performance.now(), uiTime = 0, fallTime = 0, toastTimeout = 0;
const sounds = new Sounds(); sounds.enabled = settings.sound; sounds.volume = settings.volume;
const writeSettings = () => { try { localStorage.setItem('vnl-settings', JSON.stringify(settings)); } catch { /* Private mode can disallow storage. */ } };
function applyPreferences() {
  controls.bindings = settings.bindings; controls.clear();
  world.configureDisplay(settings); world.viewmodel.configure(settings.view);
  if (world.viewmodel.team !== settings.team) void world.viewmodel.setTeam(settings.team);
  sounds.enabled = settings.sound; sounds.volume = settings.volume;
  for (const name of ['guide', 'sound', 'trail', 'viewmodel', 'leftHand'] as const) $<HTMLInputElement>(name).checked = settings[name];
  $<HTMLSelectElement>('team').value = settings.team;
  $<HTMLInputElement>('sensitivity').value = String(settings.sensitivity); $('sensitivity-output').textContent = String(settings.sensitivity);
  $<HTMLInputElement>('volume').value = String(settings.volume); $('volume-output').textContent = `${Math.round(settings.volume * 100)}%`;
  $('mouse-scale-note').textContent = `Mouse scale: sensitivity × ${settings.mouseYaw}° horizontally / ${settings.mousePitch}° vertically per pixel.`;
  document.querySelectorAll<HTMLElement>('[data-bind-label]').forEach(el => el.textContent = settings.bindings[el.dataset.bindLabel as Action][0] ? tokenLabel(settings.bindings[el.dataset.bindLabel as Action][0]) : '—');
  if (!settings.trail) world.disposeGroup(world.trail);
  writeSettings();
}
const settingsPanel = new SettingsPanel($('settings-tab'), settings, applyPreferences);
applyPreferences();
const best = () => Math.max(0, ...history.filter(j => j.valid && j.tickRate === settings.tickRate && (j.mapId ?? 'concrete') === settings.mapId).map(j => j.distance));
function updateSession() {
  $('history-count').textContent = String(history.length);
  const pb = best(); $('pb').textContent = pb ? pb.toFixed(2) : '—'; $('pb-tick').textContent = `${settings.tickRate}T`;
  $('session-list').innerHTML = history.length ? `<div class="session-heading">RECENT JUMPS <span>DIST / SYNC</span></div>${history.slice(0, 5).map(j => `<div class="session-entry"><div><b class="${j.valid ? '' : 'failed'}">${j.distance.toFixed(2)}</b><small>${j.valid ? 'LONG JUMP' : 'MISS'} · ${j.tickRate}T${j.ljBind ? ' · LJ BIND' : ''}</small></div><span>${j.sync.toFixed(0)}% <small>${j.strafes.length} STRAFES</small></span></div>`).join('')}<p class="setting-note">Saved on this browser. Bests are separated by map and tick rate.</p>` : '<div class="empty-session"><p>No jumps recorded.</p><small>Your recent jumps will appear here.</small></div>';
}
function clearResult() {
  for (const id of ['distance', 'pre-speed', 'max-speed', 'strafes', 'sync', 'edge', 'height']) $(id).textContent = '—';
  $('distance').classList.remove('miss'); $('result-status').textContent = 'READY'; $('result-status').classList.remove('failed');
  $('last-note').textContent = 'Jump to record stats.'; $('strafe-table').querySelector('tbody')!.replaceChildren(); $('strafe-table').hidden = true;
  drawPath([], false); world.disposeGroup(world.trail);
}
function reset(toEntry = false) {
  const pose = !toEntry && checkpoint ? checkpoint : mapEntry(classic);
  movement.reset(pose.position); yaw = pose.yaw; pitch = pose.pitch; accumulator = 0; fallTime = 0;
  world.viewmodel.play('draw');
  controls.clearPulses(); jumpUsedLJ = false; jumpBlock = 0;
  $('hud-block').textContent = 'FREE ROAM';
}
async function changeMap(id: MapId) {
  if (loadingMap) return;
  loadingMap = true; $<HTMLButtonElement>('start').disabled = true;
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.disabled = true);
  $('start-note').textContent = 'Loading map…';
  const previous = settings.mapId;
  try {
    const data = await loadMap(id); await world.buildImported(id, data);
    classic = data; settings.mapId = id; document.body.dataset.map = id; movement.boxes = data?.boxes ?? concreteBoxes();
    started = false; checkpoint = null;
    const info = maps.find(m => m.id === id)!;
    document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.map === id)));
    $('map-credit').innerHTML = `${info.credits}${info.workshop ? ` <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${info.workshop}" target="_blank" rel="noreferrer">WORKSHOP ↗</a>` : ''}`;
    $('header-map').textContent = info.name.toUpperCase(); $('hud-map').textContent = info.name.toUpperCase();
    $('menu-map').textContent = info.name;
    $('map-lanes').textContent = data ? `${data.lanes.length} original blocks · ${data.lanes[0].gap}–${data.lanes.at(-1)!.gap} units` : '5 fixed blocks · 220–260 units';
    $('start').querySelector('span')!.textContent = 'Play';
    if (!data) world.buildPlatforms(CONCRETE_GAP);
    loadingMap = false; reset(true); clearResult(); writeSettings(); updateSession();
    $('start-note').textContent = 'Click Play to capture the mouse.';
  } catch (error) { console.error(error); settings.mapId = previous; $('start-note').textContent = 'Map could not load. Choose a map to retry.'; }
  finally { loadingMap = false; $<HTMLButtonElement>('start').disabled = false; document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.disabled = false); }
}
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout); toastTimeout = window.setTimeout(() => $('toast').classList.remove('visible'), 2200); }
// GOKZ jumpstats chat report, coloured by the distance tier.
const tierColors: Record<Voice | 'meh', string> = { meh: '#c4c4c4', impressive: '#5aa0ff', perfect: '#4fd14f', godlike: '#e0453a', ownage: '#f0c419', wrecker: '#d17be6' };
function chat(result: Result) {
  const tier = jumpSound(result.distance, result.valid) ?? 'meh';
  const line = document.createElement('div');
  line.innerHTML = `<p><span class="kz-tag">KZ</span> | <b style="color:${result.valid ? tierColors[tier] : '#c4c4c4'}">${result.valid ? 'LJ' : result.landed ? 'LJ (INVALID)' : 'LJ (FAILED)'}: ${result.distance.toFixed(4)}</b> `
    + `[<em>${result.strafes.length}</em> Strafes | <em>${result.sync.toFixed(0)}%</em> Sync | <em>${result.preSpeed.toFixed(2)}</em> Pre | <em>${result.maxSpeed.toFixed(2)}</em> Max]</p>`
    + `<p>[<em>${result.edge === null ? '—' : result.edge.toFixed(1)}</em> Edge | <em>${result.height.toFixed(2)}</em> Height | <em>${result.ticks}</em> Airtime | <em>${result.overlap}</em> Overlap | <em>${result.deadAir}</em> Dead Air | <em>${result.width.toFixed(1)}°</em> Width]</p>`;
  const feed = $('kz-chat'); feed.prepend(line);
  while (feed.children.length > 4) feed.lastElementChild!.remove();
}
function showResult(result: Result) {
  const previousBest = best();
  const entry: Entry = { ...result, path: result.path.map(p => ({ ...p })), at: Date.now(), mapId: settings.mapId, tickRate: settings.tickRate, gap: jumpBlock, ljBind: jumpUsedLJ };
  history.unshift(entry); history = history.slice(0, 100);
  try { localStorage.setItem('vnl-history', JSON.stringify(history)); } catch { /* Keep session in memory. */ }
  $('distance').textContent = result.distance.toFixed(2); $('distance').classList.toggle('miss', !result.valid);
  $('result-status').textContent = result.valid ? 'LANDED' : result.landed ? 'INVALID' : 'MISS'; $('result-status').classList.toggle('failed', !result.valid);
  $('pre-speed').textContent = result.preSpeed.toFixed(1); $('max-speed').textContent = result.maxSpeed.toFixed(1);
  $('strafes').textContent = String(result.strafes.length); $('sync').textContent = `${result.sync.toFixed(1)}%`;
  $('edge').textContent = result.edge === null ? '—' : result.edge.toFixed(1); $('height').textContent = result.height.toFixed(2);
  $('strafe-table').querySelector('tbody')!.innerHTML = result.strafes.slice(0, 16).map((s, i) => `<tr><td>${i + 1}</td><td>${s.direction > 0 ? 'D' : 'A'}</td><td>${Math.round(s.synced / Math.max(1, s.ticks) * 100)}%</td><td>${s.gain.toFixed(2)}</td><td>${s.loss.toFixed(2)}</td><td>${s.maxSpeed.toFixed(0)}</td><td>${Math.round(s.ticks / Math.max(1, result.ticks) * 100)}%</td><td>${s.width.toFixed(1)}°</td></tr>`).join('');
  const resetKey = settings.bindings.reset[0] ? tokenLabel(settings.bindings.reset[0]) : 'Reset';
  $('last-note').textContent = (result.valid && result.distance > previousBest ? '↗ NEW PERSONAL BEST' : result.valid ? `${result.ducked ? 'DUCKED' : 'STANDING'} · ${result.duration.toFixed(3)}s AIRTIME` : `${result.reason} · ${resetKey} to go again`) + (jumpUsedLJ ? ' · LJ BIND' : '');
  $('strafe-table').hidden = !result.strafes.length;
  chat(result);
  drawPath(result.path, result.valid);
  if (settings.trail) world.showTrail(result.path);
  updateSession(); const voice = jumpSound(result.distance, result.valid); if (voice) sounds.play(voice);
  if (result.valid && result.distance > previousBest) toast(`New best: ${result.distance.toFixed(2)} units`);
}
movement.onResult = showResult;
function drawPath(path: Vec[], landed: boolean) {
  $('jump-plot').hidden = !path.length;
  const c = $<HTMLCanvasElement>('jump-plot').getContext('2d')!; c.clearRect(0, 0, 480, 140);
  c.strokeStyle = '#3c4740'; c.lineWidth = 1;
  for (let y = 25; y < 140; y += 30) { c.beginPath(); c.moveTo(0, y); c.lineTo(480, y); c.stroke(); }
  if (!path.length) return;
  const minX = Math.min(...path.map(p => p.x)), maxX = Math.max(...path.map(p => p.x)), minY = Math.min(...path.map(p => p.y)), maxY = Math.max(...path.map(p => p.y));
  const scale = Math.min(420 / Math.max(1, maxY - minY), 100 / Math.max(40, maxX - minX));
  c.strokeStyle = landed ? '#bbf784' : '#d5ab7e'; c.lineWidth = 2.5; c.beginPath();
  for (const [i, p] of path.entries()) { const x = 25 + (p.y - minY) * scale, y = 70 + (p.x - (minX + maxX) / 2) * scale; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();
}
function setLocked(value: boolean) {
  locked = value; controls.clear(); settingsPanel.cancelCapture(); accumulator = 0; lastTime = performance.now(); movement.jumpHeld = false;
  $('menu').hidden = value; $('hud').hidden = !value;
  document.body.classList.toggle('playing', value);
  $('start').querySelector('span')!.textContent = started ? 'Resume' : 'Play';
}
async function enter() {
  if (loadingMap) return;
  if (innerWidth < 700) { $('start-note').textContent = 'This room needs a desktop keyboard and mouse.'; return; }
  try {
    await world.renderer.domElement.requestPointerLock();
    $('start-note').textContent = 'Click Play to capture the mouse.';
    started = true;
    try { await sounds.unlock(); } catch (error) { console.error(error); toast('Some sounds could not load'); }
  } catch (error) { console.warn('Pointer lock request rejected:', error); $('start-note').textContent = 'Click Play in a focused browser window to capture the mouse.'; }
}
$('start').addEventListener('click', enter);
world.renderer.domElement.addEventListener('click', () => { if (started && !locked && $('about').hasAttribute('open') === false) void enter(); });
document.addEventListener('pointerlockchange', () => setLocked(document.pointerLockElement === world.renderer.domElement));
document.addEventListener('pointerlockerror', () => { $('start-note').textContent = 'Focus a desktop browser window, then click Play again.'; });
document.addEventListener('mousemove', event => { if (locked) {
  yaw += event.movementX * settings.sensitivity * settings.mouseYaw * Math.PI / 180;
  pitch = Math.max(-1.48, Math.min(1.48, pitch - event.movementY * settings.sensitivity * settings.mousePitch * (settings.invertY ? -1 : 1) * Math.PI / 180));
} });
function runAction(action: Action | undefined) {
  if (action === 'reset') { reset(); sounds.play('checkpoint'); toast(checkpoint ? 'Returned to saved position' : 'Returned to map entrance'); }
  if (action === 'save') {
    if (movement.grounded && !movement.ducked && movement.support()) { checkpoint = { position: { ...movement.position }, yaw, pitch }; sounds.play('checkpoint'); toast('Position saved'); }
    else { sounds.play('error'); toast('Save a position while standing'); }
  }
  if (action === 'return') { if (checkpoint) { reset(); sounds.play('checkpoint'); toast('Returned to saved position'); } else { sounds.play('error'); toast('Save a position first'); } }
  if (action === 'inspect' || action === 'light' || action === 'heavy') { if (settings.viewmodel) world.viewmodel.play(action); }
  if (action === 'hints') { settings.guide = !settings.guide; writeSettings(); $<HTMLInputElement>('guide').checked = settings.guide; }
}
document.addEventListener('keydown', event => {
  if (settingsPanel.captureToken(event.code)) { event.preventDefault(); return; }
  if (!locked) return;
  if (controls.action(event.code) || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) event.preventDefault();
  if (!event.repeat) runAction(controls.down(event.code));
});
document.addEventListener('keyup', event => controls.up(event.code));
document.addEventListener('mousedown', event => {
  const token = `Mouse${event.button}`;
  if (settingsPanel.captureToken(token)) { event.preventDefault(); return; }
  if (locked) { event.preventDefault(); runAction(controls.down(token)); }
});
document.addEventListener('mouseup', event => controls.up(`Mouse${event.button}`));
document.addEventListener('wheel', event => {
  if (!event.deltaY) return;
  const token = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (settingsPanel.captureToken(token)) { event.preventDefault(); return; }
  if (locked) { event.preventDefault(); runAction(controls.pulse(token)); }
}, { passive: false });
addEventListener('blur', () => { controls.clear(); settingsPanel.cancelCapture(); if (locked) document.exitPointerLock(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { controls.clear(); if (locked) document.exitPointerLock(); } lastTime = performance.now(); accumulator = 0; });
$('menu-button').addEventListener('click', () => { if (locked) document.exitPointerLock(); });
document.querySelector('.brand')!.addEventListener('click', e => { e.preventDefault(); if (locked) document.exitPointerLock(); });
document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => button.addEventListener('click', () => void changeMap(button.dataset.map as MapId)));
$('tick-toggle').addEventListener('click', () => { settings.tickRate = settings.tickRate === 128 ? 64 : 128; movement.tickRate = settings.tickRate; reset(); $('tick-toggle').innerHTML = `${settings.tickRate} tick <span>↔</span>`; $('header-tick').textContent = `${settings.tickRate} TICK`; writeSettings(); updateSession(); });
$('volume').addEventListener('input', () => { settings.volume = Number($<HTMLInputElement>('volume').value); sounds.volume = settings.volume; $('volume-output').textContent = `${Math.round(settings.volume * 100)}%`; writeSettings(); });
document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => button.addEventListener('click', async () => { try { await sounds.unlock(); sounds.play(button.dataset.sample as Sound, true); } catch (error) { console.error(error); $('start-note').textContent = 'Sound files could not load.'; } }));
$('sensitivity').addEventListener('change', () => {
  const n = Number($<HTMLInputElement>('sensitivity').value);
  settings.sensitivity = Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(0.01, n)) : settings.sensitivity;
  applyPreferences();
});
document.addEventListener('contextmenu', event => { if (locked || !$('settings-tab').hidden) event.preventDefault(); });
document.addEventListener('auxclick', event => { if (locked) event.preventDefault(); });
$('team').addEventListener('change', () => { settings.team = $<HTMLSelectElement>('team').value === 't' ? 't' : 'ct'; void world.viewmodel.setTeam(settings.team); writeSettings(); });
void world.viewmodel.setTeam(settings.team);
for (const name of ['guide', 'sound', 'trail', 'viewmodel', 'leftHand'] as const) $(name).addEventListener('change', () => { settings[name] = $<HTMLInputElement>(name).checked; if (name === 'sound') sounds.enabled = settings.sound; if (name === 'trail') { if (settings.trail && movement.result) world.showTrail(movement.result.path); else world.disposeGroup(world.trail); } writeSettings(); });
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.addEventListener('click', () => { settingsPanel.cancelCapture(); settingsPreview = button.dataset.tab === 'settings'; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button)); for (const name of ['practice', 'maps', 'settings', 'session']) $(`${name}-tab`).hidden = name !== button.dataset.tab; }));
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Fullscreen is unavailable in this browser'); } });
$('about-button').addEventListener('click', () => $<HTMLDialogElement>('about').showModal());
$('close-about').addEventListener('click', () => $<HTMLDialogElement>('about').close());
updateSession(); $('header-tick').textContent = `${settings.tickRate} TICK`;
function updateHUD() {
  if (movement.grounded) { const block = blockAt(mapLanes(classic), movement.support()?.id ?? ''); $('hud-block').textContent = block ? `${block.gap}u BLOCK` : 'FREE ROAM'; }
  const sp = speed(movement.velocity); $('speed').textContent = String(Math.round(sp));
  $('takeoff-speed').textContent = movement.jump ? `(${Math.round(movement.jump.preSpeed)})` : '';
  const input = controls.snapshot(yaw);
  $('keys').textContent = [input.forward > 0 ? 'W' : '_', input.side < 0 || input.overlap ? 'A' : '_', input.forward < 0 ? 'S' : '_',
    input.side > 0 || input.overlap ? 'D' : '_', input.duck ? 'C' : '_', input.jump || movement.jumpHeld ? 'J' : '_'].join(' ');
  $('hint').hidden = !settings.guide;
  if (!movement.grounded) $('hint').textContent = movement.velocity.z <= 0 && !movement.ducked ? 'Duck before landing to reach a little further.' : controls.active('forward') ? `Release ${tokenLabel(settings.bindings.forward[0] ?? 'forward')}. Pair strafe keys with your mouse turn.` : `${tokenLabel(settings.bindings.left[0] ?? 'Left')} + turn left. ${tokenLabel(settings.bindings.right[0] ?? 'Right')} + turn right.`;
  else $('hint').textContent = sp < 240 ? 'Build to 250. Jump near the edge.' : '250 u/s. Jump near the edge.';
}
function view() {
  return { punch: movement.viewPunch, speed: speed(movement.velocity), grounded: movement.grounded, show: settings.viewmodel, leftHand: settings.leftHand };
}
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
  if (locked) {
    accumulator += dt;
    while (accumulator >= 1 / movement.tickRate) {
      if (movement.grounded && !movement.jump) jumpBlock = blockAt(mapLanes(classic), movement.support()?.id ?? '')?.gap ?? 0;
      const input = controls.tick(yaw);
      if (movement.grounded && !movement.jump) jumpUsedLJ = false;
      if (input.lj) jumpUsedLJ = true;
      movement.step(input);
      accumulator -= 1 / movement.tickRate;
      if (belowMap(classic, movement.position)) { fallTime += 1 / movement.tickRate; if (fallTime > 0.32) { reset(); sounds.play('checkpoint'); toast(checkpoint ? 'Returned to saved position' : 'Returned to map entrance'); } } else fallTime = 0;
    }
    world.play(movement.eye(accumulator * movement.tickRate), yaw, pitch, dt, view());
    if (now - uiTime > 40) { updateHUD(); uiTime = now; }
  } else if (!started && !settingsPreview) world.preview(now / 1000);
  else world.play(movement.eye(accumulator * movement.tickRate), yaw, pitch, dt, view());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void changeMap(settings.mapId);
