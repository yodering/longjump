import type { ServerWebSocket } from 'bun';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';

// Private practice rooms. Movement stays on each client; the server only relays
// poses and jump announcements, so a slow room never delays anyone's inputs.
// Announcements are client-reported; only replay-verified jumps reach the leaderboard.
export const ROOM_SIZE = 8;
export const SNAPSHOT_MS = 50;
const EMPTY_ROOM_MS = 10 * 60_000;
const MAX_BUFFERED = 64 * 1024;
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const POSITION_LIMIT = 65_536, SPEED_LIMIT = 4_000;

export type RoomSocket = ServerWebSocket<{ address: string; member?: Member }>;
type Pose = { p: [number, number, number]; v: [number, number, number]; yaw: number; pitch: number; g: boolean; d: number; r: boolean };
type Member = { id: string; name: string; room: Room; ws: RoomSocket; pose: Pose | null; dirty: boolean; poses: number[]; jumps: number[] };
type Room = { code: string; mapId: string; members: Map<string, Member>; emptySince: number | null };
export type RoomsConfig = { db: Database; physicsVersion: string; mapIds: string[]; now?: () => number };

const finite = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
const triple = (value: unknown, limit: number): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(n => finite(n, limit));
const send = (ws: RoomSocket, message: unknown) => { ws.send(JSON.stringify(message)); };
// Sliding one-second window: true while under the limit.
function within(times: number[], now: number, max: number) {
  while (times.length && times[0] <= now - 1000) times.shift();
  if (times.length >= max) return false;
  times.push(now); return true;
}

export function createRooms(config: RoomsConfig) {
  const now = config.now ?? Date.now, rooms = new Map<string, Room>(), creations = new Map<string, number[]>();
  const playerByKey = config.db.query<{ id: string; name: string; banned: number }, [string]>('SELECT id, name, banned FROM player WHERE keyHash = ?');
  const roster = (room: Room) => [...room.members.values()].map(m => ({ id: m.id, name: m.name }));
  const broadcast = (room: Room, message: unknown, except?: Member) => {
    const text = JSON.stringify(message);
    for (const m of room.members.values()) if (m !== except) m.ws.send(text);
  };
  function code() {
    for (;;) {
      const bytes = randomBytes(8), value = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!rooms.has(value)) return value;
    }
  }
  function fail(ws: RoomSocket, message: string) { send(ws, { t: 'error', message, fatal: true }); ws.close(4000, 'room error'); }

  function hello(ws: RoomSocket, input: Record<string, unknown>) {
    if (ws.data.member) return;
    if (input.physics !== config.physicsVersion) return fail(ws, 'The game was updated. Reload to join.');
    const key = typeof input.key === 'string' && /^[0-9a-f]{64}$/.test(input.key) ? input.key : '';
    const player = key ? playerByKey.get(createHash('sha256').update(key).digest('hex')) : null;
    if (!player) return fail(ws, 'Choose a name before joining a room.');
    if (player.banned) return fail(ws, 'This name can’t join rooms.');
    let room: Room | undefined;
    if (input.create === true) {
      if (typeof input.map !== 'string' || !config.mapIds.includes(input.map)) return fail(ws, 'Choose a map before creating a room.');
      const times = creations.get(ws.data.address) ?? [];
      while (times.length && times[0] <= now() - 3_600_000) times.shift();
      if (times.length >= 10) return fail(ws, 'Too many rooms created. Try again later.');
      times.push(now()); creations.set(ws.data.address, times);
      room = { code: code(), mapId: input.map, members: new Map(), emptySince: null };
      rooms.set(room.code, room);
    } else {
      room = typeof input.room === 'string' ? rooms.get(input.room.toLowerCase()) : undefined;
      if (!room) return fail(ws, 'This room has ended. Create a new one to keep playing together.');
    }
    // The same name joining again (another tab or a reconnect) replaces its old connection.
    const previous = room.members.get(player.id);
    if (previous) { previous.ws.data.member = undefined; fail(previous.ws, 'You joined this room from another tab.'); room.members.delete(player.id); }
    else if (room.members.size >= ROOM_SIZE) return fail(ws, `This room is full (${ROOM_SIZE} players).`);
    const member: Member = { id: player.id, name: player.name, room, ws, pose: null, dirty: false, poses: [], jumps: [] };
    ws.data.member = member; room.members.set(member.id, member); room.emptySince = null;
    send(ws, { t: 'welcome', room: room.code, you: member.id, map: room.mapId, players: roster(room) });
    if (!previous) broadcast(room, { t: 'join', id: member.id, name: member.name }, member);
  }

  function pose(member: Member, input: Record<string, unknown>) {
    // Clients send about 20 per second; extra or malformed poses are dropped, not queued.
    if (!within(member.poses, now(), 40)) return;
    if (!triple(input.p, POSITION_LIMIT) || !triple(input.v, SPEED_LIMIT) || !finite(input.yaw, 1e6) || !finite(input.pitch, 2)
      || typeof input.g !== 'boolean' || !finite(input.d, 1) || input.d < 0) return;
    // A reset stays marked until the next snapshot carries it, so remote views snap instead of sliding.
    const reset = input.r === true || (member.dirty && member.pose?.r === true);
    member.pose = { p: input.p, v: input.v, yaw: input.yaw, pitch: input.pitch, g: input.g, d: input.d, r: reset };
    member.dirty = true;
  }

  function jump(member: Member, input: Record<string, unknown>) {
    if (!within(member.jumps, now(), 4)) return;
    const numbers = ['distance', 'sync', 'pre', 'max', 'height', 'width'] as const, counts = ['strafes', 'ticks', 'overlap', 'deadAir'] as const;
    if (!numbers.every(k => finite(input[k], 10_000)) || !counts.every(k => Number.isInteger(input[k]) && (input[k] as number) >= 0 && (input[k] as number) < 10_000)
      || (input.edge !== null && !finite(input.edge, 1_000)) || (input.tick !== 64 && input.tick !== 128) || typeof input.auto !== 'boolean') return;
    const announced = { t: 'jump', id: member.id, name: member.name, tick: input.tick, auto: input.auto, edge: input.edge,
      ...Object.fromEntries([...numbers, ...counts].map(k => [k, input[k]])) };
    broadcast(member.room, announced, member);
  }

  function map(member: Member, input: Record<string, unknown>) {
    if (typeof input.map !== 'string' || !config.mapIds.includes(input.map) || input.map === member.room.mapId) return;
    member.room.mapId = input.map;
    for (const m of member.room.members.values()) m.pose = null;
    broadcast(member.room, { t: 'map', map: input.map, by: member.name });
  }

  function leave(member: Member) {
    const room = member.room;
    if (room.members.get(member.id) !== member) return;
    room.members.delete(member.id);
    broadcast(room, { t: 'leave', id: member.id });
    if (!room.members.size) room.emptySince = now();
  }

  /** Sends each client the poses that changed since the last snapshot, skipping clients that are behind. */
  function snapshot() {
    const at = now();
    for (const [code, room] of rooms) {
      if (room.emptySince !== null && at - room.emptySince > EMPTY_ROOM_MS) { rooms.delete(code); continue; }
      const changed = [...room.members.values()].filter(m => m.dirty && m.pose);
      if (!changed.length) continue;
      for (const m of room.members.values()) {
        const players = changed.filter(c => c !== m).map(c => ({ id: c.id, ...c.pose }));
        if (players.length && m.ws.getBufferedAmount() < MAX_BUFFERED) send(m.ws, { t: 'poses', at, players });
      }
      for (const c of changed) { c.dirty = false; c.pose!.r = false; }
    }
    for (const [address, times] of creations) if (!times.length || times[times.length - 1] < at - 3_600_000) creations.delete(address);
  }

  return {
    rooms, snapshot,
    open(_ws: RoomSocket) { /* Waits for hello. */ },
    message(ws: RoomSocket, raw: string | Buffer) {
      let input: Record<string, unknown>;
      try { input = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
      if (!input || typeof input !== 'object') return;
      const member = ws.data.member;
      if (input.t === 'hello') return hello(ws, input);
      if (!member) return;
      if (input.t === 'pose') pose(member, input);
      else if (input.t === 'jump') jump(member, input);
      else if (input.t === 'map') map(member, input);
    },
    close(ws: RoomSocket) { if (ws.data.member) leave(ws.data.member); ws.data.member = undefined; },
  };
}
