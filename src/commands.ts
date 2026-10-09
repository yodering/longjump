import { Controls, type Bindings } from './bindings.ts';

type CommandEvent = { at: number } & (
  { kind: 'down' | 'up' | 'pulse'; token: string } | { kind: 'look'; yaw: number }
);
export type UserCommand = ReturnType<Controls['tick']>;

// Keep event time separate from render time. A catch-up frame must not apply
// today's key press or mouse angle to every tick since the previous frame.
export class Commands {
  readonly live: Controls;
  private simulated: Controls;
  private events: CommandEvent[] = [];
  private time = 0;
  private yaw = 0;
  private liveYaw = 0;
  private revision = 0;
  alpha = 0;

  constructor(bindings: Bindings) {
    this.live = new Controls(bindings); this.simulated = this.live.fork();
  }
  reset(now: number, yaw: number) {
    this.time = now; this.yaw = this.liveYaw = yaw; this.alpha = 0;
    this.events = []; this.live.clearPulses(); this.simulated = this.live.fork(); this.revision++;
  }
  button(kind: 'down' | 'up' | 'pulse', token: string, at: number) {
    const action = this.live[kind](token);
    this.enqueue({ kind, token, at });
    return action;
  }
  look(yaw: number, at: number) {
    this.liveYaw = yaw; this.enqueue({ kind: 'look', yaw, at });
  }
  private enqueue(event: CommandEvent) {
    // Late/coalesced browser events are consumed on the next command, never rewound.
    event.at = Math.max(this.time, this.events.at(-1)?.at ?? this.time, event.at);
    this.events.push(event);
  }
  // Preview the next command without consuming its events or jump pulses.
  // Rendering may respond before a complete fixed physics interval has elapsed.
  preview(now: number): UserCommand {
    const controls = this.simulated.fork();
    let yaw = this.yaw;
    for (const event of this.events) {
      if (event.at > now) break;
      if (event.kind === 'look') yaw = event.yaw;
      else controls[event.kind](event.token);
    }
    return controls.tick(yaw);
  }
  advance(now: number, tickRate: 64 | 128, step: (input: UserCommand) => void) {
    const interval = 1000 / tickRate, revision = this.revision;
    // Treat long main-thread suspensions as a pause, without replaying stale jumps.
    // Ordinary slow frames (up to 250 ms) retain every physics tick.
    if (now - this.time > 250) { this.reset(now, this.liveYaw); return; }
    while (this.time + interval <= now) {
      this.time += interval;
      let consumed = 0;
      while (consumed < this.events.length && this.events[consumed].at <= this.time) {
        const event = this.events[consumed++];
        if (event.kind === 'look') this.yaw = event.yaw;
        else this.simulated[event.kind](event.token);
      }
      this.events.splice(0, consumed);
      step(this.simulated.tick(this.yaw));
      // Respawning inside step establishes a new clock and command queue.
      if (revision !== this.revision) return;
    }
    this.live.clearPulses();
    this.alpha = Math.max(0, Math.min(1, (now - this.time) / interval));
  }
}

export const PITCH_LIMIT = 89 * Math.PI / 180;

export async function lockMouse(element: Pick<HTMLElement, 'requestPointerLock'>) {
  try {
    await element.requestPointerLock({ unadjustedMovement: true });
  } catch (error) {
    // Chromium on some platforms reports unavailable raw input as UnknownError.
    // Focus/permission errors still reach the caller without a second request.
    if (!(error instanceof Error) || !['NotSupportedError', 'UnknownError'].includes(error.name)) throw error;
    await element.requestPointerLock();
  }
}
