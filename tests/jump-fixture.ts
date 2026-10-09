import { Movement, type Box, type Input, type Result } from '../src/physics.ts';
import { JumpRecorder, type Replay } from '../src/replay.ts';

export const flat: Box[] = [{ id: 'flat', min: { x: -4000, y: -4000, z: -100 }, max: { x: 4000, y: 4000, z: 0 } }];
export const idle: Input = { forward: 0, side: 0, jump: false, duck: false, walk: false, yaw: 0 };

// Runs up, jumps and air-strafes on flat ground, recording exactly as the game does.
export function recordJump(tickRate: 64 | 128, strafeRate = 0.012) {
  const m = new Movement(); m.boxes = flat; m.tickRate = tickRate; m.reset({ x: 0, y: 0, z: 0 });
  const recorder = new JumpRecorder(); let result: Result | null = null, replay: Replay | null = null;
  m.onResult = value => {
    result = value; const taken = recorder.current()!;
    replay = { version: 1, tickRate, mapId: 'flat', mapContentVersion: 'test', physicsVersion: 'test', ...taken };
  };
  let yaw = 0;
  for (let t = 0; t < tickRate * 4 && !result; t++) {
    const airborne = !!m.jump, side = airborne ? (Math.floor(t / (tickRate / 4)) % 2 ? 1 : -1) : 0;
    if (airborne) yaw += side * strafeRate;
    const input = { ...idle, forward: airborne ? 0 : 1, side, yaw, jump: t === tickRate };
    recorder.beforeStep(m, input); m.step(input);
  }
  if (!result || !replay) throw new Error('jump did not finish');
  return { result: result as Result, replay: replay as Replay };
}
