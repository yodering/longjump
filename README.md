# longjump

A desktop browser long-jump practice room inspired by vanilla CS:GO KZ. Three imported Workshop long-jump maps (kz_baxter's LJ room, the default, plus two from 2014), with mouse-look and manual strafing. Built with TypeScript, Three.js and Vite.

## Run

```sh
bun install --frozen-lockfile
bun run dev
```

Use Bun 1.4.2 or newer.

Open **http://127.0.0.1:5173/** in a desktop browser with WebGL and pointer-lock support. Click **Play** to capture the mouse. The game also works as a static site: `bun run build` produces `dist/`. `bun run preview` serves that build locally.

## Controls

| Input | Action |
| --- | --- |
| WASD + mouse | Move / look |
| Space or mouse wheel | Jump (manual; holding Space does not auto-hop) |
| Ctrl | Crouch; late air duck raises the feet for a longer jump |
| Shift | Walk |
| R | Return to saved position, or map entrance if none |
| X / C | Save / return to a standing position (checkpoint beep) |
| F | Inspect knife |
| Mouse 1 / Mouse 2 | Light / heavy knife swing (cosmetic) |
| H | Show / hide the jump stats panel |
| M | Spectate the next player in a room; Mouse 1 / Mouse 2 cycle players, M again stops |
| Esc | Toggle the menu / resume play |

These are the default binds. **Settings → Controls** supports keyboard, mouse buttons and wheel directions, multiple binds per action, removing binds and restoring defaults. Escape remains reserved for toggling the menu. The optional **Long jump bind** combines jump + duck and cancels held forward/back until those keys are released and pressed again. Release the LJ bind to stand during flight, then duck again before landing. Attempts record whether the LJ bind was used; it does not automate strafing or landing. **Null binds** (Settings → Controls) make the newest strafe key win, as the CS:GO alias script does: pressing A while holding D releases D, and releasing A presses the still-held D again. The game applies this to its own input commands, so replays and the leaderboard see the resolved keys.

**Settings → Import / export** previews supported commands from a CS:GO `.cfg` before applying them. It imports movement/knife binds, a recognized LJ alias, sensitivity, `m_yaw` / `m_pitch`, handedness, viewmodel offsets/FOV/bob and static crosshair settings. Unsupported binds and commands are listed and skipped; config text never executes. Recursive aliases, null-strafe scripts, `exec`, purchases, networking and movement cvars are outside the importer. Try [examples/longjump.cfg](examples/longjump.cfg). Config import merges supported binds with current binds; exported JSON profiles restore the full preference set, retaining the current map and tick rate. Exported `.cfg` files carry the supported Source-style settings; checkpoint/stats commands use VNL-specific names.

**Settings → Display** offers native resolution and fixed presets including 1440×1080, with stretched presentation or black bars, plus fullscreen. These change the browser's render buffer and projection, not the monitor's display mode. Gameplay FOV stays at the CS:GO 90° baseline (horizontal at 4:3). Viewmodel presets, offsets, bob and static crosshair geometry have live previews. The Crosshair section also applies and copies CS:GO crosshair share codes (`CSGO-xxxxx-…`). **Settings → HUD** places the speed readout under the crosshair (KZ style), in the bottom panel, both or neither, with optional takeoff speed in parentheses while airborne, 0–2 decimals, and size, color and distance for the crosshair readout. It also toggles the key display, personal best, control hints, jump stats panel and last-jump trail. While the HUD or Crosshair page is open, the real HUD shows over the live view. Preferences save in this browser automatically.

Run toward the takeoff edge at 250 u/s, jump, release W, and alternate A with a left mouse turn and D with a right mouse turn. Duck before landing. Use **Maps** to choose a room, then walk or jump to the block you want to practice. The courtyard uses its original spawn area. The cropped GO wing spawns at its entrance walkway. Save a practice position with X and return with C or R.

The jump stats panel starts hidden. Press H or use Show stats while playing to toggle it; the choice saves in this browser and is also available in Settings.

The HUD follows GOKZ: a center info panel with speed (takeoff speed in parentheses while airborne) and held keys (`W A S D C J`), a chat-style jumpstats report coloured by distance tier (strafes, sync, pre, max, edge, height, airtime ticks, overlap, dead air, average strafe width), and a console-style per-strafe table (sync, gain, loss, max, air share, width) beside a top-down jump path. History and personal bests are saved in this browser. Attempts are stored individually in IndexedDB without an application count limit; existing localStorage history is migrated once. History supports map, tick-rate and result filters, map/distance search, newest/longest sorting, ten-attempt pages, expandable stats and backup import/export. Browser storage quotas still apply. Only valid landed jumps count as bests, separated by map, tick rate and auto-hop setting. LJ binds compete for the same best. Older attempts without an auto-hop setting remain labeled Legacy. The speed HUD shows the current PB, and History lists records for the selected map and tick rate. A miss leaves you on the walkable courtyard or pit floor. Only falling out of the map resets you to your saved position or entrance. R returns immediately.

History backups include all attempts, personal bests, preferences and map-specific saved positions. Import previews new attempts and duplicates before merging. Applying preferences or saved positions is optional; display settings need a separate choice. Reimporting a file adds no duplicate attempts. Version-1 history exports remain supported, including archived Concrete attempts. Saved positions survive reloads and only restore on matching map geometry with safe standing support. Backups support up to 100,000 attempts and 128 MiB per file. Browser storage quotas still apply.

The Leaderboard tab posts your best manual (auto-hop off) jumps under a name you choose. The server replays each jump with the same physics before accepting it. See the [leaderboard server](server/README.md) and the [leaderboard and multiplayer plan](research/roadmap/leaderboard-multiplayer.md). It is not deployed yet.

Private rooms (Practice → Play with friends) show other players' models, which can be hidden from the same panel. Room chat only announces valid jumps of 240 units or more; shorter jumps appear in your own feed only. Spectating watches a player in first person from their relayed poses (about 100 ms behind, without their keys); your own movement pauses where you were and resumes when you stop, and other players don't see your model meanwhile.

## Movement and fidelity

The controller runs at a fixed 64 or 128 ticks per second, independent of drawing frames. Vanilla parameters follow [GOKZ's mode documentation](https://github.com/KZGlobalTeam/gokz/wiki/Modes):

| Parameter | Value |
| --- | --- |
| Knife run speed | 250 units/s |
| Ground acceleration | 5.5 |
| Air acceleration | 12 |
| Air wish-direction speed cap | 30 |
| Ground friction / stop speed | 5.2 / 80 |
| Gravity | 800 units/s² |
| Jump impulse | 301.993377 units/s |
| Hull half-width / standing height / duck height | 16 / 72 / 54 |

`src/physics.ts` is a port of CS:GO's own movement code, `game/shared/gamemovement.cpp` and `game/shared/cstrike15/cs_gamemovement.cpp` from the CS:GO source tree (cstrike15_src), function by function and in the same per-tick order:

1. `CheckParameters`: walk (0.52, only within 25 u/s of walk speed), the stamina speed scale `(1 − stamina/100)²` (applied in the air too), the ±450 move clamp, the duck-spam penalty, and view-punch decay.
2. `ReduceTimers`: stamina recovers at 60/s.
3. `Duck`: CS:GO's duck amount and duck speed (ideal 8; each press or release costs 2; recovers 3/s). Ground crouch speed is 0.8 × duck speed, standing up runs at full duck speed, the hull shrinks only when fully ducked and grows as soon as standing up starts, `CanUnduck` checks headroom, a 0.4 s re-duck lockout applies, and an air duck is instant with the hull centre kept (feet +9). `HandleDuckingSpeedCrop` scales speed by `lerp(1, 0.34, duckAmount)` in the air as well, so a mid-air duck cuts air acceleration.
4. `StartGravity`, then `CheckJumpButton`: the 1.1× speed clamp, `+=` the 301.993377 impulse (`=` when ducking), the stamina scale on the impulse, `FinishGravity`, and the jump stamina cost of `0.08 × impulse`. Standing jump height is therefore tick-dependent: 54.65 units at 64 tick and 55.83 at 128.
5. `Friction`, then `WalkMove` (CS:GO's `Accelerate` with a goal-speed scale, the clamp to max speed, `StepMove` up to 18 units, `StayOnGround`) or `AirMove`/`AirAccelerate` (30 u/s wish cap).
6. `TryPlayerMove`: a swept hull trace with up to four bumps, `ClipVelocity` and crease handling. Traces stop `DIST_EPSILON` (1/32) short, so a standing origin rests at floor + 0.03125 as in Source.
7. `CategorizePosition`: the 2-unit ground trace, skipped above 140 u/s upward. When airborne and rising it sets `m_surfaceFriction` to 0.25 for the next tick (the [deadstrafe](https://gist.github.com/zer0k-z/808bc8bfc494e0bbb5a423c2b1ca6685)).
8. `FinishGravity` and `CheckFalling`: the landing stamina cost `0.05 × fall speed` and CS:GO's landing view punch (≥ 0.75°, decaying at `view_punch_decay` 18).

Keyboard and mouse events are timestamped and consumed by the next physics command. Render catch-up ticks cannot reuse future input. Movement keys use Source’s `CInput::KeyState` fractions for presses, taps, holds and re-presses. The camera uses current mouse look and predicts a fraction of a tick ahead from the latest completed command, with hull collision traces. This affects presentation only; movement and jump measurements still use fixed commands. Held-key HUD feedback updates every rendered frame. Frames up to 250 ms catch up without dropping physics time; longer stalls suspend the simulation and discard pending taps. Manual jumping is the default. As in CS:GO, a hop needs a command without jump before it, so holding Space through a landing never hops. Unlike CS:GO, a fresh key press or wheel notch also rearms the jump: browser wheel events arrive about once per frame, so scrolling often sets jump on every command and strict vanilla timing would drop most scroll hops. A tap in the air still never queues a hop for landing. Optional auto-hop repeats held jumps while preserving vanilla takeoff speed and stamina. There is no KZ prestrafe boost or auto-strafe.

Remaining differences from the game:

- Collision runs against the maps' axis-aligned brush boxes, not BSP brushes, so there are no slopes or ramps. The quadrant ground fallback (`TracePlayerBBoxForGround`) only matters on slopes and is omitted. The courtyard and pit floors remain walkable after misses; only falling outside the imported geometry resets the player. Ladders, water and surface properties (all friction 1) are outside this prototype.
- Math is double precision; Source uses 32-bit floats, so positions differ in the far decimals.
- Distance is horizontal origin displacement plus 32 units, with GOKZ's interpolated touchdown origin. Edge is the distance from the takeoff block edge to the back of the hull. Misses are measured at the takeoff elevation. Touching any non-floor surface invalidates a jump, and jumps below 200 units do not count as bests. Sync is the share of airborne ticks with horizontal speed gain. These follow KZ conventions but are not certified GOKZ scores.
- Mouse sensitivity defaults to Source's 0.022° per browser pixel, with imported `m_yaw` / `m_pitch` support; pointer lock requests unaccelerated input, falling back when the browser reports it unsupported. Browser event delivery and DPI can still differ from CS:GO raw input. Pitch is limited to ±89°. FOV follows Source's horizontal-at-4:3 convention, as does the viewmodel's. Crosshair sizes are CSS pixels and approximate Source's static crosshair rather than reproducing its resolution-dependent rasterization.

Reference checks and regression tests are documented in [research/movement/README.md](research/movement/README.md). Recorded CS:GO command/state traces are still needed to establish tick-by-tick parity; passing the browser replay tests does not establish that parity.

## Verification

```sh
bun test
bun run build
```

The headless movement tests cover both tick rates: maximum ground speed and diagonal input, tick-dependent jump height (54.65 / 55.83), jump-tick gravity ordering, landing at floor + `DIST_EPSILON`, interpolated landing distance, instant 9-unit air duck, ground duck timing with the press penalty, `CanUnduck` headroom, the mid-air duck speed crop, the jump stamina scale, next-tick deadstrafe, air-duck range, no auto-bhop, successful strafing across 246 versus failed forward-only jumps, failed-jump measurement, wish-direction acceleration caps, swept collision and result eligibility.

Timestamped six-strafe replays must produce identical commands, positions and jump results at 30, 60, 144 and 240 FPS and with uneven frames, at both tick rates. Collision regressions cover corner entry planes, steps, wall slides, ceilings and uncrouch landings.

Input/config tests cover LJ cancellation, alternate key releases, quick wheel/key taps, pause cleanup, quoted commands and comments, restricted aliases, bounded settings, config round trips and malformed saved preferences. Display tests cover exact fixed buffers, stretching, black bars, resizing and native pixel density.

Classic map geometry, packed textures and the stock materials used by the imported areas are bundled with creator credits. Original BSPs are not bundled. The UI uses system fonts; gameplay, geometry and interface have no remote asset dependencies. This project is not affiliated with Valve.

## Classic maps

| Map | Imported area | Fixed original gaps | Credits |
| --- | --- | --- | --- |
| [longjump_source_go](https://steamcommunity.com/sharedfiles/filedetails/?id=249758765) | Original courtyard | 225–260 | AZiRES; CS:GO port by badgec / kernel |
| [kz_longjumps_go](https://steamcommunity.com/sharedfiles/filedetails/?id=249444895) | Static LJ wing | 240–249 | Draw (1.6), THEBUGUSER (Source), badgec / kernel (CS:GO) |

Both Workshop releases date to April 2014. These were general long-jump practice maps; vanilla is the movement mode we apply to them. The imports come from the actual BSPs, including their original 246-unit brush spacing. They are not rooms approximated from screenshots. Source units and world coordinates are retained. Map choice loads geometry and textures locally; no live Steam connection is needed to play.

Rendering uses converted brush faces, packed VTF textures and each map's own compiled VRAD lighting. Surfaces use the style-0 lightmaps packed into one atlas per map, in Source's LDR lightmap format, with the LDR `LightmappedGeneric` combine (albedo × lightmap × 2 in gamma space). There are no dynamic lights or shadow maps on imported maps. Both maps were compiled LDR-only. Faces with normal-mapped materials use their three directional (bump) lightmaps, combined with the normal map as in `LightmappedGeneric`, including `$ssbump`. Two animated water normal maps outside the playable area fall back to the flat lightmap. Each map's 2D skybox (`sky_dust` from the CS:GO VPK, and the `italy` copy packed into kz_longjumps_go) is drawn as a depth-free background box in Source's face layout. Six 512 px faces add about 40 KB per map. Neither map has a 3D skybox. Static `infodecal`s, including the courtyard's block numbers and signs, are projected at import the way the engine places them (`R_DecalShoot` → `R_DecalVertsClip`), and are alpha-blended and lit by their surfaces' lightmaps. The GO wing's numbers are brush textures; its decals are all outside the imported wing. Stock textures the maps do not pack come from the CS:GO VPK, so no surface falls back to a flat colour. Neither imported area contains static props: the courtyard has none, and kz_longjumps_go's ten `fence01a` props are in rooms outside the wing. Other shader effects are not reproduced. `longjump_source_go` has fully axial brush collision. `kz_longjumps_go` is limited to its static 240–249 wing: 18 non-axial brushes in that crop (roof/entrance details) have visible faces but no angled collision. Invisible bounds keep the player within the supported wing. Moving entities, map triggers, teleporters, high jumps and other rooms are not implemented. The original author also marked high jumps as unsupported in their CS:GO port. `kz_baxter` (2018) contributes only its LJ block room: 89 axial lanes from 210 to 310 units along both axes, numbered by the map's own `point_worldtext` labels, which are drawn as unlit text. Its sky (`sky_csgo_cloudy01`) comes from the CS:GO VPK; the climb, hub and teleports are not imported. See [research/maps](research/maps/README.md).

See [research/maps/README.md](research/maps/README.md) for research, provenance and reproducible conversion. Map assets retain their original creators' rights and attribution; we do not assign a new license to them.

## Viewmodel

The first-person knife and arms are CS:GO's default knife viewmodels, converted with their animations: CT (ST6 sleeves, hard-knuckle gloves) or T (Phoenix full-finger gloves), chosen in Settings. Draw plays on spawn, `idle1` loops, F inspects, and the mouse buttons swing. A left-handed option mirrors it like `cl_righthand 0`. The Desktop preset starts at `viewmodel_fov 60` with CS:GO's default offsets; Couch, Classic and custom FOV/offset/bob settings are available.

The files come straight from Valve's final CS:GO content depot, downloaded anonymously, and `scripts/import_viewmodels.py` converts them. See [research/viewmodels/README.md](research/viewmodels/README.md) for the download command, conversion details and hashes. Bob, the running lower (`cl_bob_lower_amt`) and lag are CS:GO's `CalcViewModelBobHelper`, `AddViewModelBobHelper` and `CalcViewModelLag`. Shading is Source's VertexLitGeneric phong pixel shader with each material's VMT constants. On imported maps it is lit by the map's compiled light state at the eye, as Source lights models: the ambient cube is interpolated from the eye's BSP leaf samples, the sun counts only when the sky is visible, the strongest visible point light is added, and the remaining lights are folded into the cube. The bare arm's `character` shader is approximated with the same phong model.

## KZ audio

The five announcer clips are the actual files shipped in GOKZ, rather than speech synthesis. Valid landed long jumps play only the highest reached tier: Impressive ≥230, Perfect ≥235, Godlike ≥240, Ownage ≥243 and Wrecker ≥246. Failed jumps, invalid landings and lower distances stay silent. These custom practice thresholds apply at both tick rates. Thresholds and sound packs were configurable on servers, so other servers or older plugins can differ.

Checkpoint saves, returns and resets use the CS:GO `buttons/blip1.wav` sample; rejected checkpoint actions use `buttons/button10.wav`. They are not played on every takeoff or miss. Timer start/end sounds are separate in GOKZ; this long-jump-only prototype has no course timer, so it does not pretend a reset starts a timed run.

Settings contains a KZ-sound toggle, volume control and sample buttons. Samples deliberately play even when gameplay sound is muted. All seven files load locally and decode through Web Audio after a user gesture. [research/audio/README.md](research/audio/README.md) contains pinned sources, hashes, the source-pack license and the exact config references.

