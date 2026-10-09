# Player models

Room occupants appear as CS:GO's own third-person players, holding the default knife that matches their knife setting.

| Option | Body | Knife | Animations |
| --- | --- | --- | --- |
| CT default | `custom_player/legacy/ctm_st6.mdl` | `w_knife_default_ct.mdl` | `custom_player/animset_ct.mdl` |
| T default | `custom_player/legacy/tm_phoenix.mdl` | `w_knife_default_t.mdl` | `custom_player/animset_t.mdl` |

ST6 and Phoenix match the [first-person arms](../viewmodels/README.md). Each body uses skin family 0 and body group 0.

## Source

Same depot and manifest as the viewmodels; no Steam login is needed:

```sh
printf 'regex:^csgo/pak01_(dir|003|005|007|010|014|020|081|126|140)\\.vpk$\n' > files.txt
DepotDownloader -app 740 -depot 731 -manifest 1224088799001669801 -filelist files.txt -dir csgo-depot
pip install pillow vpk
python scripts/import_players.py csgo-depot/csgo/pak01_dir.vpk public/players
```

[provenance.json](provenance.json) records the SHA-256 of every source file the importer reads and of both outputs. The conversion is deterministic. The current outputs had the empty-normal fix applied to their existing 512 px normal JPEGs rather than a fresh import, so a re-import differs slightly at island edges.

## Conversion

`scripts/import_players.py` reuses the viewmodel importer's MDL, VVD, VTX, VMT and VTF readers.

- **Skeleton.** The body's 89 (CT) or 86 (T) bones, with the third-person knife bone-merged by name, as Source does for world models.
- **Animation decoding.** The animsets store `mstudioanim_t` run-length-encoded tracks (`bone_decode.cpp`): raw `Quaternion48`/`Quaternion64`, Euler angles scaled by each bone's `rotscale` and added to its default `rot` (non-delta), and `posscale` positions. Long sequences are split into 30-frame sections.
- **Layer baking.** CS:GO's `csgo_playeranimstate.cpp` layers a full-body aim pose (`knife_aim_idle/walk/run/crouch_idle/crouch_moving`, from the centre of the 3×3 aim grid) under the eight-direction movement cycles (`move_knife_r/w/c`) and the jump, fall and land sequences. Each layer applies through its sequence's per-bone weight list. The importer bakes those combinations into glTF clips: `idle`, `crouch_idle`, `run_*`, `walk_*` and `crouch_*` for eight directions, plus `jump`, `fall`, `land_light` and `land_heavy`. It also exports reference poses that the game applies additively:
  - **Aim:** the aim grid's ends (yaw ±60°, pitch ±90°, standing and crouched) as `aim_up/down/left/right` and `crouch_aim_*`.
  - **Lean:** the four leans as `lean_n/e/s/w`.
  - **Idle fidget:** `alive`, the idle pose breaker. It's a delta animation, applied like Source's `QuaternionSM` (rotation = delta^w × base, position = base + w × delta). All directions in a set are resampled to one length so they loop together. Each clip's ground speed comes from its animation's movement record and is stored in the scene extras.
- **Empty normal texels.** The ST6 and Phoenix body normal maps leave large regions as all-zero DXT blocks that the body UVs still use (about 40% of the CT lower body's triangles and 80% of the T body's). A zero texel decodes to z ≤ 0, which is no valid tangent-space normal: it lit trousers and jackets from behind, so they glowed pale against the map. The importer writes every texel with blue below 128 as flat (128, 128, 255), before resizing so the empty space cannot bleed into the islands.
- **Size.** Tracks that never move are dropped. Unchanging tracks become one key, and rotations are stored as normalized 16-bit quaternions. Colour textures are capped at 1024 px and normal maps at 512 px. Packed phong masks are 256 px. Each GLB is about 3.8 MB.

## Runtime

`src/remote-players.ts` loads a model the first time someone in a room needs it, so solo practice never downloads them. Each actor clones the skeleton and has its own animation mixer.

Every frame, the actor's interpolated velocity, view yaw, crouch amount and grounded flag pick the clip weights:
- **Locomotion:** speed blends idle into walk (above 40 u/s) and walk into run (110–170 u/s); crouch amount blends standing and crouched sets.
- **Direction:** movement direction relative to the view blends the two nearest of the eight directional cycles.
- **Playback speed:** cycles play at the speed their feet cover the ground.
- **Air:** takeoff plays `jump` and leaving the ground fades to `fall`. Landing after more than 0.25 s in the air plays `land_light` briefly.

Additive layers then follow CS:GO's player animation state:
- **Feet yaw:** the body turns toward the view while moving. Standing still, it stays put until the view passes 58°, then squares up after a moment. The `aim_left/right` poses twist the upper body the rest of the way.
- **Pitch:** the view pitch weights `aim_up/down`.
- **Lean:** ground acceleration relative to the body weights the two nearest `lean_*` poses.
- **Idle fidget:** `alive` loops at full weight, and at half weight in the air.

Additive clips are measured from `idle` (or `crouch_idle`). Bones missing from the reference use their rest pose.

Each player is drawn with Source's phong shader (`src/source-phong.ts`), as the viewmodel is. It has its own light state: the map's compiled lighting sampled at chest height where the player stands (`MapLighting.state`), refreshed after it moves 8 units or every 300 ms. On these maps the compiled sun is nearly horizontal, so the ambient cube provides most of the model light, just as for the viewmodel.

## Rights

These are Valve's CS:GO assets. They keep their original owners' rights; this project assigns no license to them and claims no authorship. This project is not affiliated with Valve.
