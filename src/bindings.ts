import type { Input } from './physics.ts';

export const actions = {
  forward: 'Forward', back: 'Back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump',
  duck: 'Duck', walk: 'Walk', longJump: 'Long jump bind', reset: 'Reset', save: 'Save position',
  return: 'Return to saved position', inspect: 'Inspect knife', light: 'Light swing', heavy: 'Heavy swing', hints: 'Toggle hints',
} as const;
export type Action = keyof typeof actions;
export type Bindings = Record<Action, string[]>;
export const defaultBindings: Bindings = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space', 'WheelUp', 'WheelDown'],
  duck: ['ControlLeft', 'ControlRight'], walk: ['ShiftLeft', 'ShiftRight'], longJump: [], reset: ['KeyR'],
  save: ['KeyX'], return: ['KeyC'], inspect: ['KeyF'], light: ['Mouse0'], heavy: ['Mouse2'], hints: ['KeyH'],
};
export const validToken = (token: unknown): token is string => typeof token === 'string'
  && /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(Up|Down|Left|Right)|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Minus|Equal|Backquote|Mouse[0-4]|Wheel(Up|Down))$/.test(token);
export function normalizeBindings(value: unknown): Bindings {
  const source = value && typeof value === 'object' ? value as Partial<Bindings> : {};
  const seen = new Set<string>();
  return Object.fromEntries((Object.keys(actions) as Action[]).map(action => {
    const candidates = Array.isArray(source[action]) ? source[action] : defaultBindings[action];
    const tokens: string[] = [];
    for (const token of candidates) {
      if (tokens.length === 8) break;
      if (validToken(token) && !seen.has(token)) { tokens.push(token); seen.add(token); }
    }
    return [action, tokens];
  })) as Bindings;
}
export function assignBinding(bindings: Bindings, action: Action, token: string) {
  let previous: Action | undefined;
  for (const other of Object.keys(actions) as Action[]) {
    if (bindings[other].includes(token)) previous = other;
    if (other !== action) bindings[other] = bindings[other].filter(t => t !== token);
  }
  if (!bindings[action].includes(token)) bindings[action].push(token);
  return previous;
}
export function tokenLabel(token: string) {
  const names: Record<string, string> = { Space: 'Space', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
    Mouse0: 'Mouse 1', Mouse1: 'Mouse 3', Mouse2: 'Mouse 2', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
    ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', ShiftLeft: 'Shift', ShiftRight: 'Right Shift',
    AltLeft: 'Alt', AltRight: 'Right Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
    BracketLeft: '[', BracketRight: ']' };
  return names[token] ?? token.replace(/^(Key|Digit)/, '').replace('Numpad', 'Num ');
}

// Physical inputs remain distinct so releasing one jump/duck key never releases another held binding.
export class Controls {
  private held = new Set<string>();
  private blocked = new Set<string>();
  private pulses = new Set<Action>();
  bindings: Bindings;
  constructor(bindings: Bindings) { this.bindings = bindings; }
  action(token: string) { return (Object.keys(actions) as Action[]).find(a => this.bindings[a].includes(token)); }
  down(token: string): Action | undefined {
    if (this.held.has(token)) return;
    this.held.add(token);
    const action = this.action(token);
    if (action === 'longJump') this.cancelForward();
    if (action) this.pulses.add(action);
    return action;
  }
  up(token: string) { this.held.delete(token); this.blocked.delete(token); }
  pulse(token: string): Action | undefined {
    const action = this.action(token);
    if (action === 'longJump') this.cancelForward();
    if (action) this.pulses.add(action);
    return action;
  }
  private cancelForward() {
    for (const token of this.held) if (['forward', 'back'].includes(this.action(token) ?? '')) this.blocked.add(token);
    this.pulses.delete('forward'); this.pulses.delete('back');
  }
  active(action: Action) { return this.bindings[action].some(token => this.held.has(token) && !this.blocked.has(token)); }
  clear() { this.held.clear(); this.blocked.clear(); this.pulses.clear(); }
  clearPulses() { this.pulses.clear(); }
  snapshot(yaw: number): Input & { lj: boolean } {
    const on = (a: Action) => this.active(a) || this.pulses.has(a);
    const lj = on('longJump'), left = on('left'), right = on('right');
    return { forward: Number(on('forward')) - Number(on('back')), side: Number(right) - Number(left),
      overlap: left && right, jump: on('jump') || lj, duck: on('duck') || lj, walk: on('walk'), yaw, lj };
  }
  tick(yaw: number) { const input = this.snapshot(yaw); this.pulses.clear(); return input; }
}
