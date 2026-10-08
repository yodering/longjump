// CS:GO movement in Source units (x = right, y = forward, z = up), ported from Valve's cstrike15_src:
// game/shared/gamemovement.cpp and game/shared/cstrike15/cs_gamemovement.cpp. Function names below match theirs.
// References and fidelity boundaries are documented in README.md.
export const RULES = { gravity: 800, jumpImpulse: 301.993377, maxSpeed: 250, accelerate: 5.5, airAccelerate: 12, airWishCap: 30,
  friction: 5.2, stopSpeed: 80, hull: 16, height: 72, duckHeight: 54, viewHeight: 64, duckViewHeight: 46, stepSize: 18,
  nonJumpVelocity: 140, duckModifier: 0.34, walkModifier: 0.52, duckSpeedIdeal: 8, moveSpeed: 450, maxVelocity: 3500,
  staminaJumpCost: 0.08, staminaLandCost: 0.05, staminaRecovery: 60, staminaMax: 80, staminaRange: 100,
  timeBetweenDucks: 0.4, viewPunchDecay: 18 };
// Traces stop this far short of a surface (engine DIST_EPSILON), so a standing origin rests 1/32 above the floor.
export const DIST_EPSILON = 0.03125;
export type Vec = { x: number; y: number; z: number };
export type Box = { min: Vec; max: Vec; id: string };
export type Input = { forward: number; side: number; jump: boolean; duck: boolean; walk: boolean; yaw: number; overlap?: boolean };
export type Strafe = { direction: number; ticks: number; synced: number; gain: number; loss: number; maxSpeed: number; width: number };
export type Jump = { start: Vec; preSpeed: number; maxSpeed: number; ticks: number; synced: number; overlap: number; deadAir: number;
  height: number; lastYaw: number; strafes: Strafe[]; path: Vec[]; startPlatform: string; edge: number | null; ducked: boolean; valid: boolean };
export type Result = { distance: number; preSpeed: number; maxSpeed: number; sync: number; strafes: Strafe[];
  duration: number; ticks: number; height: number; overlap: number; deadAir: number; width: number; edge: number | null;
  path: Vec[]; landed: boolean; valid: boolean; reason: string; ducked: boolean };
type Trace = { fraction: number; end: Vec; normal: Vec; startsolid: boolean; allsolid: boolean; box?: Box };
export const speed = (v: Vec) => Math.hypot(v.x, v.y);
export const clone = (v: Vec): Vec => ({ ...v });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v: Vec) => Math.hypot(v.x, v.y, v.z);
const assign = (to: Vec, from: Vec) => { to.x = from.x; to.y = from.y; to.z = from.z; };
const approach = (target: number, value: number, delta: number) => value < target ? Math.min(target, value + delta) : Math.max(target, value - delta);
const simpleSpline = (x: number) => 3 * x * x - 2 * x * x * x;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// Air acceleration as CGameMovement::AirAccelerate; also used by tests.
export function accelerate(v: Vec, dx: number, dy: number, wishSpeed: number, accel: number, dt: number, cap = wishSpeed, friction = 1) {
  const add = Math.min(wishSpeed, cap) - (v.x * dx + v.y * dy);
  if (add <= 0) return;
  const amount = Math.min(add, accel * wishSpeed * dt * friction);
  v.x += dx * amount; v.y += dy * amount;
}
export function createMap(gap: number): Box[] {
  const boxes: Box[] = [];
  for (const [i, g] of [220, 230, gap, 250, 260].entries()) {
    const x = (i - 2) * 320;
    boxes.push({ id: `start-${i}`, min: { x: x - 104, y: -540, z: -100 }, max: { x: x + 104, y: 0, z: 0 } });
    boxes.push({ id: `end-${i}`, min: { x: x - 104, y: g, z: -100 }, max: { x: x + 104, y: g + 420, z: 0 } });
  }
  boxes.push({ id: 'back', min: { x: -840, y: -670, z: -100 }, max: { x: 840, y: -540, z: 0 } });
  return boxes;
}
// Distance from the takeoff block's edge to the back of the hull, along the dominant takeoff axis.
function takeoffEdge(block: Box | undefined, p: Vec, v: Vec) {
  if (!block) return null;
  const axis = Math.abs(v.x) > Math.abs(v.y) ? 'x' : 'y', h = RULES.hull;
  const edge = v[axis] >= 0 ? block.max[axis] - (p[axis] - h) : (p[axis] + h) - block.min[axis];
  return edge >= 0 && edge <= 2 * h ? edge : null;
}
export class Movement {
  position: Vec = { x: 0, y: -240, z: 0 };
  velocity: Vec = { x: 0, y: 0, z: 0 };
  grounded = true;
  // m_bDucked selects the hull; m_bDucking is a transition in progress; FL_DUCKING is duckFlag.
  ducked = false; ducking = false; duckFlag = false; duckAmount = 0; duckSpeed = RULES.duckSpeedIdeal;
  stamina = 0; jumpHeld = false; fallVelocity = 0;
  autoBhop = false;
  // m_surfaceFriction: CategorizePosition sets 0.25 while airborne and rising (the "deadstrafe"); AirAccelerate reads it.
  surfaceFriction = 1;
  viewOffset = RULES.viewHeight; viewPunch = 0;
  previousPosition: Vec = clone(this.position); previousViewOffset = RULES.viewHeight;
  platform = 'start-2'; jump: Jump | null = null; result: Result | null = null;
  onResult?: (result: Result) => void;
  tickRate: 64 | 128 = 128;
  boxes: Box[];
  private time = 0; private lastDuckTime = -Infinity; private rawDuck = false; private crouchSpot = { x: 0, y: 0 };
  private maxSpeed = RULES.maxSpeed; private fmove = 0; private smove = 0; private walkButton = false; private duckButton = false;
  private moveStart: Vec = clone(this.position); private moveVelocity: Vec = clone(this.velocity);
  private airMoved = false;
  constructor(gap = 246) { this.boxes = createMap(gap); }
  get dt() { return 1 / this.tickRate; }
  get hullHeight() { return this.ducked ? RULES.duckHeight : RULES.height; }
  reset(position: Vec = { x: 0, y: -240, z: 0 }) {
    this.position = clone(position); this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = !!this.support(); this.ducked = this.ducking = this.duckFlag = false; this.duckAmount = 0; this.duckSpeed = RULES.duckSpeedIdeal;
    this.stamina = 0; this.jump = null; this.jumpHeld = false; this.fallVelocity = 0; this.surfaceFriction = 1;
    this.viewOffset = this.previousViewOffset = RULES.viewHeight; this.viewPunch = 0; this.previousPosition = clone(position);
    this.lastDuckTime = -Infinity; this.rawDuck = false; this.crouchSpot = { x: position.x, y: position.y };
    this.platform = this.support()?.id ?? ''; this.result = null;
    this.moveStart = clone(position); this.moveVelocity = clone(this.velocity);
  }
  // The box the player stands on, if any (within CategorizePosition's 2 units).
  support() {
    const p = this.position, h = RULES.hull;
    return this.boxes.find(b => p.x + h > b.min.x && p.x - h < b.max.x && p.y + h > b.min.y && p.y - h < b.max.y && p.z >= b.max.z - 1e-4 && p.z - b.max.z <= 2);
  }
  overlaps(p: Vec, height: number) { return this.trace(p, p, height).startsolid; }
  // Eye position between the last two ticks, as the client renders the predicted player.
  eye(alpha: number): Vec {
    const a = this.previousPosition, b = this.position, t = clamp01(alpha);
    const offset = this.previousViewOffset + (this.viewOffset - this.previousViewOffset) * t;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t + offset };
  }
  // Swept player hull against axis-aligned boxes (Minkowski sum + slab test), with the engine's DIST_EPSILON pull-back.
  trace(start: Vec, end: Vec, height = this.hullHeight): Trace {
    const d = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
    let fraction = 1, normal: Vec = { x: 0, y: 0, z: 0 }, box: Box | undefined, startsolid = false, allsolid = false;
    for (const b of this.boxes) {
      const lo = { x: b.min.x - RULES.hull, y: b.min.y - RULES.hull, z: b.min.z - height }, hi = { x: b.max.x + RULES.hull, y: b.max.y + RULES.hull, z: b.max.z };
      const inside = (q: Vec) => (['x', 'y', 'z'] as const).every(a => q[a] > lo[a] && q[a] < hi[a]);
      if (inside(start)) { startsolid = true; if (inside(end)) { allsolid = true; fraction = 0; box = b; } continue; }
      let enter = -Infinity, exit = Infinity, rawEnter = -Infinity, rawExit = Infinity;
      let axis: 'x' | 'y' | 'z' = 'x', sign = 0, miss = false;
      for (const a of ['x', 'y', 'z'] as const) {
        if (d[a] === 0) { if (start[a] <= lo[a] || start[a] >= hi[a]) { miss = true; break; } continue; }
        const t1 = (lo[a] - start[a]) / d[a], t2 = (hi[a] - start[a]) / d[a];
        const first = Math.min(t1, t2), last = Math.max(t1, t2);
        rawEnter = Math.max(rawEnter, first); rawExit = Math.min(rawExit, last);
        // IntersectRayWithBoxBrush first checks the unexpanded interval, then
        // chooses the contact plane using epsilon-expanded crossing planes.
        if (first < 0 && last > 1) continue;
        const epsilon = DIST_EPSILON / Math.abs(d[a]);
        const near = first - epsilon, far = last + epsilon;
        if (near > enter) { enter = near; axis = a; sign = d[a] > 0 ? -1 : 1; }
        exit = Math.min(exit, far);
      }
      if (miss || rawEnter > rawExit || rawExit <= 0 || rawEnter > 1 || rawEnter < 0 || enter > exit) continue;
      const hit = Math.max(0, enter);
      if (hit < fraction) { fraction = hit; box = b; normal = { x: 0, y: 0, z: 0 }; normal[axis] = sign; }
    }
    return { fraction, end: { x: start.x + d.x * fraction, y: start.y + d.y * fraction, z: start.z + d.z * fraction }, normal, startsolid, allsolid, box };
  }
  step(input: Input) {
    const dt = this.dt, p = this.position, v = this.velocity;
    this.previousPosition = clone(p); this.previousViewOffset = this.viewOffset; this.time += dt;
    this.airMoved = false;
    this.yaw = input.yaw;
    this.moveStart = clone(p); this.moveVelocity = clone(v);
    this.checkParameters(input);
    // ReduceTimers
    this.stamina = Math.max(0, this.stamina - dt * RULES.staminaRecovery);
    // PlayerMove (sv_optimizedmovement 1: no CategorizePosition here)
    if (v.z > 250) this.setGround(undefined);
    if (!this.grounded) this.fallVelocity = -v.z;
    this.duck();
    this.fullWalkMove(input);
    if (this.jump) {
      const j = this.jump;
      j.path.push(clone(p)); j.height = Math.max(j.height, p.z - j.start.z);
      if (p.z < j.start.z && this.previousPosition.z >= j.start.z && !this.grounded) {
        // Failed jumps are measured where the hull crosses its takeoff elevation, not at pit depth.
        const a = this.previousPosition, t = clamp01((j.start.z - a.z) / (p.z - a.z));
        this.finish(false, undefined, { x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, z: j.start.z });
      }
    }
  }
  private checkParameters(input: Input) {
    // Duck-spam penalty on every press or release of the duck key.
    if (input.duck !== this.rawDuck) this.duckSpeed = Math.max(0, this.duckSpeed - 2);
    this.rawDuck = input.duck;
    this.duckButton = input.duck && this.duckingEnabled();
    this.maxSpeed = RULES.maxSpeed;
    const crouching = this.duckButton || this.ducking || this.duckFlag;
    this.walkButton = input.walk && !crouching;
    if (this.walkButton && length(this.velocity) < this.maxSpeed * RULES.walkModifier + 25) this.maxSpeed *= RULES.walkModifier;
    if (this.stamina > 0) { const scale = clamp01(1 - this.stamina / RULES.staminaRange); this.maxSpeed *= scale * scale; }
    this.fmove = input.forward * RULES.moveSpeed; this.smove = input.side * RULES.moveSpeed;
    const wish = Math.hypot(this.fmove, this.smove);
    if (wish > this.maxSpeed) { this.fmove *= this.maxSpeed / wish; this.smove *= this.maxSpeed / wish; }
    // DecayViewPunchAngle
    this.viewPunch *= Math.exp(-RULES.viewPunchDecay * this.dt);
  }
  private duckingEnabled() {
    if (this.duckSpeed < 1.5) return false;
    return this.duckFlag || this.time >= this.lastDuckTime + RULES.timeBetweenDucks;
  }
  private duck() {
    const dt = this.dt, touching = this.grounded, held = this.duckButton;
    this.duckSpeed = approach(RULES.duckSpeedIdeal, this.duckSpeed, dt * 3);
    if (this.duckSpeed >= RULES.duckSpeedIdeal) this.crouchSpot = { x: this.position.x, y: this.position.y };
    else if ((this.duckAmount <= 0 || this.duckAmount >= 1) && Math.hypot(this.position.x - this.crouchSpot.x, this.position.y - this.crouchSpot.y) > 64)
      this.duckSpeed = approach(RULES.duckSpeedIdeal, this.duckSpeed, dt * 6);
    if (!held && this.duckAmount > 0) this.ducking = true;
    else if (held && this.duckAmount < 1) this.ducking = true;
    if (held && this.ducking) {
      this.duckAmount = approach(1, this.duckAmount, dt * this.duckSpeed * 0.8);
      if (this.duckAmount >= 1 || !touching) this.finishDuck(); else this.viewOffset = this.duckedEye(this.duckAmount);
    }
    if (!held && this.ducking) {
      if (this.canUnduck()) {
        this.duckAmount = approach(0, this.duckAmount, dt * Math.max(1.5, this.duckSpeed));
        this.ducked = false;
        if (this.duckAmount <= 0 || !touching) this.finishUnDuck(); else this.viewOffset = this.duckedEye(this.duckAmount);
        if (this.duckAmount <= 0.75) this.duckFlag = false;
      } else {
        this.duckAmount = 1; this.ducked = true; this.ducking = false; this.duckFlag = true; this.viewOffset = this.duckedEye(1);
      }
    }
    // HandleDuckingSpeedCrop: applies in the air too, so a mid-air duck cuts air acceleration to 34%.
    if (held || this.ducking || this.duckFlag) {
      const modifier = RULES.duckModifier * this.duckAmount + 1 - this.duckAmount;
      this.fmove *= modifier; this.smove *= modifier; this.maxSpeed *= modifier;
    }
  }
  private duckedEye(fraction: number) { const f = simpleSpline(fraction); return RULES.duckViewHeight * f + RULES.viewHeight * (1 - f); }
  private canUnduck() {
    const p = this.position, end = this.grounded ? clone(p) : { ...p, z: p.z - (RULES.height - RULES.duckHeight) / 2 };
    const tr = this.trace(p, end, RULES.height);
    return !tr.startsolid && tr.fraction === 1;
  }
  private finishDuck() {
    // In the air the hull keeps its center: the feet rise by half the 18-unit height difference.
    if (!this.grounded) this.position.z += (RULES.height - RULES.duckHeight) / 2;
    this.viewOffset = RULES.duckViewHeight; this.ducking = false; this.ducked = true; this.duckFlag = true;
    this.lastDuckTime = this.time; this.duckAmount = 1;
    if (this.jump) this.jump.ducked = true;
    this.categorizePosition();
  }
  private finishUnDuck() {
    if (!this.grounded) this.position.z -= (RULES.height - RULES.duckHeight) / 2;
    this.duckFlag = false; this.ducked = false; this.ducking = false; this.viewOffset = RULES.viewHeight; this.duckAmount = 0;
    this.categorizePosition();
  }
  private fullWalkMove(input: Input) {
    const v = this.velocity, half = RULES.gravity * this.dt / 2;
    v.z -= half; // StartGravity
    if (input.jump) this.checkJumpButton(input); else this.jumpHeld = false;
    if (this.grounded) { v.z = 0; this.fallVelocity = 0; this.friction(); }
    this.checkVelocity();
    if (this.grounded) this.walkMove(); else this.airMove(input);
    this.categorizePosition();
    this.checkVelocity();
    v.z -= half; // FinishGravity
    this.checkVelocity();
    if (this.grounded) v.z = 0;
    this.checkFalling();
  }
  private checkJumpButton(input: Input) {
    const v = this.velocity, p = this.position;
    if (!this.grounded) { this.jumpHeld = true; return; }
    if (this.jumpHeld && !this.autoBhop) return;
    // PreventBunnyJumping
    const sp = length(v), limit = 1.1 * RULES.maxSpeed;
    if (sp > limit) { const f = limit / sp; v.x *= f; v.y *= f; v.z *= f; }
    this.setGround(undefined);
    const startz = v.z;
    v.z = this.ducking || this.duckFlag ? RULES.jumpImpulse : v.z + RULES.jumpImpulse;
    if (this.stamina > 0) v.z *= clamp01(1 - this.stamina / RULES.staminaRange);
    v.z -= RULES.gravity * this.dt / 2; // FinishGravity inside CheckJumpButton
    // OnJump
    this.stamina = Math.min(RULES.staminaMax, Math.max(0, this.stamina + RULES.staminaJumpCost * (v.z - startz)));
    this.jumpHeld = true;
    const block = this.boxes.find(b => b.id === this.platform);
    this.jump = { start: clone(p), preSpeed: speed(v), maxSpeed: speed(v), ticks: 0, synced: 0, overlap: 0, deadAir: 0, height: 0,
      lastYaw: input.yaw, strafes: [], path: [clone(p)], startPlatform: this.platform, edge: takeoffEdge(block, p, v), ducked: this.ducked, valid: true };
  }
  private friction() {
    const v = this.velocity, sp = length(v);
    if (sp < 0.1) return;
    const control = sp < RULES.stopSpeed ? RULES.stopSpeed : sp;
    const next = Math.max(0, sp - control * RULES.friction * this.surfaceFriction * this.dt);
    if (next !== sp) { v.x *= next / sp; v.y *= next / sp; v.z *= next / sp; }
  }
  private checkVelocity() {
    for (const a of ['x', 'y', 'z'] as const) this.velocity[a] = Math.max(-RULES.maxVelocity, Math.min(RULES.maxVelocity, this.velocity[a]));
  }
  private wish(yaw: number) {
    const x = Math.sin(yaw) * this.fmove + Math.cos(yaw) * this.smove, y = Math.cos(yaw) * this.fmove - Math.sin(yaw) * this.smove;
    let wishspeed = Math.hypot(x, y);
    const dir = wishspeed ? { x: x / wishspeed, y: y / wishspeed, z: 0 } : { x: 0, y: 0, z: 0 };
    if (wishspeed > this.maxSpeed) wishspeed = this.maxSpeed;
    return { dir, wishspeed };
  }
  private yaw = 0;
  private walkMove() {
    const v = this.velocity, p = this.position;
    const { dir, wishspeed } = this.wish(this.yaw);
    v.z = 0; this.accelerate(dir, wishspeed); v.z = 0;
    const sp = length(v);
    if (sp > this.maxSpeed) { v.x *= this.maxSpeed / sp; v.y *= this.maxSpeed / sp; v.z *= this.maxSpeed / sp; }
    if (length(v) < 1) { v.x = v.y = v.z = 0; return; }
    const dest = { x: p.x + v.x * this.dt, y: p.y + v.y * this.dt, z: p.z };
    const tr = this.trace(p, dest);
    if (tr.fraction === 1) { assign(p, tr.end); this.stayOnGround(); return; }
    this.stepMove(dest, tr); this.stayOnGround();
  }
  // CCSGameMovement::Accelerate (sv_accelerate_use_weapon_speed with a 250-speed knife leaves the scale at 1).
  private accelerate(dir: Vec, wishspeed: number) {
    const v = this.velocity;
    let current = dot(v, dir);
    const add = wishspeed - current;
    if (add <= 0) return;
    if (current < 0) current = 0;
    const isDucking = this.duckButton || this.ducking || this.duckFlag, isWalking = this.walkButton && !isDucking;
    let scale = Math.max(RULES.maxSpeed, wishspeed), goal = scale, accel = RULES.accelerate;
    if (isDucking) { scale *= RULES.duckModifier; goal *= RULES.duckModifier; }
    if (isWalking) { scale *= RULES.walkModifier; goal *= RULES.walkModifier; }
    if (isWalking && current > goal - 5) accel *= clamp01(1 - Math.max(0, current - (goal - 5)) / Math.max(0, goal - (goal - 5)));
    const amount = Math.min(add, accel * this.dt * scale * this.surfaceFriction);
    v.x += amount * dir.x; v.y += amount * dir.y;
  }
  private airMove(input: Input) {
    const v = this.velocity, { dir, wishspeed } = this.wish(this.yaw), before = speed(v);
    // AirAccelerate
    const add = Math.min(wishspeed, RULES.airWishCap) - dot(v, dir);
    if (add > 0) {
      const amount = Math.min(add, RULES.airAccelerate * wishspeed * this.dt * this.surfaceFriction);
      v.x += amount * dir.x; v.y += amount * dir.y;
    }
    this.recordAirTick(input, before, speed(v));
    this.moveStart = clone(this.position); this.moveVelocity = clone(v);
    this.airMoved = true;
    this.tryPlayerMove();
  }
  private recordAirTick(input: Input, before: number, after: number) {
    const jump = this.jump;
    if (!jump) return;
    const gain = after - before, side = Math.sign(input.side);
    jump.ticks++; jump.maxSpeed = Math.max(jump.maxSpeed, after);
    if (gain > 0.0001) jump.synced++;
    if (input.overlap) jump.overlap++; else if (!side) jump.deadAir++;
    let turn = input.yaw - jump.lastYaw; jump.lastYaw = input.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    // Direction changes are counted from lateral key changes, including W+A/W+D.
    if (side) {
      let strafe = jump.strafes.at(-1);
      if (!strafe || strafe.direction !== side) { strafe = { direction: side, ticks: 0, synced: 0, gain: 0, loss: 0, maxSpeed: 0, width: 0 }; jump.strafes.push(strafe); }
      strafe.ticks++; if (gain > 0.0001) strafe.synced++;
      strafe.gain += Math.max(0, gain); strafe.loss += Math.max(0, -gain);
      strafe.maxSpeed = Math.max(strafe.maxSpeed, after); strafe.width += Math.abs(turn) * 180 / Math.PI;
    }
  }
  private clipVelocity(input: Vec, normal: Vec, out: Vec, overbounce: number) {
    const backoff = dot(input, normal) * overbounce;
    out.x = input.x - normal.x * backoff; out.y = input.y - normal.y * backoff; out.z = input.z - normal.z * backoff;
    let adjust = dot(out, normal);
    if (adjust < 0) { adjust = Math.min(adjust, -DIST_EPSILON); out.x -= normal.x * adjust; out.y -= normal.y * adjust; out.z -= normal.z * adjust; }
  }
  private tryPlayerMove(firstDest?: Vec, firstTrace?: Trace) {
    const v = this.velocity, p = this.position, planes: Vec[] = [];
    let original = clone(v), timeLeft = this.dt, allFraction = 0;
    const primal = clone(v), stop = () => { v.x = v.y = v.z = 0; };
    for (let bump = 0; bump < 4; bump++) {
      if (length(v) === 0) break;
      const end = { x: p.x + v.x * timeLeft, y: p.y + v.y * timeLeft, z: p.z + v.z * timeLeft };
      const pm = firstDest && firstTrace && end.x === firstDest.x && end.y === firstDest.y && end.z === firstDest.z ? { ...firstTrace } : this.trace(p, end);
      if (pm.fraction > 0 && pm.fraction < 0.0001) pm.fraction = 0;
      allFraction += pm.fraction;
      if (pm.allsolid) { stop(); return; }
      if (pm.fraction > 0) { assign(p, pm.end); original = clone(v); planes.length = 0; }
      if (pm.fraction === 1) break;
      // Anything but a floor counts as touching a block for jump stats.
      if (this.jump && pm.normal.z < 0.7) this.jump.valid = false;
      const normal = clone(pm.normal);
      if (Math.abs(normal.z) < 0.0001) normal.z = 0;
      timeLeft -= timeLeft * pm.fraction;
      if (planes.length >= 5) { stop(); break; }
      planes.push(normal);
      if (planes.length === 1 && !this.grounded) {
        const next = { x: 0, y: 0, z: 0 };
        this.clipVelocity(original, planes[0], next, 1);
        assign(v, next); original = clone(next);
      } else {
        let i = 0;
        for (; i < planes.length; i++) {
          this.clipVelocity(original, planes[i], v, 1);
          let j = 0;
          for (; j < planes.length; j++) if (j !== i && dot(v, planes[j]) < 0) break;
          if (j === planes.length) break;
        }
        if (i === planes.length) {
          if (planes.length !== 2) { stop(); break; }
          const [a, b] = planes, dir = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
          const n = length(dir) || 1, d = dot(dir, v) / n;
          v.x = dir.x / n * d; v.y = dir.y / n * d; v.z = dir.z / n * d;
        }
        if (dot(v, primal) <= 0) { stop(); break; }
      }
    }
    if (allFraction === 0) stop();
  }
  private stepMove(dest: Vec, first: Trace) {
    const p = this.position, v = this.velocity, startPos = clone(p), startVel = clone(v);
    this.tryPlayerMove(dest, first);
    const downPos = clone(p), downVel = clone(v);
    assign(p, startPos); assign(v, startVel);
    let tr = this.trace(p, { ...p, z: p.z + RULES.stepSize + DIST_EPSILON });
    if (!tr.startsolid && !tr.allsolid) assign(p, tr.end);
    this.tryPlayerMove();
    tr = this.trace(p, { ...p, z: p.z - RULES.stepSize - DIST_EPSILON });
    if (tr.normal.z < 0.7) { assign(p, downPos); assign(v, downVel); return; }
    if (!tr.startsolid && !tr.allsolid) assign(p, tr.end);
    const downDist = (downPos.x - startPos.x) ** 2 + (downPos.y - startPos.y) ** 2, upDist = (p.x - startPos.x) ** 2 + (p.y - startPos.y) ** 2;
    if (downDist > upDist) { assign(p, downPos); assign(v, downVel); } else v.z = downVel.z;
  }
  private stayOnGround() {
    const p = this.position;
    let tr = this.trace(p, { ...p, z: p.z + 2 });
    const start = tr.end;
    tr = this.trace(start, { ...p, z: p.z - RULES.stepSize });
    if (tr.fraction > 0 && tr.fraction < 1 && !tr.startsolid && tr.normal.z >= 0.7 && Math.abs(p.z - tr.end.z) > 0.5 / 32) assign(p, tr.end);
  }
  private categorizePosition() {
    const p = this.position, v = this.velocity;
    this.surfaceFriction = 1;
    let point = p.z - 2, moveToEnd = false;
    if (this.grounded) { moveToEnd = true; point -= RULES.stepSize; }
    if (v.z > RULES.nonJumpVelocity) { this.setGround(undefined); return; }
    const tr = this.trace(p, { ...p, z: point });
    if (!tr.box || tr.fraction >= 1 || tr.normal.z < 0.7) {
      this.setGround(undefined);
      if (v.z > 0) this.surfaceFriction = 0.25;
      return;
    }
    this.setGround(tr.box);
    if (moveToEnd && !tr.startsolid && tr.fraction > 0 && tr.fraction < 1) assign(p, tr.end);
  }
  private setGround(box: Box | undefined) {
    if (!box) { this.grounded = false; return; }
    const landed = !this.grounded;
    this.grounded = true; this.platform = box.id; this.velocity.z = 0;
    if (landed && this.jump) {
      const j = this.jump, sameHeight = Math.abs(box.max.z - j.start.z) < 0.1;
      const groundZ = sameHeight ? j.start.z : box.max.z + DIST_EPSILON;
      // Uncrouching can put the feet on the floor before AirMove. There is no
      // airborne segment to extrapolate in that case, and last tick's is stale.
      const endpoint = this.airMoved ? this.landingOrigin(this.moveStart, this.moveVelocity, groundZ) : { ...this.position, z: groundZ };
      this.finish(true, box, endpoint);
    }
  }
  private checkFalling() {
    if (!this.grounded || this.fallVelocity <= 0) return;
    // CS:GO's landing view punch (degrees of pitch, looking down), then OnLand's stamina cost.
    if (this.fallVelocity > 16) this.viewPunch = Math.max(0.75, this.fallVelocity * 0.001);
    this.stamina = Math.min(RULES.staminaMax, Math.max(0, this.stamina + RULES.staminaLandCost * this.fallVelocity));
    this.fallVelocity = 0;
  }
  // GOKZ's GetRealLandingOrigin: where the feet reach the landing height along the last air move.
  landingOrigin(origin: Vec, velocity: Vec, groundZ: number): Vec {
    if (origin.z === groundZ || velocity.z >= 0) return { ...origin, z: groundZ };
    const fraction = (origin.z - groundZ) / (-velocity.z / this.tickRate);
    return { x: origin.x + velocity.x / this.tickRate * fraction, y: origin.y + velocity.y / this.tickRate * fraction, z: groundZ };
  }
  finish(landed: boolean, platform?: Box, endpoint = this.position) {
    if (!this.jump) return;
    const j = this.jump;
    const distance = Math.hypot(endpoint.x - j.start.x, endpoint.y - j.start.y) + 32;
    const sameHeight = Math.abs((platform?.max.z ?? j.start.z) - j.start.z) < 0.1;
    const valid = landed && sameHeight && j.valid && j.ticks > this.tickRate * 0.5 && distance >= 200;
    const width = j.strafes.length ? j.strafes.reduce((sum, s) => sum + s.width, 0) / j.strafes.length : 0;
    this.result = { distance, preSpeed: j.preSpeed, maxSpeed: j.maxSpeed, sync: j.synced / Math.max(1, j.ticks) * 100,
      strafes: j.strafes, duration: j.ticks / this.tickRate, ticks: j.ticks, height: j.height, overlap: j.overlap, deadAir: j.deadAir,
      width, edge: j.edge, path: [...j.path, clone(endpoint)], landed, valid,
      reason: !landed ? 'Missed landing' : !sameHeight ? 'Uneven landing' : !j.valid ? 'Touched a block' : distance < 200 ? 'Short jump' : 'Long jump',
      ducked: j.ducked };
    this.jump = null; this.onResult?.(this.result);
  }
}
