import './style.css';
import { createIcons, Play, Maximize, Minimize, ArrowLeftRight, X } from 'lucide';
import { Movement, speed, type Result, type Vec } from './physics';
import { World } from './world';
import { maps, loadMap, type MapId, type ImportedMap } from './maps';
import { mapEntry, mapLanes, blockAt, belowMap, CONCRETE_GAP, type Position } from './practice';
import { Sounds } from './sounds';
import { soundTiers, jumpSound, type Sound } from './sound-tiers';
import { readHistory, readBests, saveBest, sameCategory, type Entry } from './history';
import { HistoryArchive } from './history-archive';
import { HistoryPanel } from './history-panel';
import { LeaderboardPanel } from './leaderboard-panel';
import { JumpRecorder } from './replay';
import { Identity } from './identity';
import { RoomClient, type RoomJump } from './room';
import { RoomPanel } from './room-panel';
import { RemotePlayers, type SpectatorView } from './remote-players';
import { escapeHtml } from './html';
import { fingerprint, readCheckpoints, checkpointForMap, type SavedPosition } from './backup';
import { normalizeSettings } from './settings';
import { tokenLabel, type Action } from './bindings';
import { Commands, PITCH_LIMIT, lockMouse } from './commands';
import { SettingsPanel } from './settings-panel';
import { jumpFeedMarkup } from './jump-feed';
import { Engagement } from './engagement';
import { loadAnalytics } from './analytics';
import { PlayGuard } from './play-guard';

// Play needs pointer lock, a keyboard and room for the HUD; tell small or touch screens up front.
const DEVICE_NOTE = 'Hey! longjump works best on a large display with a keyboard and mouse.';
const READY_NOTE = matchMedia('(max-width: 699px), (pointer: coarse)').matches ? DEVICE_NOTE : 'Play captures your mouse. Esc releases it.';
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
const settings = normalizeSettings(read<unknown>('vnl-settings', {}));
const playContext = () => ({ map: settings.mapId, tick_rate: settings.tickRate, auto_bhop: settings.autoBhop });
const engagement = new Engagement(loadAnalytics(), playContext());
window.setInterval(() => engagement.flush(), 30_000);
window.addEventListener('pagehide', () => engagement.setPlaying(false));
document.documentElement.dataset.mode = settings.appearance;
const legacyHistory = readHistory(read<unknown>('vnl-history', []));
const archive = new HistoryArchive(legacyHistory);
let historyPanel: HistoryPanel | undefined;
let records = readBests(read<unknown>('vnl-bests', []), legacyHistory);
const category = () => ({ mapId: settings.mapId, tickRate: settings.tickRate, autoBhop: settings.autoBhop });
const best = () => records.find(record => sameCategory(record, category()))?.distance ?? 0;
function writeRecords() { try { localStorage.setItem('vnl-bests', JSON.stringify(records)); } catch { /* Keep records in memory when storage is unavailable. */ } }
writeRecords();
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="world" aria-label="Three-dimensional long jump practice room"></div>
  <header class="topbar">
    <button id="stats-toggle" class="quiet-button" aria-controls="jump-panel" aria-expanded="false"><span id="stats-toggle-label">Show stats</span> <kbd data-bind-label="stats"></kbd></button>
    <div id="menu-hint" class="quiet-button menu-hint" hidden>Menu <kbd id="menu-key">P</kbd><button id="menu-hint-close" class="menu-hint-close" aria-label="Hide menu hint" title="Hide menu hint"><i data-lucide="x" aria-hidden="true"></i></button></div>
  </header>
  <main id="menu" class="menu">
    <header class="menu-header">
      <div class="menu-title"><h1>longjump</h1><span class="menu-meta"><b id="menu-map">Loading…</b> · <span id="menu-tick">${settings.tickRate} tick</span></span></div>
      <nav class="tabs" aria-label="Practice menu"><button data-tab="practice" class="active">Practice</button><button data-tab="maps">Maps</button><button data-tab="settings">Settings</button><button data-tab="session">History <span id="history-count">0</span></button><button data-tab="leaderboard">Leaderboard</button></nav>
    </header>
    <div class="menu-content">
      <section id="practice-tab" class="tab-content">
        <div class="checkpoint-help"><span><kbd data-bind-label="save"></kbd> Save position</span><span><kbd data-bind-label="return"></kbd> Return</span><span><kbd data-bind-label="reset"></kbd> Reset</span></div>
        <div class="profile-row"><span>Vanilla</span><button id="tick-toggle">${settings.tickRate} tick <i data-lucide="arrow-left-right" aria-hidden="true"></i></button></div>
        <div id="room-panel" class="room-panel"></div>
      </section>
      <section id="maps-tab" class="tab-content" hidden>
        <div class="map-options">${maps.map(m => `<button data-map="${m.id}" aria-pressed="false"><b>${m.name}</b><small>${m.detail}</small></button>`).join('')}</div>
        <div id="map-credit" class="map-credit"></div>
      </section>
      <section id="settings-tab" class="tab-content" hidden></section>
      <section id="session-tab" class="tab-content" hidden><div id="personal-bests"></div><div id="history-browser"></div></section>
      <section id="leaderboard-tab" class="tab-content" hidden></section>
    </div>
    <div class="menu-actions">
      <div class="start-row"><button id="start" class="start-button"><i data-lucide="play" aria-hidden="true"></i><span>Play</span></button><button id="start-fullscreen" class="settings-button start-fullscreen"></button></div>
      <div id="start-note" class="start-note">${READY_NOTE}</div>
    </div>
    <footer class="menu-footer"><span>Made by <a href="https://twitter.com/yodering" target="_blank" rel="noreferrer">@yodering</a></span><button id="about-button" aria-label="About movement and maps">About</button></footer>
  </main>
    <div class="corner-stack">
    <section id="leaderboard-prompt" class="leaderboard-prompt" aria-label="Post to the leaderboard" hidden></section>
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
    </div>
  <div id="hud" hidden>
    <div id="crosshair" class="cs-crosshair"><i></i><i></i><i></i><i></i><b></b></div>
    <div id="crosshair-speed" class="crosshair-speed" aria-hidden="true"><span id="crosshair-speed-now">0.00</span><span id="crosshair-speed-pre"></span></div>
    <div id="spectate-banner" class="spectate-banner" hidden></div>
    <div id="info-panel" class="info-panel" aria-live="off"><div id="info-speed">Speed: <b id="speed">0</b> <span id="takeoff-speed"></span></div><div id="info-keys">Keys: <span id="keys">_ _ _ _ _ _</span></div><div id="info-pb" class="hud-pb" hidden></div></div>
    <div id="kz-chat" class="kz-chat" aria-live="polite"></div>
    <div class="play-controls"><span data-hint><kbd data-bind-label="reset"></kbd> RESET</span><span data-hint><kbd data-bind-label="save"></kbd> SAVE</span><span data-hint><kbd data-bind-label="return"></kbd> RETURN</span></div>
  </div>
  <div id="toast" role="status"></div>
  <dialog id="about" aria-labelledby="about-title">
    <button id="close-about" class="quiet-button">Close <i data-lucide="x" aria-hidden="true"></i></button>
    <h2 id="about-title">About longjump</h2>
    <p>With more games making their way to the browser, we wanted to bring vanilla CS:GO long jumping into the mix.</p>
    <section class="about-credits" aria-labelledby="map-credits-title">
      <h3 id="map-credits-title">Maps</h3>
      <ul class="credits-list">
        <li><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=249758765" target="_blank" rel="noreferrer">longjump_source_go</a><p>Original by AZiRES. CS:GO port by badgec / kernel.</p></li>
        <li><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=249444895" target="_blank" rel="noreferrer">kz_longjumps_go</a><p>Draw (CS 1.6), THEBUGUSER (Source), badgec / kernel (CS:GO).</p></li>
        <li><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=1366794864" target="_blank" rel="noreferrer">kz_baxter</a><p>Samuel. LJ room by xq. Textures by TopHATTwaffle &amp; Saspatoon.</p></li>
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
        <li>Valve: original map materials, knife and arms, player models and animations, and game sounds.</li>
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
const recorder = new JumpRecorder();
let yaw = 0, pitch = 0, locked = false, started = false, settingsPreview = false, jumpUsedLJ = false;
// The room player being watched in first person; local movement is paused meanwhile.
let spectating: string | null = null;
let checkpoint: Position | null = null;
let savedPositions: SavedPosition[] = [];
try { savedPositions = readCheckpoints(read<unknown>('vnl-checkpoints', [])); } catch { /* Discard malformed saved positions. */ }
let mapContentVersion = '';
let lastTime = performance.now(), fallTime = 0, toastTimeout = 0;
let plotPath: Vec[] = [], plotLanded = false;
const sounds = new Sounds(); sounds.enabled = settings.sound; sounds.volume = settings.volume;
const writeSettings = () => { try { localStorage.setItem('vnl-settings', JSON.stringify(settings)); } catch { /* Private mode can disallow storage. */ } };
function applyPreferences() {
  engagement.configure(playContext());
  movement.autoBhop = settings.autoBhop;
  document.documentElement.dataset.mode = settings.appearance;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--neutral-1').trim());
  if (plotPath.length) drawPath(plotPath, plotLanded);
  controls.bindings = settings.bindings; controls.nullBind = settings.nullBind; controls.clear(); commands.reset(performance.now(), yaw);
  remote.group.visible = settings.showPlayers; roomPanel?.render();
  world.configureDisplay(settings); world.viewmodel.configure(settings.view);
  if (world.viewmodel.team !== settings.team) void world.viewmodel.setTeam(settings.team);
  sounds.enabled = settings.sound; sounds.volume = settings.volume;
  document.querySelectorAll<HTMLElement>('[data-bind-label]').forEach(el => el.textContent = settings.bindings[el.dataset.bindLabel as Action][0] ? tokenLabel(settings.bindings[el.dataset.bindLabel as Action][0]) : '—');
  $('menu-key').textContent = settings.bindings.menu[0] ? tokenLabel(settings.bindings.menu[0]) : 'Esc';
  updateStatsPanel(); updateSession();
  if (!settings.trail) world.disposeGroup(world.trail);
  else if (!world.trail.children.length && movement.result) world.showTrail(movement.result.path);
  writeSettings();
}
const settingsPanel = new SettingsPanel($('settings-tab'), settings, applyPreferences, () => previewHud());
const identity = new Identity();
const leaderboard = new LeaderboardPanel($('leaderboard-tab'), $('leaderboard-prompt'), identity, message => toast(message));
// Rooms relay poses and announcements only; local movement never waits on them.
const remote = new RemotePlayers(); world.scene.add(remote.group);
// Assigned below; the panel can trigger room events while it is being created (invite links).
let roomPanel: RoomPanel | undefined;
const room = new RoomClient(identity, import.meta.env.VITE_PHYSICS_VERSION ?? '', {
  changed: () => {
    remote.sync(room.players, room.you); if (!room.code) remote.clear();
    if (spectating && (!room.code || !room.players.has(spectating))) spectate(null);
    roomPanel?.render();
  },
  poses: (at, players) => remote.receive(at, players, performance.now()),
  joined: name => feedLine(`<p><span class="kz-tag">${escapeHtml(name)}</span> joined the room</p>`),
  left: name => feedLine(`<p><span class="kz-tag">${escapeHtml(name)}</span> left the room</p>`),
  jump: announceJump,
  map: (id, by) => {
    remote.forgetPositions();
    // The feed survives map loads, so room lines that arrive mid-load stay visible.
    if (by) feedLine(`<p><span class="kz-tag">${escapeHtml(by)}</span> switched to ${escapeHtml(maps.find(m => m.id === id)?.name ?? id)}</p>`);
    if (id !== settings.mapId && maps.some(m => m.id === id)) void changeMap(id as MapId);
  },
  error: message => { roomPanel?.error(message); toast(message); },
});
roomPanel = new RoomPanel($('room-panel'), identity, room, () => settings.mapId, {
  showPlayers: () => settings.showPlayers,
  setShowPlayers: show => { settings.showPlayers = show; applyPreferences(); },
  spectating: () => spectating,
  spectate: id => { spectate(id); if (id) void enter(); },
});
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
  const pb = best(); $('pb').textContent = pb ? pb.toFixed(2) : '—'; $('pb-tick').textContent = `${settings.tickRate}T${settings.autoBhop ? ' · AUTO' : ''}`;
  $('info-pb').hidden = !pb || !settings.hud.pb; $('info-pb').textContent = `PB: ${pb.toFixed(2)} · ${settings.tickRate}T${settings.autoBhop ? ' · AUTO' : ''}`;
  layoutHud();
  const currentRecords = records.filter(j => j.mapId === settings.mapId && j.tickRate === settings.tickRate);
  const mode = (j: Entry) => j.autoBhop === undefined ? 'Legacy' : j.autoBhop ? 'Auto-hop' : 'Manual';
  const selected = currentRecords.find(j => j.autoBhop === settings.autoBhop);
  const others = currentRecords.filter(j => j !== selected);
  const bestMarkup = `<div class="history-best"><div><span>Personal best</span><strong>${selected ? selected.distance.toFixed(2) : '—'}</strong></div><span>${settings.tickRate} tick · ${settings.autoBhop ? 'Auto-hop' : 'Manual'}</span></div>${others.length ? `<details class="history-records"><summary>Other modes</summary>${others.map(j => `<div class="session-entry"><span>${mode(j)}</span><b>${j.distance.toFixed(2)}</b></div>`).join('')}</details>` : ''}`;
  $('personal-bests').innerHTML = bestMarkup;

}
function layoutHud() {
  const { hud } = settings, bottom = hud.speed === 'bottom' || hud.speed === 'both';
  $('crosshair-speed').hidden = !(hud.speed === 'crosshair' || hud.speed === 'both');
  $('info-speed').hidden = !bottom; $('info-keys').hidden = !hud.keys;
  $('info-panel').hidden = !bottom && !hud.keys && $('info-pb').hidden;
  document.querySelectorAll<HTMLElement>('[data-hint]').forEach(hint => hint.hidden = !hud.hints);
  $('menu-hint').hidden = !hud.menuHint;
}
// The HUD and Crosshair settings pages show the real HUD over the live view behind the menu.
const hudPreview = () => settingsPreview && !locked && (settingsPanel.page === 'hud' || settingsPanel.page === 'crosshair');
function previewHud() { if (!locked) $('hud').hidden = !hudPreview(); }
function clearResult() {
  for (const id of ['distance', 'pre-speed', 'max-speed', 'strafes', 'sync', 'edge', 'height', 'air-ticks', 'overlap', 'dead-air', 'jump-width', 'exact-distance']) $(id).textContent = '—';
  $('distance').classList.remove('miss'); $('result-status').textContent = 'READY'; $('result-status').classList.remove('failed');
  $('last-note').textContent = 'Jump to record stats.'; $('strafe-table').querySelector('tbody')!.replaceChildren(); $('strafe-table').hidden = true;
  drawPath([], false); world.disposeGroup(world.trail);
}
function reset(toEntry = false) {
  const pose = !toEntry && checkpoint ? checkpoint : mapEntry(classic);
  movement.reset(pose.position); yaw = pose.yaw; pitch = pose.pitch; commands.reset(performance.now(), yaw); fallTime = 0;
  world.viewmodel.resetMotion();
  if (toEntry) world.viewmodel.play('draw');
  controls.clearPulses(); jumpUsedLJ = false; jumpBlock = 0;
  room.reset();
}
async function changeMap(id: MapId) {
  if (loadingMap) return;
  loadingMap = true; $<HTMLButtonElement>('start').disabled = true;
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.disabled = true);
  $('start-note').textContent = 'Loading map…';
  const previous = settings.mapId;
  try {
    const data = await loadMap(id);
    const version = await fingerprint(JSON.stringify({ boxes: data.boxes, entry: data.entry, lanes: data.lanes }));
    await world.buildImported(id, data);
    classic = data; settings.mapId = id; document.body.dataset.map = id; movement.boxes = data.boxes;
    started = false; mapContentVersion = version;
    checkpoint = checkpointForMap(savedPositions, id, version, movement);
    const info = maps.find(m => m.id === id)!;
    document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.map === id)));
    $('map-credit').innerHTML = `${info.credits}${info.workshop ? ` <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${info.workshop}" target="_blank" rel="noreferrer">WORKSHOP ↗</a>` : ''}`;
    $('menu-map').textContent = info.name;
    $('start').querySelector('span')!.textContent = 'Play';
    loadingMap = false; reset(true); clearResult(); writeSettings(); updateSession();
    remote.forgetPositions(); room.changeMap(id);
    engagement.configure(playContext()); engagement.mapLoaded();
    $('start-note').textContent = READY_NOTE;
  } catch (error) { console.error(error); settings.mapId = previous; $('start-note').textContent = 'Map could not load. Choose a map to retry.'; }
  finally { loadingMap = false; $<HTMLButtonElement>('start').disabled = false; document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.disabled = false); }
}
function toast(message: string, duration = 2200) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout); toastTimeout = window.setTimeout(() => $('toast').classList.remove('visible'), duration); }
function feedLine(markup: string) {
  const line = document.createElement('div');
  line.innerHTML = markup;
  const feed = $('kz-chat');
  feed.append(line);
  while (feed.children.length > 4) feed.firstElementChild!.remove();
}
function chat(result: Result) { feedLine(jumpFeedMarkup(result)); }
// Room announcements are client-reported practice results, shown with the sender's tick rate.
function announceJump(jump: RoomJump) {
  feedLine(jumpFeedMarkup({ distance: jump.distance, valid: true, landed: true, strafes: { length: jump.strafes }, sync: jump.sync, preSpeed: jump.pre,
    maxSpeed: jump.max, edge: jump.edge, height: jump.height, ticks: jump.ticks, overlap: jump.overlap, deadAir: jump.deadAir, width: jump.width },
    `${escapeHtml(jump.name)} · ${jump.tick}T${jump.auto ? ' · AUTO' : ''}`));
}
function showResult(result: Result) {
  engagement.jumpCompleted(result);
  const previousBest = best();
  const entry: Entry = { ...result, path: result.path.map(p => ({ ...p })), at: Date.now(), mapId: settings.mapId, tickRate: settings.tickRate, gap: jumpBlock, ljBind: jumpUsedLJ, autoBhop: settings.autoBhop,
    physicsVersion: import.meta.env.VITE_PHYSICS_VERSION, mapContentVersion };
  const updatedRecords = saveBest(records, entry);
  if (updatedRecords !== records) { records = updatedRecords; writeRecords(); }
  $('history-count').textContent = String(Number($('history-count').textContent) + 1);
  void archive.append(entry, records);
  if (result.valid) room.jump(result, settings.tickRate, settings.autoBhop);
  const replay = recorder.current();
  // Auto-hop jumps never count on the leaderboard.
  if (replay && !settings.autoBhop) leaderboard.submit(result, { ...replay, tickRate: settings.tickRate, mapId: settings.mapId,
    mapContentVersion, physicsVersion: import.meta.env.VITE_PHYSICS_VERSION ?? '' });
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
  $('menu').hidden = value; $('hud').hidden = !value; layoutHud(); previewHud();
  if (value) $<HTMLDetailsElement>('jump-details').open = false;
  document.body.classList.toggle('playing', value);
  $('start').querySelector('span')!.textContent = started ? 'Resume' : 'Play';
}
// The browser owns Escape: it always releases the mouse and is never a user
// gesture, so it cannot capture the mouse again. The Menu bind is an ordinary
// key or button press, so it toggles in both directions.
let captured = false;
function release() { playGuard.setPlaying(false, false); document.exitPointerLock(); }
const lockFailed = () => {
  const button = started ? 'Resume' : 'Play';
  $('start-note').textContent = document.hasFocus() ? `Your browser needs a moment after Esc. Click ${button} again.` : `Click ${button} in a focused browser window to capture the mouse.`;
};
/** The Menu bind reopens play from the menu, unless the player is typing or binding. */
function menuBind(token: string) {
  if (locked || !settings.bindings.menu.includes(token) || $<HTMLDialogElement>('about').open) return false;
  if (document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select')) return false;
  (document.activeElement as HTMLElement | null)?.blur();
  void enter(); return true;
}
async function enter(full = false) {
  if (loadingMap) return;
  if (innerWidth < 700) { $('start-note').textContent = DEVICE_NOTE; return; }
  try {
    // Fullscreen consumes the click's activation, so it waits for pointer lock.
    await lockMouse(world.renderer.domElement);
    if (full && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => toast('Fullscreen is unavailable in this browser'));
    $('start-note').textContent = READY_NOTE;
    started = true;
    try { await sounds.unlock(); } catch (error) { console.error(error); toast('Some sounds could not load'); }
  } catch (error) { console.warn('Pointer lock request rejected:', error); lockFailed(); }
}
$('start').addEventListener('click', () => void enter());
$('start-fullscreen').addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void enter(true); });
world.renderer.domElement.addEventListener('click', () => { if (started && !locked && $('about').hasAttribute('open') === false) void enter(); });
document.addEventListener('pointerlockchange', () => {
  const value = document.pointerLockElement === world.renderer.domElement;
  setLocked(value);
  if (value && !captured) {
    captured = true;
    // Shown on the first capture of every visit, whatever the hint settings are.
    toast(`Mouse captured · Esc to release${settings.bindings.menu.length ? `\n${bindLabel('menu')} to toggle menu` : ''}`, 4000);
  }
});
document.addEventListener('pointerlockerror', lockFailed);
document.addEventListener('mousemove', event => { if (locked && !spectating) {
  yaw += event.movementX * settings.sensitivity * settings.mouseYaw * Math.PI / 180;
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - event.movementY * settings.sensitivity * settings.mousePitch * (settings.invertY ? -1 : 1) * Math.PI / 180));
  commands.look(yaw, event.timeStamp);
} });
const bindLabel = (action: Action) => settings.bindings[action][0] ? tokenLabel(settings.bindings[action][0]) : '—';
function spectate(id: string | null) {
  spectating = id; remote.spectating = id;
  // Movement stays paused where it was and resumes from there; queued input is dropped either way.
  controls.clear(); lastTime = performance.now(); commands.reset(lastTime, yaw); movement.jumpHeld = false;
  const name = id ? room.players.get(id) ?? '' : '';
  $('spectate-banner').hidden = !id;
  $('spectate-banner').innerHTML = id ? `Spectating <b>${escapeHtml(name)}</b><kbd>${escapeHtml(bindLabel('light'))}</kbd>Next<kbd>${escapeHtml(bindLabel('heavy'))}</kbd>Previous<kbd>${escapeHtml(bindLabel('spectate'))}</kbd>Stop` : '';
  roomPanel?.render();
}
function cycleSpectate(step: 1 | -1) {
  const targets = remote.targets(), index = spectating ? targets.indexOf(spectating) : -1;
  if (!targets.length) { if (spectating) spectate(null); toast(room.connected ? 'No one to spectate yet' : 'Join a room to spectate'); return; }
  spectate(targets[index < 0 ? (step > 0 ? 0 : targets.length - 1) : (index + step + targets.length) % targets.length]);
}
function runAction(action: Action | undefined) {
  if (action === 'menu') { release(); return; }
  if (spectating) {
    if (action === 'spectate') spectate(null);
    if (action === 'light') cycleSpectate(1);
    if (action === 'heavy') cycleSpectate(-1);
    if (action === 'stats') toggleStatsPanel();
    return;
  }
  if (action === 'spectate') cycleSpectate(1);
  if (action === 'reset') { reset(); sounds.play('checkpoint'); }
  if (action === 'save') {
    if (movement.grounded && !movement.ducked && movement.support()) {
      checkpoint = { position: { ...movement.position }, yaw, pitch };
      savedPositions = [...savedPositions.filter(c => c.mapId !== settings.mapId), { ...checkpoint, mapId: settings.mapId, mapContentVersion }];
      let persisted = true;
      try { localStorage.setItem('vnl-checkpoints', JSON.stringify(savedPositions)); } catch { persisted = false; }
      sounds.play('checkpoint'); toast(persisted ? 'Position saved' : 'Position saved for this session');
    }
    else { sounds.play('error'); toast('Save a position while standing'); }
  }
  if (action === 'return') { if (checkpoint) { reset(); sounds.play('checkpoint'); } else { sounds.play('error'); toast('Save a position first'); } }
  if (action === 'inspect' || action === 'light' || action === 'heavy') { if (settings.viewmodel) world.viewmodel.play(action); }
  if (action === 'stats') toggleStatsPanel();
}
document.addEventListener('keydown', event => {
  if (settingsPanel.captureToken(event.code)) { event.preventDefault(); return; }
  if (event.code === 'Escape') {
    // Escape only ever releases the mouse; dialogs and binding capture keep it first.
    if ($<HTMLDialogElement>('about').open || event.defaultPrevented) return;
    event.preventDefault();
    if (locked && !event.repeat) release();
    return;
  }
  if (!event.repeat && menuBind(event.code)) { event.preventDefault(); return; }
  if (!locked) return;
  if (controls.action(event.code) || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)) event.preventDefault();
  if (!event.repeat) runAction(commands.button('down', event.code, event.timeStamp));
});
document.addEventListener('keyup', event => { if (locked) commands.button('up', event.code, event.timeStamp); });
document.addEventListener('mousedown', event => {
  const token = `Mouse${event.button}`;
  if (event.button === 3 || event.button === 4) event.preventDefault();
  if (settingsPanel.captureToken(token)) { event.preventDefault(); return; }
  if (event.button !== 0 && menuBind(token)) { event.preventDefault(); return; }
  if (locked) { event.preventDefault(); runAction(commands.button('down', token, event.timeStamp)); }
});
document.addEventListener('mouseup', event => {
  // Mouse 4/5 navigate back/forward on release unless cancelled, which would leave the game.
  if (event.button === 3 || event.button === 4) event.preventDefault();
  if (locked) commands.button('up', `Mouse${event.button}`, event.timeStamp);
});
document.addEventListener('wheel', event => {
  if (!event.deltaY) return;
  const token = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (settingsPanel.captureToken(token)) { event.preventDefault(); return; }
  if (locked) { event.preventDefault(); runAction(commands.button('pulse', token, event.timeStamp)); }
}, { passive: false });
addEventListener('blur', () => { controls.clear(); commands.reset(performance.now(), yaw); settingsPanel.cancelCapture(); if (locked) document.exitPointerLock(); });
addEventListener('focus', () => { if (!locked) playGuard.setPlaying(false, false); });
const fullscreenOffer = () => {
  const button = $('start-fullscreen'), full = !!document.fullscreenElement;
  button.hidden = !document.fullscreenEnabled;
  button.innerHTML = `<i data-lucide="${full ? 'minimize' : 'maximize'}" aria-hidden="true"></i>${full ? 'Exit fullscreen' : 'Fullscreen'}`;
  createIcons({ icons: { Maximize, Minimize }, attrs: { 'aria-hidden': 'true' } });
};
fullscreenOffer();
document.addEventListener('fullscreenchange', () => { fullscreenOffer(); void playGuard.capture(locked && !!document.fullscreenElement); });
document.addEventListener('visibilitychange', () => { engagement.setPlaying(locked && !document.hidden); if (document.hidden) { controls.clear(); if (locked) document.exitPointerLock(); } lastTime = performance.now(); commands.reset(lastTime, yaw); });
$('stats-toggle').addEventListener('click', toggleStatsPanel);
$('menu-hint-close').addEventListener('click', () => { settings.hud.menuHint = false; applyPreferences(); settingsPanel.render(); });
document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(button => button.addEventListener('click', () => void changeMap(button.dataset.map as MapId)));
$('tick-toggle').addEventListener('click', () => { settings.tickRate = settings.tickRate === 128 ? 64 : 128; engagement.configure(playContext()); movement.tickRate = settings.tickRate; reset(); $('menu-tick').textContent = `${settings.tickRate} tick`; $('tick-toggle').innerHTML = `${settings.tickRate} tick <i data-lucide="arrow-left-right" aria-hidden="true"></i>`; createIcons({ icons: { ArrowLeftRight }, attrs: { 'aria-hidden': 'true' } }); writeSettings(); updateSession(); });
document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => button.addEventListener('click', async () => { try { await sounds.unlock(); sounds.play(button.dataset.sample as Sound, true); } catch (error) { console.error(error); $('start-note').textContent = 'Sound files could not load.'; } }));
document.addEventListener('contextmenu', event => { if (locked || !$('settings-tab').hidden) event.preventDefault(); });
document.addEventListener('auxclick', event => { if (locked) event.preventDefault(); });
void world.viewmodel.setTeam(settings.team);
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.addEventListener('click', () => { settingsPanel.cancelCapture(); settingsPreview = button.dataset.tab === 'settings'; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button)); for (const name of ['practice', 'maps', 'settings', 'session', 'leaderboard']) $(`${name}-tab`).hidden = name !== button.dataset.tab; previewHud(); if (button.dataset.tab === 'session') void historyPanel?.refresh(); if (button.dataset.tab === 'leaderboard') void leaderboard.refresh(); }));
$('about-button').addEventListener('click', () => $<HTMLDialogElement>('about').showModal());
$('close-about').addEventListener('click', () => $<HTMLDialogElement>('about').close());
historyPanel = new HistoryPanel($('history-browser'), archive, count => { $('history-count').textContent = String(count); }, () => records, {
  preferences: () => structuredClone(settings), checkpoints: () => structuredClone(savedPositions),
  bests: imported => { records = readBests([...records, ...imported]); writeRecords(); updateSession(); },
  apply: (preferences, checkpoints, display) => {
    const notes: string[] = [];
    if (preferences) {
      const restored = { ...preferences, mapId: settings.mapId, tickRate: settings.tickRate,
        resolution: display ? preferences.resolution : settings.resolution, scaling: display ? preferences.scaling : settings.scaling };
      try {
        localStorage.setItem('vnl-settings-before-backup', JSON.stringify(settings));
        localStorage.setItem('vnl-settings', JSON.stringify(restored));
        Object.assign(settings, restored); applyPreferences(); settingsPanel.render();
      } catch { notes.push('Preferences could not be saved and were kept unchanged.'); }
    }
    if (checkpoints) {
      const positions = [...savedPositions.filter(c => !checkpoints.some(incoming => incoming.mapId === c.mapId)), ...checkpoints];
      try {
        localStorage.setItem('vnl-checkpoints', JSON.stringify(positions)); savedPositions = positions;
        checkpoint = checkpointForMap(savedPositions, settings.mapId, mapContentVersion, movement);
        if (!checkpoint && positions.some(c => c.mapId === settings.mapId)) notes.push('The current map’s saved position is incompatible; its entrance will be used.');
      } catch { notes.push('Saved positions could not be saved and were kept unchanged.'); }
    }
    return notes.join(' ');
  },
});
void archive.bests().then(saved => { records = readBests([...records, ...saved]); writeRecords(); updateSession(); }).catch(() => {});
updateSession(); createIcons({ icons: { ArrowLeftRight }, attrs: { 'aria-hidden': 'true' } });
function updateHUD(target: SpectatorView | null, sample = false) {
  // The settings preview shows a typical airborne reading so every speed option is visible.
  const sp = sample ? 250 : speed(target ? target.velocity : movement.velocity), takeoff = sample ? 272.35 : target ? target.takeoff : movement.jump?.preSpeed ?? null;
  const { decimals, takeoff: showTakeoff } = settings.hud, pre = showTakeoff && takeoff !== null ? `(${takeoff.toFixed(decimals)})` : '';
  $('speed').textContent = sp.toFixed(decimals); $('takeoff-speed').textContent = pre;
  $('crosshair-speed-now').textContent = sp.toFixed(decimals); $('crosshair-speed-pre').textContent = pre;
  // A watched player's keys are not sent, only their movement.
  if (target) { $('keys').textContent = '— — — — — —'; return; }
  const input = controls.snapshot(yaw);
  $('keys').textContent = [input.forward > 0 ? 'W' : '_', input.side < 0 || input.overlap ? 'A' : '_', input.forward < 0 ? 'S' : '_',
    input.side > 0 || input.overlap ? 'D' : '_', input.duck ? 'C' : '_', input.jump || movement.jumpHeld ? 'J' : '_'].join(' ');
}
function view() {
  return { punch: movement.viewPunch, speed: speed(movement.velocity), grounded: movement.grounded, show: settings.viewmodel, leftHand: settings.leftHand };
}
// Remote players are lit by the map's compiled lighting where they stand, like the viewmodel at the eye.
const lightAt = (p: Vec) => world.lighting?.state(p, false) ?? null;
function frame(_frameTimestamp: number) {
  // rAF's shared timestamp can predate events already delivered to this callback.
  // Sample the current clock so those inputs do not wait for another draw.
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
  if (spectating) {
    remote.update(now, world.camera, lightAt);
    // A watched player who left or started spectating passes the view to the next one.
    if (!remote.targets().includes(spectating) && remote.view(spectating)) cycleSpectate(1);
  }
  const target = spectating ? remote.view(spectating) : null;
  if (spectating) {
    commands.reset(now, yaw);
    // Until the watched player's first pose arrives, the paused local view stays up.
    if (target) world.play(target.eye, target.yaw, target.pitch, dt, { punch: 0, speed: speed(target.velocity), grounded: target.grounded, show: false, leftHand: settings.leftHand });
    else world.play(movement.eye(1), yaw, pitch, dt, view());
    if (locked && target) updateHUD(target);
  } else if (locked) {
    commands.advance(now, movement.tickRate, input => {
      if (movement.grounded && !movement.jump) jumpBlock = blockAt(mapLanes(classic), movement.support()?.id ?? '')?.gap ?? 0;
      if (movement.grounded && !movement.jump) jumpUsedLJ = false;
      if (input.lj) jumpUsedLJ = true;
      recorder.beforeStep(movement, input);
      movement.step(input);
      if (belowMap(classic, movement.position)) { fallTime += 1 / movement.tickRate; if (fallTime > 0.32) { reset(); sounds.play('checkpoint'); } } else fallTime = 0;
    });
    remote.update(now, world.camera, lightAt);
    world.play(movement.renderEye(commands.alpha, commands.preview(now)), yaw, pitch, dt, view());
    updateHUD(null);
  } else if (!started && !settingsPreview) { remote.update(now, world.camera, lightAt); world.preview(now / 1000); }
  else { remote.update(now, world.camera, lightAt); world.play(movement.eye(1), yaw, pitch, dt, view()); if (hudPreview()) updateHUD(null, true); }
  room.pose(now, movement.position, movement.velocity, yaw, pitch, movement.grounded, movement.duckAmount, settings.team, !!spectating);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void changeMap(settings.mapId);
