import type { Result } from './physics';

export type PlayContext = { map: string; tick_rate: number; auto_bhop: boolean };
export type EventData = Record<string, string | number | boolean>;
export type Capture = (name: string, data: EventData) => void;

// Time is reported in deltas, so summing active_seconds never counts pauses twice.
export class Engagement {
  private playingSince: number | null = null;
  private started = false;
  private loaded = false;
  private context: PlayContext;
  constructor(private capture: Capture, context: PlayContext, private now = () => performance.now()) {
    this.context = { ...context };
  }
  configure(context: PlayContext) {
    this.flush();
    this.context = { ...context };
  }
  mapLoaded() {
    this.send(this.loaded ? 'map_changed' : 'game_loaded');
    this.loaded = true;
  }
  setPlaying(playing: boolean) {
    if (playing === (this.playingSince !== null)) return;
    if (playing) {
      this.playingSince = this.now();
      if (!this.started) { this.send('play_started'); this.started = true; }
    } else {
      this.flush();
      this.playingSince = null;
    }
  }
  flush() {
    if (this.playingSince === null) return;
    const now = this.now(), seconds = (now - this.playingSince) / 1000;
    this.playingSince = now;
    if (seconds > 0) this.send('playtime', { active_seconds: Math.round(seconds * 1000) / 1000 });
  }
  jumpCompleted(result: Result) {
    if (this.playingSince === null) return;
    this.send('jump_completed', { distance: Number(result.distance.toFixed(2)), sync: Number(result.sync.toFixed(1)),
      strafes: result.strafes.length, landed: result.landed, valid: result.valid });
  }
  private send(name: string, data: EventData = {}) {
    try { this.capture(name, { ...this.context, ...data }); } catch { /* Analytics must not interrupt play. */ }
  }
}
