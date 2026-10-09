import { actions, assignBinding, defaultBindings, validToken, type Action } from './bindings.ts';
import { normalizeSettings, viewPresets, type Settings, type ViewSettings } from './settings.ts';

const commands: Record<string, Action> = { '+forward': 'forward', '+back': 'back', '+moveleft': 'left', '+moveright': 'right',
  '+jump': 'jump', '+duck': 'duck', '+speed': 'walk', '+lookatweapon': 'inspect', '+attack': 'light', '+attack2': 'heavy',
  vnl_reset: 'reset', vnl_save: 'save', vnl_return: 'return', vnl_stats: 'stats', vnl_hints: 'stats', vnl_spectate: 'spectate' };
const sourceKeys: Record<string, string> = { space: 'Space', ctrl: 'ControlLeft', shift: 'ShiftLeft', alt: 'AltLeft',
  rctrl: 'ControlRight', rshift: 'ShiftRight', ralt: 'AltRight', enter: 'Enter', tab: 'Tab', backspace: 'Backspace',
  del: 'Delete', ins: 'Insert', home: 'Home', end: 'End', pgup: 'PageUp', pgdn: 'PageDown', capslock: 'CapsLock',
  uparrow: 'ArrowUp', downarrow: 'ArrowDown', leftarrow: 'ArrowLeft', rightarrow: 'ArrowRight',
  mouse1: 'Mouse0', mouse2: 'Mouse2', mouse3: 'Mouse1', mouse4: 'Mouse3', mouse5: 'Mouse4',
  mwheelup: 'WheelUp', mwheeldown: 'WheelDown', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period',
  '/': 'Slash', '\\': 'Backslash', '-': 'Minus', '=': 'Equal', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight',
  kp_end: 'Numpad1', kp_downarrow: 'Numpad2', kp_pgdn: 'Numpad3', kp_leftarrow: 'Numpad4', kp_5: 'Numpad5',
  kp_rightarrow: 'Numpad6', kp_home: 'Numpad7', kp_uparrow: 'Numpad8', kp_pgup: 'Numpad9', kp_ins: 'Numpad0',
  kp_del: 'NumpadDecimal', kp_enter: 'NumpadEnter', kp_plus: 'NumpadAdd', kp_minus: 'NumpadSubtract',
  kp_multiply: 'NumpadMultiply', kp_slash: 'NumpadDivide' };
export function sourceToken(key: string) {
  const k = key.toLowerCase();
  const token = sourceKeys[k] ?? (/^[a-z]$/.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : /^f\d+$/.test(k) ? k.toUpperCase() : undefined);
  return validToken(token) ? token : undefined;
}
function sourceKey(token: string) {
  return Object.keys(sourceKeys).find(key => sourceKeys[key] === token) ?? token.replace(/^(Key|Digit)/, '').toLowerCase();
}
// Parse text only. Never run a console, exec, JavaScript, a file include or an unrestricted alias.
export function splitCommands(text: string) {
  const result: string[] = []; let line = '', quoted = false, comment = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (block) { if (char === '*' && next === '/') { block = false; i++; } continue; }
    if (comment) { if (char !== '\n') continue; comment = false; }
    if (!quoted && char === '/' && next === '/') { comment = true; i++; continue; }
    if (!quoted && char === '/' && next === '*') { block = true; i++; continue; }
    if (quoted && char === '\\' && (next === '"' || next === '\\')) { line += char + next; i++; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === ';' || char === '\n' || char === '\r')) {
      if (line.trim()) result.push(line.trim()); line = '';
    } else line += char;
  }
  if (line.trim()) result.push(line.trim());
  return result;
}
function tokenize(command: string) {
  return [...command.matchAll(/"((?:\\["\\]|[^"\\])*)"|([^\s"]+)/g)]
    .map(m => (m[1] ?? m[2]).replace(/\\(["\\])/g, '$1'));
}
export type ConfigReport = { settings: Settings; applied: string[]; ignored: string[] };
export function importConfig(text: string, current: Settings): ConfigReport {
  if (text.length > 1024 * 1024) throw new Error('Choose a config smaller than 1 MB.');
  const parsed = splitCommands(text).map(tokenize);
  if (parsed.length > 10000) throw new Error('This config contains too many commands.');
  const report: ConfigReport = { settings: structuredClone(current), applied: [], ignored: [] }, s = report.settings;
  const aliases = new Map<string, string>();
  for (const [name, alias, body] of parsed) if (name?.toLowerCase() === 'alias' && alias && body) aliases.set(alias.toLowerCase(), body);
  const expand = (body: string, depth = 0): string[] | null => {
    if (depth > 8) return null;
    const output: string[] = [];
    for (const part of splitCommands(body)) {
      const args = tokenize(part), name = args[0]?.toLowerCase();
      if (!name || args.length !== 1) return null;
      if (aliases.has(name)) { const inner = expand(aliases.get(name)!, depth + 1); if (!inner) return null; output.push(...inner); }
      else output.push(name);
      if (output.length > 16) return null;
    }
    return output;
  };
  const actionFor = (body: string) => {
    const sequence = expand(body);
    if (!sequence) return undefined;
    // Cosmetic clear-decals commands are safe to omit when paired with a single movement action.
    const useful = sequence.filter(c => c !== 'r_cleardecals');
    if (useful.length === 4 && new Set(useful).size === 4 && ['+duck', '+jump', '-forward', '-back'].every(c => useful.includes(c))) {
      const name = tokenize(body)[0]?.toLowerCase();
      if (aliases.has(name)) {
        const release = expand(`-${name.slice(1)}`);
        if (!name.startsWith('+') || !release || release.length !== 2 || !release.includes('-duck') || !release.includes('-jump')) return undefined;
      }
      return 'longJump' as Action;
    }
    if (useful.length !== 1 || !commands[useful[0]]) return undefined;
    const name = tokenize(body)[0]?.toLowerCase();
    if (aliases.has(name) && useful[0].startsWith('+')) {
      const release = expand(`-${name.slice(1)}`);
      if (!name.startsWith('+') || release?.length !== 1 || release[0] !== `-${useful[0].slice(1)}`) return undefined;
    }
    return commands[useful[0]];
  };
  const viewCommands: Record<string, keyof ViewSettings> = { viewmodel_fov: 'fov', viewmodel_offset_x: 'x',
    viewmodel_offset_y: 'y', viewmodel_offset_z: 'z', cl_bob_lower_amt: 'bobLower', cl_bobamt_lat: 'bobLat',
    cl_bobamt_vert: 'bobVert', cl_bobcycle: 'bobCycle' };
  const rgb = s.crosshair.color.slice(1).match(/../g)!.map(v => parseInt(v, 16));
  let colorMode = 5, useAlpha = true;
  for (const [raw, ...args] of parsed) {
    const name = raw?.toLowerCase();
    if (name === 'alias') continue;
    let applied = false;
    if (name === 'bind' && args.length === 2) {
      const token = sourceToken(args[0]), action = actionFor(args[1]);
      if (token && action && (s.bindings[action].length < 8 || s.bindings[action].includes(token))) {
        assignBinding(s.bindings, action, token); applied = true;
      }
    } else if (name === 'unbind' && args.length === 1) {
      const token = sourceToken(args[0]);
      if (token) { for (const action of Object.keys(actions) as Action[]) s.bindings[action] = s.bindings[action].filter(t => t !== token); applied = true; }
    } else if (args.length === 1 && args[0].trim() && Number.isFinite(Number(args[0]))) {
      const n = Number(args[0]); applied = true;
      if (name === 'sensitivity' && n > 0) s.sensitivity = n;
      else if (name === 'm_yaw' && n > 0) s.mouseYaw = n;
      else if (name === 'm_pitch' && n !== 0) { s.mousePitch = Math.abs(n); s.invertY = n < 0; }
      else if (viewCommands[name]) s.view[viewCommands[name]] = n;
      else if (name === 'viewmodel_presetpos' && viewPresets[['', 'desktop', 'couch', 'classic'][n]])
        Object.assign(s.view, viewPresets[['', 'desktop', 'couch', 'classic'][n]]);
      else if (name === 'cl_righthand') s.leftHand = n === 0;
      else if (name === 'r_drawviewmodel') s.viewmodel = n !== 0;
      else if (name === 'volume') s.volume = n;
      else if (name === 'cl_crosshairsize') s.crosshair.size = n;
      else if (name === 'cl_crosshairgap') s.crosshair.gap = n;
      else if (name === 'cl_crosshairthickness') s.crosshair.thickness = n;
      else if (name === 'cl_crosshairdot') s.crosshair.dot = n !== 0;
      else if (name === 'cl_crosshair_drawoutline') s.crosshair.outline = n !== 0;
      else if (name === 'cl_crosshairalpha') s.crosshair.alpha = n / 255;
      else if (name === 'cl_crosshairusealpha') useAlpha = n !== 0;
      else if (name === 'cl_crosshaircolor' && n >= 0 && n <= 5 && Number.isInteger(n)) colorMode = n;
      else if (/^cl_crosshaircolor_[rgb]$/.test(name)) rgb['rgb'.indexOf(name.at(-1)!)] = Math.round(Math.max(0, Math.min(255, n)));
      else if ((name === 'viewmodel_presetpos' && n === 0) || (name === 'cl_crosshairstyle' && n === 4)) { /* custom preset / static crosshair */ }
      else applied = false;
    }
    (applied ? report.applied : report.ignored).push([raw, ...args].join(' '));
  }
  s.crosshair.color = colorMode === 5 ? '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('')
    : ['#ff0000', '#00ff00', '#ffff00', '#0000ff', '#00ffff'][colorMode];
  if (!useAlpha) s.crosshair.alpha = 1;
  report.settings = normalizeSettings(s);
  return report;
}
export function exportConfig(s: Settings) {
  const lines = ['// VNL long-jump settings. Import locally in Settings.',
    'alias +vnl_lj "+duck; +jump; -forward; -back"', 'alias -vnl_lj "-duck; -jump"'];
  for (const token of new Set(Object.values(defaultBindings).flat())) lines.push(`unbind "${sourceKey(token).replace(/(["\\])/g, '\\$1')}"`);
  const actionCommands = Object.fromEntries(Object.entries(commands).map(([c, a]) => [a, c])) as Record<Action, string>;
  actionCommands.longJump = '+vnl_lj';
  for (const action of Object.keys(actions) as Action[]) for (const token of s.bindings[action])
    lines.push(`bind "${sourceKey(token).replace(/(["\\])/g, '\\$1')}" "${actionCommands[action]}"`);
  lines.push(`sensitivity "${s.sensitivity}"`, `m_yaw "${s.mouseYaw}"`, `m_pitch "${s.mousePitch * (s.invertY ? -1 : 1)}"`,
    `viewmodel_fov "${s.view.fov}"`, `viewmodel_offset_x "${s.view.x}"`, `viewmodel_offset_y "${s.view.y}"`, `viewmodel_offset_z "${s.view.z}"`,
    `cl_bob_lower_amt "${s.view.bobLower}"`, `cl_bobamt_lat "${s.view.bobLat}"`, `cl_bobamt_vert "${s.view.bobVert}"`, `cl_bobcycle "${s.view.bobCycle}"`,
    `cl_righthand "${Number(!s.leftHand)}"`, `r_drawviewmodel "${Number(s.viewmodel)}"`, `volume "${s.volume}"`,
    `cl_crosshairstyle "4"`, `cl_crosshairsize "${s.crosshair.size}"`, `cl_crosshairgap "${s.crosshair.gap}"`, `cl_crosshairthickness "${s.crosshair.thickness}"`,
    `cl_crosshairdot "${Number(s.crosshair.dot)}"`, `cl_crosshair_drawoutline "${Number(s.crosshair.outline)}"`,
    `cl_crosshairusealpha "1"`, `cl_crosshairalpha "${Math.round(s.crosshair.alpha * 255)}"`, 'cl_crosshaircolor "5"');
  s.crosshair.color.slice(1).match(/../g)!.forEach((v, i) => lines.push(`cl_crosshaircolor_${'rgb'[i]} "${parseInt(v, 16)}"`));
  return lines.join('\n') + '\n';
}
