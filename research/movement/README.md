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

### Second pass: 8 October 2026

Rechecked `CheckParameters`, `PreventBunnyJumping`, `CheckJumpButton`, `Duck`, `FullWalkMove`, `CheckVelocity`, `CheckFalling` and input `KeyState` against the pinned references above. Acceleration, friction, stamina, duck speed, gravity order and the takeoff cap remain unchanged. In particular, the native bunnyhop cap includes vertical velocity after `StartGravity`; changing it to a horizontal-only cap would reduce fidelity.

Two small differences were corrected. `CheckVelocity` now clears NaN position and velocity components before clamping velocity. Landing pitch punch now observes the native upper bound of 1024 units/second, from [the non-HL2 definitions in shareddefs.h](https://github.com/perilouswithadollarsign/cstrike15_src/blob/f82112a2388b841d72cb62ca48ab1846dfcc11c8/game/shared/shareddefs.h). Normal long-jump landings still receive the same punch and stamina cost. This does not add fall damage or death.

New tests at both tick rates check the three-dimensional takeoff cap, landing punch boundaries, its next-command exponential decay, landing stamina, and recovery from NaN components. The full suite contains 105 tests.

The camera now extrapolates position from the latest completed tick, with a collision trace, instead of displaying the previous-to-current tick interval. This reduces visual delay but is an approximation: it does not run the next command's acceleration, crouch transition or step movement. It never changes measured jumps. The README and sound-sample note now describe the actual custom thresholds rather than calling them GOKZ defaults.

Run `bun test` and `bun run build` from the repository root.

The six-strafe recording in `tests/commands.test.ts` includes a run-up, W release, mouse-wheel jump, alternating A/D turns and late crouch. Every command, position, speed, stamina value and final result must match across 30, 60, 144 and 240 FPS, plus an uneven frame schedule containing an 80 ms stall, at both tick rates. These are deterministic synthetic inputs, not recordings from CS:GO.

Physics tests also cover jump height and distance, stamina and deadstrafe ordering, late air duck, no automatic bunnyhopping, corner contacts, 18-unit steps, taller walls, ceiling collisions, uncrouch landings, and manual strafes across each imported map's 246-unit gap.

The browser check verified map loading and the cleaned-up menus. The in-app browser rejected both raw and standard pointer lock with Chromium's `UnknownError`, so it could not provide a mouse-controlled playtest. Fallback behavior is covered by the unit tests.

Remaining differences include double-precision arithmetic, axis-aligned collision, browser input timing, approximate camera prediction, and incomplete GOKZ statistics. Source's crouch-stuck recovery and quadrant ground traces are also absent. Hard-fall roll, fall damage, footsteps and surface-dependent landing sounds are not implemented. Slopes, ladders, water, moving platforms and non-default surface physics remain outside the controller. Consecutive wheel pulses explicitly rearm manual jumping here; that browser behavior still needs comparison with native command button flags. A claim of exact or near-perfect parity needs game-recorded command/state traces and a side-by-side playtest.

## Next fidelity work

Capture matched 64- and 128-tick CS:GO/GOKZ runs with tick number, command movement axes, button flags, view angles, origin, velocity, ground state, crouch state and stamina. Include a flat run, six-strafe long jump, early/late duck, repeated wheel hops, landing against a wall and an 18-unit step. Record the game build, map checksum, movement cvars and initial state with each capture.

Replay those commands in this controller and report the first divergent tick plus position/velocity error over time. Establish tolerances from repeat native captures before deciding whether float32 arithmetic or collision changes improve parity. Keep browser timing tests separate from physics replay so input delivery differences do not look like acceleration bugs. Then compare native-browser play with the game at matching sensitivity, FOV, tick rate and frame rate; measure input-to-camera delay rather than relying only on feel.

Plane-based BSP collision is the next substantial controller project. Port it and its edge/step cases before importing maps that depend on slopes. Every physics or collision change should carry a version so saved results and future room clients can identify the rules they used. See the [accounts and multiplayer plan](../roadmap/accounts-multiplayer.md) for how that version enters saved data and room admission.
