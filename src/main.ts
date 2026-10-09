import './style.css';
import { createIcons, Play, Maximize, ArrowLeftRight, X } from 'lucide';
import { Movement, speed, type Result, type Vec } from './physics';
import { World } from './world';
import { maps, loadMap, type MapId, type ImportedMap } from './maps';
import { mapEntry, mapLanes, blockAt, belowMap, CONCRETE_GAP, type Position } from './practice';
import { Sounds } from './sounds';
import { soundTiers, jumpSound, type Sound } from './sound-tiers';
import { readHistory, readBests, saveBest, sameCategory, type Entry } from './history';
import { normalizeSettings } from './settings';
import { tokenLabel, type Action } from './bindings';
import { Commands, PITCH_LIMIT, lockMouse } from './commands';
import { SettingsPanel } from './settings-panel';
import { jumpFeedMarkup } from './jump-feed';
import { Engagement } from './engagement';
import { loadAnalytics } from './analytics';
import { PlayGuard } from './play-guard';

function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
const settings = normalizeSettings(read<unknown>('vnl-settings', {}));
const playContext = () => ({ map: settings.mapId, tick_rate: settings.tickRate, auto_bhop: settings.autoBhop });
const engagement = new Engagement(loadAnalytics(), playContext());
window.setInterval(() => engagement.flush(), 30_000);
window.addEventListener('pagehide', () => engagement.setPlaying(false));
document.documentElement.dataset.mode = settings.appearance;
let history = readHistory(read<unknown>('vnl-history', []));
let records = readBests(read<unknown>('vnl-bests', []), history);
const category = (ljBind = false) => ({ mapId: settings.mapId, tickRate: settings.tickRate, autoBhop: settings.autoBhop, ljBind });
const best = (ljBind = false) => records.find(record => sameCategory(record, category(ljBind)))?.distance ?? 0;
function writeRecords() { try { localStorage.setItem('vnl-bests', JSON.stringify(records)); } catch { /* Keep records in memory when storage is unavailable. */ } }
writeRecords();
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="world" aria-label="Three-dimensional long jump practice room"></div>
  <header class="topbar">
    <button id="stats-toggle" class="quiet-button" aria-controls="jump-panel" aria-expanded="false"><span id="stats-toggle-label">Show stats</span> <kbd data-bind-label="stats"></kbd></button>
    <button id="menu-button" class="quiet-button" hidden>Menu <kbd>Esc</kbd></button>
  </header>
  <main id="menu" class="menu">
    <div class="menu-content">
      <h1>longjump</h1>
      <p class="description">cs:go long jump practice</p>
      <div class="current-map"><span>Map</span><strong id="menu-map">Loading…</strong></div>
      <nav class="tabs" aria-label="Practice menu"><button data-tab="practice" class="active">Practice</button><button data-tab="maps">Maps</button><button data-tab="settings">Settings</button><button data-tab="session">History <span id="history-count">0</span></button></nav>
      <section id="practice-tab" class="tab-content">
        <div class="checkpoint-help"><span><kbd data-bind-label="save"></kbd> Save position</span><span><kbd data-bind-label="return"></kbd> Return</span><span><kbd data-bind-label="reset"></kbd> Reset</span></div>
        <div class="profile-row"><span>Vanilla</span><button id="tick-toggle">${settings.tickRate} tick <i data-lucide="arrow-left-right" aria-hidden="true"></i></button></div>
      </section>
      <section id="maps-tab" class="tab-content" hidden>
        <div class="map-options">${maps.map(m => `<button data-map="${m.id}" aria-pressed="false"><b>${m.name}</b><small>${m.detail}</small></button>`).join('')}</div>
        <div id="map-credit" class="map-credit"></div>
      </section>
      <section id="settings-tab" class="tab-content" hidden>
        <label class="setting-range" for="sensitivity">Mouse sensitivity <output id="sensitivity-output">${settings.sensitivity}</output></label><input id="sensitivity" type="number" min="0.01" max="20" step="0.01" value="${settings.sensitivity}"/>
        <label class="toggle-row">Jump stats panel <input id="jumpStats" type="checkbox" ${settings.jumpStats ? 'checked' : ''}/></label>
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
      <button id="start" class="start-button"><i data-lucide="play" aria-hidden="true"></i><span>Play</span></button>
      <div id="start-note" class="start-note">Click Play or press Esc to capture the mouse.</div>
    </div>
    <footer class="menu-footer"><span>Made by <a href="https://twitter.com/yodering" target="_blank" rel="noreferrer">@yodering</a></span><button id="about-button" aria-label="About movement and maps">About</button></footer>
  </main>
    <aside id="jump-panel" class="jump-panel" hidden>
      <div class="panel-label">LAST JUMP <span id="result-status">READY</span></div>
      <div class="distance"><span id="distance">—</span><small>UNITS</small></div>
      <div class="jump-metrics jump-summary"><div><span>PRE SPEED</span><b id="pre-speed">—</b></div><div><span>SYNC</span><b id="sync">—</b></div><div><span>STRAFES</span><b id="strafes">—</b></div></div>
      <details id="jump-details" class="jump-details"><summary>Details</summary>
      <div class="jump-metrics"><div><span>DISTANCE</span><b id="exact-distance">—</b></div><div><span>MAX SPEED</span><b id="max-speed">—</b></div><div><span>EDGE</span><b id="edge">—</b></div><div><span>HEIGHT</span><b id="height">—</b></div><div><span>AIR TICKS</span><b id="air-ticks">—</b></div><div><span>OVERLAP</span><b id="overlap">—</b></div><div><span>DEAD AIR</span><b id="dead-air">—</b></div><div><span>WIDTH</span><b id="jump-width">—</b></div></div>
      <canvas id="jump-plot" hidden width="480" height="140" aria-label="Top-down path of the last jump"></canvas>
      <table id="strafe-table" hidden class="strafe-table"><thead><tr><th>#</th><th>KEY</th><th>SYNC</th><th>GAIN</th><th>LOSS</th><th>MAX</th><th>AIR</th><th>WIDTH</th></tr></thead><tbody></tbody></table>
      <div class="pb-row"><span>PERSONAL BEST <small id="pb-tick">${settings.tickRate}T</small></span><strong id="pb">—</strong></div>
      <div id="last-note" class="last-note">Jump to record stats.</div>
      </details>
    </aside>
  <div id="hud" hidden>
    <div id="crosshair" class="cs-crosshair"><i></i><i></i><i></i><i></i><b></b></div>
    <div class="info-panel" aria-live="off"><div>Speed: <b id="speed">0</b> <span id="takeoff-speed"></span></div><div>Keys: <span id="keys">_ _ _ _ _ _</span></div><div id="hud-pb" class="hud-pb" hidden></div></div>
    <div id="kz-chat" class="kz-chat" aria-live="polite"></div>
    <div class="play-controls"><span><kbd data-bind-label="reset"></kbd> RESET</span><span><kbd data-bind-label="save"></kbd> SAVE</span><span><kbd data-bind-label="return"></kbd> RETURN</span><button id="fullscreen" aria-label="Toggle fullscreen"><i data-lucide="maximize" aria-hidden="true"></i></button></div>
    <div id="toast" role="status"></div>
  </div>
  <dialog id="about" aria-labelledby="about-title">
    <button id="close-about" class="quiet-button">Close <i data-lucide="x" aria-hidden="true"></i></button>
    <h2 id="about-title">About longjump</h2>
    <p>With more games making their way to the browser, we wanted to bring vanilla CS:GO long jumping into the mix.</p>
    <section class="about-credits" aria-labelledby="map-credits-title">
      <h3 id="map-credits-title">Maps</h3>
      <ul class="credits-list">
        <li><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=249758765" target="_blank" rel="noreferrer">longjump_source_go</a><p>Original by AZiRES. CS:GO port by badgec / kernel.</p></li>
        <li><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=249444895" target="_blank" rel="noreferrer">kz_longjumps_go</a><p>Draw (CS 1.6), THEBUGUSER (Source), badgec / kernel (CS:GO).</p></li>
      </ul>
    </section>
    <section class="about-credits" aria-labelledby="movement-credits-title">
      <h3 id="movement-credits-title">Movement &amp; jump stats</h3>
      <ul class="credits-list">
        <li><a href="https://github.com/perilouswithadollarsign/cstrike15_src/tree/f82112a2388b841d72cb62ca48ab1846dfcc11c8" target="_blank" rel="noreferrer">CS:GO movement reference</a><p>Valve's movement, input and collision behavior.</p></li>
        <li><a href="https://github.com/KZGlobalTeam/gokz/wiki/Modes" target="_blank" rel="noreferrer">GOKZ vanilla settings</a> · <a href="https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/gokz-jumpstats/jump_tracking.sp" target="_blank" rel="noreferrer">Jump tracking</a><p>References by KZGlobalTeam and GOKZ contributors.</p></li>
        <li><a href="https://gist.github.com/zer0k-z/808bc8bfc494e0bbb5a423c2b1ca6685" target="_blank" rel="noreferrer">Deadstrafe notes</a> by zer0k-z.</li>
      </ul>
    </section>
    <section class="about-credits" aria-labelledby="asset-credits-title">
      <h3 id="asset-credits-title">Assets &amp; interface</h3>
      <ul class="credits-list">
        <li>Valve: original map materials, knife and arms, and game sounds.</li>
        <li><a href="https://github.com/KZGlobalTeam/gokz" target="_blank" rel="noreferrer">GOKZ</a>: announcer sounds. <a href="https://github.com/sourcesounds/csgo" target="_blank" rel="noreferrer">sourcesounds/csgo</a>: Valve sound recordings.</li>
        <li><a href="https://www.graphicalui.com/" target="_blank" rel="noreferrer">Graphical</a>: UI theme. <a href="https://rsms.me/inter/" target="_blank" rel="noreferrer">Inter</a>: typeface. <a href="https://lucide.dev/" target="_blank" rel="noreferrer">Lucide</a>: icons.</li>
      </ul>
    </section>
    <p class="about-note">An independent project, not affiliated with Valve.</p>
  </dialog>
`;
createIcons({ icons: { Play, Maximize, ArrowLeftRight, X }, attrs: { 'aria-hidden': 'true' } });
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const movement = new Movement(CONCRETE_GAP); movement.tickRate = settings.tickRate;
let world: World;
let classic: ImportedMap | null = null, loadingMap = false;
let jumpBlock = 0;
try { world = new World($('world'), CONCRETE_GAP); }
catch { $('start').setAttribute('disabled', ''); $('start-note').textContent = 'WebGL is unavailable. Enable hardware acceleration and reload.'; throw new Error('WebGL renderer unavailable'); }
const commands = new Commands(settings.bindings);
const playGuard = new PlayGuard(window, (navigator as Navigator & { keyboard?: { lock: (keys: string[]) => Promise<void>; unlock: () => void } }).keyboard);
const controls = commands.live;
let yaw = 0, pitch = 0, locked = false, started = false, settingsPreview = false, jumpUsedLJ = false;
let checkpoint: Position | null = null;
let lastTime = performance.now(), uiTime = 0, fallTime = 0, toastTimeout = 0;
let plotPath: Vec[] = [], plotLanded = false;
const sounds = new Sounds(); sounds.enabled = settings.sound; sounds.volume = settings.volume;
const writeSettings = () => { try { localStorage.setItem('vnl-settings', JSON.stringify(settings)); } catch { /* Private mode can disallow storage. */ } };
function applyPreferences() {
  engagement.configure(playContext());
  movement.autoBhop = settings.autoBhop;
  document.documentElement.dataset.mode = settings.appearance;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--neutral-1').trim());
  if (plotPath.length) drawPath(plotPath, plotLanded);
  controls.bindings = settings.bindings; controls.clear(); commands.reset(performance.now(), yaw);
  world.configureDisplay(settings); world.viewmodel.configure(settings.view);
  if (world.viewmodel.team !== settings.team) void world.viewmodel.setTeam(settings.team);
  sounds.enabled = settings.sound; sounds.volume = settings.volume;
  for (const name of ['jumpStats', 'sound', 'trail', 'viewmodel', 'leftHand'] as const) $<HTMLInputElement>(name).checked = settings[name];
  $<HTMLSelectElement>('team').value = settings.team;
  $<HTMLInputElement>('sensitivity').value = String(settings.sensitivity); $('sensitivity-output').textContent = String(settings.sensitivity);
  $<HTMLInputElement>('volume').value = String(settings.volume); $('volume-output').textContent = `${Math.round(settings.volume * 100)}%`;
  $('mouse-scale-note').textContent = `Mouse scale: sensitivity × ${settings.mouseYaw}° horizontally / ${settings.mousePitch}° vertically per pixel.`;
  document.querySelectorAll<HTMLElement>('[data-bind-label]').forEach(el => el.textContent = settings.bindings[el.dataset.bindLabel as Action][0] ? tokenLabel(settings.bindings[el.dataset.bindLabel as Action][0]) : '—');
  updateStatsPanel(); updateSession();
  if (!settings.trail) world.disposeGroup(world.trail);
  writeSettings();
}
const settingsPanel = new SettingsPanel($('settings-tab'), settings, applyPreferences);
applyPreferences();
function updateStatsPanel() {
  $('jump-panel').hidden = !settings.jumpStats;
  $('stats-toggle-label').textContent = settings.jumpStats ? 'Hide stats' : 'Show stats';
  $('stats-toggle').setAttribute('aria-expanded', String(settings.jumpStats));
  $<HTMLInputElement>('jumpStats').checked = settings.jumpStats;
}
function toggleStatsPanel() {
  settings.jumpStats = !settings.jumpStats; updateStatsPanel(); writeSettings();
}
function updateSession() {
  $('history-count').textContent = String(history.length);
  const pb = best(); $('pb').textContent = pb ? pb.toFixed(2) : '—'; $('pb-tick').textContent = `${settings.tickRate}T${settings.autoBhop ? ' · AUTO' : ''}`;
  const ljBest = best(true);
  $('hud-pb').hidden = !pb && !ljBest; $('hud-pb').textContent = [pb ? `PB: ${pb.toFixed(2)}` : '', ljBest ? `LJ bind PB: ${ljBest.toFixed(2)}` : '', `${settings.tickRate}T${settings.autoBhop ? ' · AUTO' : ''}`].filter(Boolean).join(' · ');
  const currentRecords = records.filter(j => j.mapId === settings.mapId && j.tickRate === settings.tickRate);
  const mode = (j: Entry) => `${j.autoBhop === undefined ? 'LEGACY' : j.autoBhop ? 'AUTO-HOP' : 'MANUAL'}${j.ljBind ? ' · LJ BIND' : ''}`;
  const bestMarkup = `<div class="session-heading">PERSONAL BESTS <span>${settings.tickRate}T</span></div>${currentRecords.length ? currentRecords.map(j => `<div class="session-entry"><div><b>${j.distance.toFixed(2)}</b><small>${mode(j)} · ${Number.isFinite(j.at) ? new Date(j.at).toLocaleDateString() : 'Earlier session'}</small></div><span>${j.sync.toFixed(0)}% <small>${j.strafes.length} STRAFES</small></span></div>`).join('') : '<p class="setting-note">No best for this map and tick rate yet.</p>'}`;
  $('session-list').innerHTML = bestMarkup + (history.length ? `<div class="session-heading">RECENT JUMPS <span>DIST / SYNC</span></div>${history.slice(0, 5).map(j => `<div class="session-entry"><div><b class="${j.valid ? '' : 'failed'}">${j.distance.toFixed(2)}</b><small>${j.valid ? 'LONG JUMP' : 'MISS'} · ${j.tickRate}T · ${mode(j)}</small></div><span>${j.sync.toFixed(0)}% <small>${j.strafes.length} STRAFES</small></span></div>`).join('')}<p class="setting-note">Saved in this browser. Bests stay after recent attempts roll off.</p>` : '<div class="empty-session"><p>No jumps recorded.</p><small>Complete a jump to see your stats.</small></div>');
}
function clearResult() {
  for (const id of ['distance', 'pre-speed', 'max-speed', 'strafes', 'sync', 'edge', 'height', 'air-ticks', 'overlap', 'dead-air', 'jump-width', 'exact-distance']) $(id).textContent = '—';
  $('distance').classList.remove('miss'); $('result-status').textContent = 'READY'; $('result-status').classList.remove('failed');
  $('last-note').textContent = 'Jump to record stats.'; $('strafe-table').querySelector('tbody')!.replaceChildren(); $('strafe-table').hidden = true;
  $('kz-chat').replaceChildren();
  drawPath([], false); world.disposeGroup(world.trail);
}
function reset(toEntry = false) {
  const pose = !toEntry && checkpoint ? checkpoint : mapEntry(classic);
  movement.reset(pose.position); yaw = pose.yaw; pitch = pose.pitch; commands.reset(performance.now(), yaw); fallTime = 0;
  world.viewmodel.resetMotion();
  if (toEntry) world.viewmodel.play('draw');
  controls.clearPulses(); jumpUsedLJ = false; jumpBlock = 0;
}
async function changeMap(id: MapId) {
  if (loadingMap) return;
  loadingMap = true; $<HTMLButtonElement>('start').disabled = true;
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.disabled = true);
  $('start-note').textContent = 'Loading map…';
  const previous = settings.mapId;
  try {
    const data = await loadMap(id); await world.buildImported(id, data);
    classic = data; settings.mapId = id; document.body.dataset.map = id; movement.boxes = data.boxes;
    started = false; checkpoint = null;
    const info = maps.find(m => m.id === id)!;
    document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.map === id)));
    $('map-credit').innerHTML = `${info.credits}${info.workshop ? ` <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${info.workshop}" target="_blank" rel="noreferrer">WORKSHOP ↗</a>` : ''}`;
    $('menu-map').textContent = info.name;
    $('start').querySelector('span')!.textContent = 'Play';
    loadingMap = false; reset(true); clearResult(); writeSettings(); updateSession();
    engagement.configure(playContext()); engagement.mapLoaded();
    $('start-note').textContent = 'Click Play or press Esc to capture the mouse.';
  } catch (error) { console.error(error); settings.mapId = previous; $('start-note').textContent = 'Map could not load. Choose a map to retry.'; }
  finally { loadingMap = false; $<HTMLButtonElement>('start').disabled = false; document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.disabled = false); }
}
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout); toastTimeout = window.setTimeout(() => $('toast').classList.remove('visible'), 2200); }
function chat(result: Result) {
  const line = document.createElement('div');
  line.innerHTML = jumpFeedMarkup(result);
  const feed = $('kz-chat');
  feed.append(line);
  while (feed.children.length > 4) feed.firstElementChild!.remove();
}
function showResult(result: Result) {
  engagement.jumpCompleted(result);
  const previousBest = best(jumpUsedLJ);
  const entry: Entry = { ...result, path: result.path.map(p => ({ ...p })), at: Date.now(), mapId: settings.mapId, tickRate: settings.tickRate, gap: jumpBlock, ljBind: jumpUsedLJ, autoBhop: settings.autoBhop };
  const updatedRecords = saveBest(records, entry);
  if (updatedRecords !== records) { records = updatedRecords; writeRecords(); }
  history.unshift(entry); history = history.slice(0, 100);
  try { localStorage.setItem('vnl-history', JSON.stringify(history)); } catch { /* Keep session in memory. */ }
  $('distance').textContent = result.distance.toFixed(2); $('distance').classList.toggle('miss', !result.valid);
  $('result-status').textContent = result.valid ? 'LANDED' : result.landed ? 'INVALID' : 'MISS'; $('result-status').classList.toggle('failed', !result.valid);
  $('pre-speed').textContent = result.preSpeed.toFixed(1); $('max-speed').textContent = result.maxSpeed.toFixed(1);
  $('strafes').textContent = String(result.strafes.length); $('sync').textContent = `${result.sync.toFixed(1)}%`;
  $('edge').textContent = result.edge === null ? '—' : result.edge.toFixed(1); $('height').textContent = result.height.toFixed(2);
  $('exact-distance').textContent = result.distance.toFixed(4);
  $('air-ticks').textContent = String(result.ticks); $('overlap').textContent = String(result.overlap);
  $('dead-air').textContent = String(result.deadAir); $('jump-width').textContent = `${result.width.toFixed(1)}°`;
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
  plotPath = path; plotLanded = landed;
  $('jump-plot').hidden = !path.length;
  const c = $<HTMLCanvasElement>('jump-plot').getContext('2d')!; c.clearRect(0, 0, 480, 140);
  const palette = getComputedStyle(document.documentElement);
  c.strokeStyle = palette.getPropertyValue('--neutral-4'); c.lineWidth = 1;
  for (let y = 25; y < 140; y += 30) { c.beginPath(); c.moveTo(0, y); c.lineTo(480, y); c.stroke(); }
  if (!path.length) return;
  const minX = Math.min(...path.map(p => p.x)), maxX = Math.max(...path.map(p => p.x)), minY = Math.min(...path.map(p => p.y)), maxY = Math.max(...path.map(p => p.y));
  const scale = Math.min(420 / Math.max(1, maxY - minY), 100 / Math.max(40, maxX - minX));
  c.strokeStyle = palette.getPropertyValue(landed ? '--success' : '--warning'); c.lineWidth = 2.5; c.beginPath();
  for (const [i, p] of path.entries()) { const x = 25 + (p.y - minY) * scale, y = 70 + (p.x - (minX + maxX) / 2) * scale; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke();
}
function setLocked(value: boolean) {
  // Closing can blur the tab before beforeunload. Keep confirmation armed
  // until focus returns or the player explicitly pauses.
  if (value || document.hasFocus()) playGuard.setPlaying(value, !!document.fullscreenElement);
  else void playGuard.capture(false);
  engagement.setPlaying(value && !document.hidden);
  locked = value; controls.clear(); settingsPanel.cancelCapture(); lastTime = performance.now(); commands.reset(lastTime, yaw); movement.jumpHeld = false;
  $('menu').hidden = value; $('hud').hidden = !value; $('menu-button').hidden = !value;
  if (value) $<HTMLDetailsElement>('jump-details').open = false;
  document.body.classList.toggle('playing', value);
  $('start').querySelector('span')!.textContent = started ? 'Resume' : 'Play';
}
async function enter() {
  if (loadingMap) return;
  if (innerWidth < 700) { $('start-note').textContent = 'This room needs a desktop keyboard and mouse.'; return; }
  try {
    await lockMouse(world.renderer.domElement);
    $('start-note').textContent = 'Click Play or press Esc to capture the mouse.';
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
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - event.movementY * settings.sensitivity * settings.mousePitch * (settings.invertY ? -1 : 1) * Math.PI / 180));
  commands.look(yaw, event.timeStamp);
} });
function runAction(action: Action | undefined) {
  if (action === 'reset') { reset(); sounds.play('checkpoint'); }
  if (action === 'save') {
    if (movement.grounded && !movement.ducked && movement.support()) { checkpoint = { position: { ...movement.position }, yaw, pitch }; sounds.play('checkpoint'); toast('Position saved'); }
    else { sounds.play('error'); toast('Save a position while standing'); }
  }
  if (action === 'return') { if (checkpoint) { reset(); sounds.play('checkpoint'); } else { sounds.play('error'); toast('Save a position first'); } }
  if (action === 'inspect' || action === 'light' || action === 'heavy') { if (settings.viewmodel) world.viewmodel.play(action); }
  if (action === 'stats') toggleStatsPanel();
}
document.addEventListener('keydown', event => {
  if (settingsPanel.captureToken(event.code)) { event.preventDefault(); return; }
  if (event.code === 'Escape') {
    // A modal keeps its native Escape-to-dismiss behavior. Binding capture
    // above also gets the first Escape, so cancelling never resumes play.
    if ($<HTMLDialogElement>('about').open || event.defaultPrevented) return;
    event.preventDefault();
    if (event.repeat) return;
    if (locked) {
      playGuard.setPlaying(false, false);
      document.exitPointerLock();
    } else {
      // Commit any focused settings input before hiding the menu.
      (document.activeElement as HTMLElement | null)?.blur();
      void enter();
    }
    return;
  }
  if (!locked) return;
  if (controls.action(event.code) || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) event.preventDefault();
  if (!event.repeat) runAction(commands.button('down', event.code, event.timeStamp));
});
document.addEventListener('keyup', event => { if (locked) commands.button('up', event.code, event.timeStamp); });
document.addEventListener('mousedown', event => {
  const token = `Mouse${event.button}`;
  if (settingsPanel.captureToken(token)) { event.preventDefault(); return; }
  if (locked) { event.preventDefault(); runAction(commands.button('down', token, event.timeStamp)); }
});
document.addEventListener('mouseup', event => { if (locked) commands.button('up', `Mouse${event.button}`, event.timeStamp); });
document.addEventListener('wheel', event => {
  if (!event.deltaY) return;
  const token = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (settingsPanel.captureToken(token)) { event.preventDefault(); return; }
  if (locked) { event.preventDefault(); runAction(commands.button('pulse', token, event.timeStamp)); }
}, { passive: false });
addEventListener('blur', () => { controls.clear(); commands.reset(performance.now(), yaw); settingsPanel.cancelCapture(); if (locked) document.exitPointerLock(); });
addEventListener('focus', () => { if (!locked) playGuard.setPlaying(false, false); });
document.addEventListener('fullscreenchange', () => { void playGuard.capture(locked && !!document.fullscreenElement); });
document.addEventListener('visibilitychange', () => { engagement.setPlaying(locked && !document.hidden); if (document.hidden) { controls.clear(); if (locked) document.exitPointerLock(); } lastTime = performance.now(); commands.reset(lastTime, yaw); });
$('stats-toggle').addEventListener('click', toggleStatsPanel);
$('menu-button').addEventListener('click', () => { playGuard.setPlaying(false, false); if (locked) document.exitPointerLock(); });
document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => button.addEventListener('click', () => void changeMap(button.dataset.map as MapId)));
$('tick-toggle').addEventListener('click', () => { settings.tickRate = settings.tickRate === 128 ? 64 : 128; engagement.configure(playContext()); movement.tickRate = settings.tickRate; reset(); $('tick-toggle').innerHTML = `${settings.tickRate} tick <i data-lucide="arrow-left-right" aria-hidden="true"></i>`; createIcons({ icons: { ArrowLeftRight }, attrs: { 'aria-hidden': 'true' } }); writeSettings(); updateSession(); });
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
for (const name of ['jumpStats', 'sound', 'trail', 'viewmodel', 'leftHand'] as const) $(name).addEventListener('change', () => { settings[name] = $<HTMLInputElement>(name).checked; if (name === 'jumpStats') updateStatsPanel(); if (name === 'sound') sounds.enabled = settings.sound; if (name === 'trail') { if (settings.trail && movement.result) world.showTrail(movement.result.path); else world.disposeGroup(world.trail); } writeSettings(); });
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.addEventListener('click', () => { settingsPanel.cancelCapture(); settingsPreview = button.dataset.tab === 'settings'; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button)); for (const name of ['practice', 'maps', 'settings', 'session']) $(`${name}-tab`).hidden = name !== button.dataset.tab; }));
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Fullscreen is unavailable in this browser'); } });
$('about-button').addEventListener('click', () => $<HTMLDialogElement>('about').showModal());
$('close-about').addEventListener('click', () => $<HTMLDialogElement>('about').close());
updateSession(); createIcons({ icons: { ArrowLeftRight }, attrs: { 'aria-hidden': 'true' } });
function updateHUD() {
  const sp = speed(movement.velocity); $('speed').textContent = String(Math.round(sp));
  $('takeoff-speed').textContent = movement.jump ? `(${Math.round(movement.jump.preSpeed)})` : '';
  const input = controls.snapshot(yaw);
  $('keys').textContent = [input.forward > 0 ? 'W' : '_', input.side < 0 || input.overlap ? 'A' : '_', input.forward < 0 ? 'S' : '_',
    input.side > 0 || input.overlap ? 'D' : '_', input.duck ? 'C' : '_', input.jump || movement.jumpHeld ? 'J' : '_'].join(' ');
}
function view() {
  return { punch: movement.viewPunch, speed: speed(movement.velocity), grounded: movement.grounded, show: settings.viewmodel, leftHand: settings.leftHand };
}
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
  if (locked) {
    commands.advance(now, movement.tickRate, input => {
      if (movement.grounded && !movement.jump) jumpBlock = blockAt(mapLanes(classic), movement.support()?.id ?? '')?.gap ?? 0;
      if (movement.grounded && !movement.jump) jumpUsedLJ = false;
      if (input.lj) jumpUsedLJ = true;
      movement.step(input);
      if (belowMap(classic, movement.position)) { fallTime += 1 / movement.tickRate; if (fallTime > 0.32) { reset(); sounds.play('checkpoint'); } } else fallTime = 0;
    });
    world.play(movement.eye(commands.alpha), yaw, pitch, dt, view());
    if (now - uiTime > 40) { updateHUD(); uiTime = now; }
  } else if (!started && !settingsPreview) world.preview(now / 1000);
  else world.play(movement.eye(1), yaw, pitch, dt, view());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void changeMap(settings.mapId);
