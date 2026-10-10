import type { Input } from './physics.ts';

export const actions = {
  forward: 'Forward', back: 'Back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump',
  duck: 'Duck', walk: 'Walk', longJump: 'Long jump bind', reset: 'Reset', save: 'Save position',
  return: 'Return to saved position', inspect: 'Inspect knife', light: 'Light swing', heavy: 'Heavy swing', stats: 'Toggle jump stats',
  spectate: 'Spectate', menu: 'Menu',
} as const;
export type Action = keyof typeof actions;
export type Bindings = Record<Action, string[]>;
export const defaultBindings: Bindings = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space', 'WheelUp', 'WheelDown'],
  duck: ['ControlLeft', 'ControlRight'], walk: ['ShiftLeft', 'ShiftRight'], longJump: [], reset: ['KeyR'],
  save: ['KeyX'], return: ['KeyC'], inspect: ['KeyF'], light: ['Mouse0'], heavy: ['Mouse2'], stats: ['KeyH'],
  spectate: ['KeyM'], menu: ['KeyP'],
};
export const validToken = (token: unknown): token is string => typeof token === 'string'
  && /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(Up|Down|Left|Right)|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Minus|Equal|Backquote|Mouse[0-4]|Wheel(Up|Down))$/.test(token);
export function normalizeBindings(value: unknown): Bindings {
  const source = value && typeof value === 'object' ? value as Partial<Bindings> : {};
  const seen = new Set<string>();
  return Object.fromEntries((Object.keys(actions) as Action[]).map(action => {
    const saved = source[action] ?? (action === 'stats' ? (source as Partial<Bindings> & { hints?: string[] }).hints : undefined);
    const candidates = Array.isArray(saved) ? saved : defaultBindings[action];
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

const opposite: Partial<Record<Action, Action>> = { left: 'right', right: 'left' };
// Physical inputs remain distinct so releasing one jump/duck key never releases another held binding.
// A null bind makes the newest strafe key win instead of cancelling out, like the CS:GO alias script:
// pressing A while D is held releases D; releasing A presses the still-held D again.
export class Controls {
  private held = new Set<string>();
  private blocked = new Set<string>();
  private pulses = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private jumpPressed = false;
  bindings: Bindings;
  nullBind = false;
  constructor(bindings: Bindings) { this.bindings = bindings; }
  action(token: string) { return (Object.keys(actions) as Action[]).find(a => this.bindings[a].includes(token)); }
  down(token: string): Action | undefined {
    if (this.held.has(token)) return;
    const action = this.action(token);
    if ((action === 'jump' || action === 'longJump') && !this.active('jump') && !this.active('longJump')) this.jumpPressed = true;
    if (action && !this.active(action)) this.pressed.add(action);
    this.held.add(token);
    if (action === 'longJump') this.cancelForward();
    const other = action && opposite[action];
    if (this.nullBind && other && this.active(other)) {
      for (const held of this.held) if (this.action(held) === other) this.blocked.add(held);
      this.released.add(other);
    }
    if (action) this.pulses.add(action);
    return action;
  }
  up(token: string): undefined {
    const action = this.action(token), wasActive = action && this.active(action);
    this.held.delete(token); this.blocked.delete(token);
    if (action && wasActive && !this.active(action)) {
      this.released.add(action);
      const other = opposite[action];
      if (this.nullBind && other) {
        let resumed = false;
        for (const held of this.held) if (this.action(held) === other && this.blocked.delete(held)) resumed = true;
        if (resumed) this.pressed.add(other);
      }
    }
    return undefined;
  }
  pulse(token: string): Action | undefined {
    const action = this.action(token);
    if ((action === 'jump' || action === 'longJump') && !this.active('jump') && !this.active('longJump')) this.jumpPressed = true;
    if (action === 'longJump') this.cancelForward();
    if (action) {
      this.pulses.add(action);
      if (!this.active(action)) { this.pressed.add(action); this.released.add(action); }
    }
    return action;
  }
  private cancelForward() {
    for (const token of this.held) if (['forward', 'back'].includes(this.action(token) ?? '')) this.blocked.add(token);
    this.pulses.delete('forward'); this.pulses.delete('back');
    for (const action of ['forward', 'back'] as const) { this.pressed.delete(action); this.released.add(action); }
  }
  active(action: Action) { return this.bindings[action].some(token => this.held.has(token) && !this.blocked.has(token)); }
  clear() { this.held.clear(); this.blocked.clear(); this.clearPulses(); }
  clearPulses() { this.pulses.clear(); this.pressed.clear(); this.released.clear(); this.jumpPressed = false; }
  fork() {
    const copy = new Controls(this.bindings); copy.nullBind = this.nullBind;
    copy.held = new Set(this.held); copy.blocked = new Set(this.blocked);
    return copy;
  }
  snapshot(yaw: number): Input & { lj: boolean } {
    const on = (a: Action) => this.active(a) || this.pulses.has(a);
    const lj = on('longJump'), left = on('left'), right = on('right');
    return { forward: Number(on('forward')) - Number(on('back')), side: Number(right) - Number(left),
      overlap: left && right, jump: on('jump') || lj, jumpPressed: this.jumpPressed, duck: on('duck') || lj, walk: on('walk'), yaw, lj };
  }
  tick(yaw: number) {
    const input = this.snapshot(yaw);
    // CInput::KeyState fractions apply to movement axes, not IN_JUMP/IN_DUCK.
    const amount = (action: Action) => {
      const down = this.active(action), pressed = this.pressed.has(action), released = this.released.has(action);
      if (pressed && released) return down ? 0.75 : 0.25;
      if (pressed) return down ? 0.5 : 0;
      if (released) return 0;
      return down ? 1 : 0;
    };
    input.forward = amount('forward') - amount('back');
    input.side = amount('right') - amount('left');
    this.clearPulses(); return input;
  }
}
