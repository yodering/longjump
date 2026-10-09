import type { Identity } from './identity';
import type { Result, Vec } from './physics';

export type RoomPose = { id: string; p: [number, number, number]; v: [number, number, number]; yaw: number; pitch: number; g: boolean; d: number; r: boolean; m: 'ct' | 't'; s?: boolean };
export type RoomJump = { id: string; name: string; tick: 64 | 128; auto: boolean; distance: number; sync: number; pre: number; max: number;
  height: number; width: number; strafes: number; ticks: number; overlap: number; deadAir: number; edge: number | null };
export type RoomStatus = 'idle' | 'connecting' | 'open' | 'retrying';
type Events = {
  changed(): void;
  poses(at: number, players: RoomPose[]): void;
  joined(name: string): void;
  left(name: string): void;
  jump(jump: RoomJump): void;
  map(mapId: string, by: string | null): void;
  error(message: string): void;
};

export const POSE_INTERVAL_MS = 50;
export const ROOM_SIZE = 8;
// Shorter jumps stay in the jumper's own feed; the room only hears about these.
export const ANNOUNCE_DISTANCE = 240;
const IDLE_POSE_MS = 1000;

/**
 * One WebSocket to a private room. Poses go out at 20 Hz while moving and once a
 * second while idle; nothing here waits on the network during a physics tick.
 * Dropped connections rejoin the same room with backoff.
 */
export class RoomClient {
  code: string | null = null;
  you: string | null = null;
  mapId: string | null = null;
  status: RoomStatus = 'idle';
  players = new Map<string, string>();
  private ws: WebSocket | null = null;
  private create: string | null = null;
  private retries = 0;
  private retryTimer = 0;
  private lastPoseAt = 0;
  private lastPose = '';
  private resetPending = false;
  constructor(private identity: Identity, private physics: string, private events: Partial<Events>) {}

  get connected() { return this.status === 'open'; }
  /** Creates a room on the given map. */
  start(mapId: string) { this.leave(); this.create = mapId; this.connect(); }
  join(code: string) { this.leave(); this.code = code.toLowerCase(); this.connect(); }
  leave() {
    clearTimeout(this.retryTimer);
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onclose = null; ws.close(1000, 'left'); }
    this.code = this.you = this.mapId = this.create = null; this.players.clear(); this.status = 'idle'; this.retries = 0;
    this.events.changed?.();
  }
  private connect() {
    const player = this.identity.player;
    if (!player) { this.events.error?.('Choose a name to play with friends.'); return; }
    this.status = this.retries ? 'retrying' : 'connecting'; this.events.changed?.();
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms`);
    this.ws = ws;
    // The key goes in the first message, not the URL, so it stays out of logs.
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', key: player.key, physics: this.physics,
      ...(this.code ? { room: this.code } : { create: true, map: this.create }) }));
    ws.onmessage = event => { try { this.receive(JSON.parse(String(event.data))); } catch { /* Ignore malformed frames. */ } };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.code && !this.create) return;
      this.status = 'retrying'; this.events.changed?.();
      const delay = Math.min(15_000, 1000 * 2 ** this.retries++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }
  private receive(message: Record<string, any>) {
    if (message.t === 'welcome') {
      this.code = message.room; this.create = null; this.you = message.you; this.retries = 0; this.status = 'open';
      this.players = new Map((message.players as { id: string; name: string }[]).map(p => [p.id, p.name]));
      const mapChanged = this.mapId !== message.map; this.mapId = message.map;
      this.lastPose = ''; this.resetPending = true;
      this.events.changed?.();
      if (mapChanged) this.events.map?.(message.map, null);
    } else if (message.t === 'join') { this.players.set(message.id, message.name); this.events.joined?.(message.name); this.events.changed?.(); }
    else if (message.t === 'leave') { const name = this.players.get(message.id); this.players.delete(message.id); if (name) this.events.left?.(name); this.events.changed?.(); }
    else if (message.t === 'poses') this.events.poses?.(message.at, message.players);
    else if (message.t === 'jump') this.events.jump?.(message as RoomJump);
    else if (message.t === 'map') { this.mapId = message.map; this.resetPending = true; this.events.map?.(message.map, message.by); }
    else if (message.t === 'error') {
      // Fatal errors (room ended, full, stale version, another tab) end the session instead of retrying.
      if (message.fatal) { this.leave(); }
      this.events.error?.(message.message);
    }
  }
  private send(message: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  /** Marks the next pose as a teleport so others snap instead of sliding. */
  reset() { this.resetPending = true; }
  pose(now: number, position: Vec, velocity: Vec, yaw: number, pitch: number, grounded: boolean, duck: number, team: 'ct' | 't', spectating = false) {
    if (!this.connected || now - this.lastPoseAt < POSE_INTERVAL_MS) return;
    const round = (n: number) => Math.round(n * 100) / 100;
    const pose = { p: [round(position.x), round(position.y), round(position.z)], v: [round(velocity.x), round(velocity.y), round(velocity.z)],
      yaw: Math.round(yaw * 1e4) / 1e4, pitch: Math.round(pitch * 1e4) / 1e4, g: grounded, d: Math.round(duck * 100) / 100, m: team, ...(spectating ? { s: true } : {}) };
    const text = JSON.stringify(pose);
    if (text === this.lastPose && !this.resetPending && now - this.lastPoseAt < IDLE_POSE_MS) return;
    this.lastPoseAt = now; this.lastPose = text;
    this.send({ t: 'pose', ...pose, ...(this.resetPending ? { r: true } : {}) }); this.resetPending = false;
  }
  jump(result: Result, tick: 64 | 128, auto: boolean) {
    if (!result.valid || result.distance < ANNOUNCE_DISTANCE) return;
    this.send({ t: 'jump', tick, auto, distance: result.distance, sync: result.sync, pre: result.preSpeed, max: result.maxSpeed, height: result.height,
      width: result.width, strafes: result.strafes.length, ticks: result.ticks, overlap: result.overlap, deadAir: result.deadAir, edge: result.edge });
  }
  changeMap(mapId: string) { if (this.connected && mapId !== this.mapId) { this.mapId = mapId; this.send({ t: 'map', map: mapId }); } }
  inviteLink() { return this.code ? `${location.origin}${location.pathname}#room=${this.code}` : ''; }
}
