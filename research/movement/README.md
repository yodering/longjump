# Movement audit

Checked 8 October 2026. The target is GOKZ vanilla with a knife, at 64 or 128 tick. This is a reference-code audit with deterministic browser-command tests. We have not compared captured CS:GO user commands and player states against this controller.

## References

- [GOKZ vanilla settings](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/gokz-mode-vanilla.sp). Air acceleration 12, wish cap 30, gravity 800, jump impulse 301.993377, jump/landing stamina 0.08/0.05, recovery 60, and duck cooldown 0.4 are retained.
- [CS:GO movement](https://github.com/perilouswithadollarsign/cstrike15_src/blob/f82112a2388b841d72cb62ca48ab1846dfcc11c8/game/shared/cstrike15/cs_gamemovement.cpp) and [shared movement](https://github.com/perilouswithadollarsign/cstrike15_src/blob/f82112a2388b841d72cb62ca48ab1846dfcc11c8/game/shared/gamemovement.cpp). Checked command scaling, gravity order, air acceleration, stamina, crouch transitions, ground categorization, steps, and velocity clipping against the source snapshot already used by this project. This snapshot is not a guarantee of behavior in the final CS:GO binary.
- [CS:GO input](https://github.com/perilouswithadollarsign/cstrike15_src/blob/f82112a2388b841d72cb62ca48ab1846dfcc11c8/game/client/in_main.cpp), `CInput::KeyState`. Movement axes distinguish a new press, a held key, a tap, and a release/repress. Button flags remain separate from fractional movement.
- [Source brush collision](https://github.com/perilouswithadollarsign/cstrike15_src/blob/f82112a2388b841d72cb62ca48ab1846dfcc11c8/engine/cmodel.cpp), `IntersectRayWithBoxBrush`. Check the geometric intersection first; select the contact plane from the epsilon-expanded crossing intervals.
- [GOKZ jump tracking](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/gokz-jumpstats/jump_tracking.sp). Horizontal origin displacement plus the 32-unit hull remains the distance convention. Full GOKZ landing bug corrections and eligibility rules are not implemented here.

## Changes

The render loop previously applied its latest key state and yaw to every pending physics tick. A strafe change could affect ticks before the input arrived, and frames longer than 50 ms dropped simulation time. `src/commands.ts` now queues timestamped events for each command boundary. Camera rotation still responds to the current mouse angle. Frames up to 250 ms catch up; longer suspensions discard pending taps and preserve held inputs. Pause, focus loss, map changes and resets flush the queue.

Movement axes now use the input reference's fractions: 0.5 on press, 1 while held, 0 on release, 0.25 on tap, and 0.75 on release/repress. Alternate bindings retain their shared action until the last key releases. Strafe statistics use the sign of lateral movement so a press becoming a hold does not create another strafe.

Pointer lock requests unaccelerated input, with a standard-input fallback for unsupported platforms. Mouse pitch now reaches 89 degrees in either direction. The browser still controls event delivery and coalescing; this command queue does not reproduce Source's entire client input/prediction pipeline.

Corner traces now choose the contact plane after applying the collision epsilon. The old calculation chose the geometric plane first, which could pull a fast diagonal trace too far back. Uncrouching onto the floor now measures the current position instead of extrapolating a stale air-movement segment. Resets determine actual ground support and clear crouch recovery history. The final gravity half-step now also respects the velocity cap.

## Verification

Run `bun test` and `bun run build` from the repository root.

The six-strafe recording in `tests/commands.test.ts` includes a run-up, W release, mouse-wheel jump, alternating A/D turns and late crouch. Every command, position, speed, stamina value and final result must match across 30, 60, 144 and 240 FPS, plus an uneven frame schedule containing an 80 ms stall, at both tick rates. These are deterministic synthetic inputs, not recordings from CS:GO.

Physics tests also cover jump height and distance, stamina and deadstrafe ordering, late air duck, no automatic bunnyhopping, corner contacts, 18-unit steps, taller walls, ceiling collisions, uncrouch landings, and manual strafes across each imported map's 246-unit gap.

The browser check verified map loading and the cleaned-up menus. The in-app browser rejected both raw and standard pointer lock with Chromium's `UnknownError`, so it could not provide a mouse-controlled playtest. Fallback behavior is covered by the unit tests.

Remaining differences include double-precision arithmetic, axis-aligned collision, browser input timing, eye-position interpolation, and incomplete GOKZ statistics. Slopes, ladders, water, moving platforms and non-default surface physics remain outside the controller. A claim of exact or near-perfect parity needs game-recorded command/state traces and a side-by-side playtest.
