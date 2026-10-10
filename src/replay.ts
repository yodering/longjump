import { Movement, DIST_EPSILON, RULES, type Box, type Input, type MovementState, type Result, type Vec } from './physics';
import type { CollisionWorld } from './collision';

// A jump replay is the movement state on the takeoff tick plus every command
// until the result. The leaderboard reruns it with the same physics, so a
// posted distance is the one these inputs produce, not a number the browser
// claims. Inputs themselves are still client-made: this rejects edited results
// and impossible movement, not a perfectly scripted input sequence.
export type Replay = { version: 1; tickRate: 64 | 128; mapId: string; mapContentVersion: string; physicsVersion: string;
  state: MovementState; inputs: Input[] };
export const MAX_REPLAY_SECONDS = 3;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const vec = (value: unknown): value is Vec => !!value && typeof value === 'object'
  && finite((value as Vec).x) && finite((value as Vec).y) && finite((value as Vec).z);
const axis = (value: unknown) => finite(value) && Math.abs(value) <= 1 && Number.isInteger(value * 4);
const between = (value: unknown, min: number, max: number) => finite(value) && value >= min && value <= max;

/** Keeps only the fields physics reads, so recordings stay small and well-typed. */
export function recordInput(input: Input): Input {
  const copy: Input = { forward: input.forward, side: input.side, jump: input.jump, duck: input.duck, walk: input.walk, yaw: input.yaw };
  if (input.overlap !== undefined) copy.overlap = input.overlap;
  if (input.jumpPressed !== undefined) copy.jumpPressed = input.jumpPressed;
  return copy;
}

export function parseReplay(value: unknown): Replay {
  const r = value as Replay;
  if (!r || typeof r !== 'object' || r.version !== 1 || (r.tickRate !== 64 && r.tickRate !== 128)
    || typeof r.mapId !== 'string' || r.mapId.length > 64 || typeof r.mapContentVersion !== 'string' || r.mapContentVersion.length > 128
    || typeof r.physicsVersion !== 'string' || r.physicsVersion.length > 128) throw new Error('Invalid replay.');
  const s = r.state;
  if (!s || typeof s !== 'object' || !vec(s.position) || !vec(s.velocity) || !s.crouchSpot || !finite(s.crouchSpot.x) || !finite(s.crouchSpot.y)
    || ![s.grounded, s.ducked, s.ducking, s.duckFlag, s.jumpHeld, s.rawDuck, s.walkButton, s.duckButton].every(bool)
    || !between(s.duckAmount, 0, 1) || !between(s.duckSpeed, 0, RULES.duckSpeedIdeal) || !between(s.stamina, 0, RULES.staminaMax)
    || !between(s.fallVelocity, -RULES.maxVelocity, RULES.maxVelocity) || !finite(s.surfaceFriction) || !finite(s.viewOffset) || !finite(s.viewPunch)
    || typeof s.platform !== 'string' || s.platform.length > 128 || !between(s.time, 0, 1e9)
    || (s.lastDuckTime !== null && !between(s.lastDuckTime, 0, s.time)))
    throw new Error('Invalid takeoff state.');
  if (!Array.isArray(r.inputs) || !r.inputs.length || r.inputs.length > r.tickRate * MAX_REPLAY_SECONDS) throw new Error('Invalid replay length.');
  for (const i of r.inputs) if (!i || typeof i !== 'object' || !axis(i.forward) || !axis(i.side) || !finite(i.yaw)
    || ![i.jump, i.duck, i.walk].every(bool) || (i.overlap !== undefined && !bool(i.overlap)) || (i.jumpPressed !== undefined && !bool(i.jumpPressed)))
    throw new Error('Invalid replay input.');
  return { version: 1, tickRate: r.tickRate, mapId: r.mapId, mapContentVersion: r.mapContentVersion, physicsVersion: r.physicsVersion,
    state: { ...s, position: { ...s.position }, velocity: { ...s.velocity }, crouchSpot: { x: s.crouchSpot.x, y: s.crouchSpot.y } },
    inputs: r.inputs.map(recordInput) };
}

/**
 * Reruns a parsed replay with manual jumping and returns the physics result.
 * The takeoff state must be standing on solid ground at rest height, and the
 * first command must start the jump; the last command must finish it.
 */
export function verifyReplay(replay: Replay, boxes: Box[], world: CollisionWorld | null = null): Result {
  const m = new Movement(); m.boxes = boxes; m.world = world; m.tickRate = replay.tickRate; m.autoBhop = false;
  m.restore(replay.state);
  const s = replay.state, support = m.support();
  // Ground states never carry vertical speed or the airborne deadstrafe friction.
  if (!s.grounded || !support || s.velocity.z !== 0 || s.surfaceFriction !== 1
    || Math.abs(s.position.z - (support.z + DIST_EPSILON)) > 1e-3 || Math.hypot(s.velocity.x, s.velocity.y) > RULES.maxVelocity)
    throw new Error('The jump must start from solid ground.');
  if (m.overlaps(s.position, m.hullHeight)) throw new Error('The jump starts inside the map.');
  let result = null as Result | null;
  m.onResult = value => { result = value; };
  for (const [index, input] of replay.inputs.entries()) {
    if (result) throw new Error('The replay continues after the jump ended.');
    m.step(input);
    if (index === 0 && !m.jump && !result) throw new Error('The replay must start on the takeoff tick.');
  }
  if (!result) throw new Error('The replay ends before the jump finishes.');
  return result;
}

/** Keeps the takeoff state and commands of the jump in progress. Call before every step. */
export class JumpRecorder {
  private state: MovementState | null = null;
  private inputs: Input[] = [];
  beforeStep(movement: Movement, input: Input) {
    if (!movement.jump) { this.state = movement.snapshot(); this.inputs = []; }
    this.inputs.push(recordInput(input));
  }
  /** The recording for a result reported during the latest step. */
  current() { return this.state ? { state: this.state, inputs: this.inputs.slice() } : null; }
}
