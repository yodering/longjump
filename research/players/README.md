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

[provenance.json](provenance.json) records the SHA-256 of all 51 source files the importer reads and of both outputs. The conversion is deterministic.

## Conversion

`scripts/import_players.py` reuses the viewmodel importer's MDL, VVD, VTX, VMT and VTF readers.

- **Skeleton.** The body's 89 (CT) or 86 (T) bones, with the third-person knife bone-merged by name, as Source does for world models.
- **Animation decoding.** The animsets store `mstudioanim_t` run-length-encoded tracks (`bone_decode.cpp`): raw `Quaternion48`/`Quaternion64`, Euler angles scaled by each bone's `rotscale` and added to its default `rot` (non-delta), and `posscale` positions. Long sequences are split into 30-frame sections.
- **Layer baking.** CS:GO's `csgo_playeranimstate.cpp` layers a full-body aim pose (`knife_aim_idle/walk/run/crouch_idle/crouch_moving`, from the centre of the 3×3 aim grid) under the eight-direction movement cycles (`move_knife_r/w/c`) and the jump, fall and land sequences. Each layer applies through its sequence's per-bone weight list. The importer bakes those combinations into 30 glTF clips: `idle`, `crouch_idle`, `run_*`, `walk_*` and `crouch_*` for eight directions, plus `jump`, `fall`, `land_light` and `land_heavy`. All directions in a set are resampled to one length so they loop together. Each clip's ground speed comes from its animation's movement record and is stored in the scene extras.
- **Size.** Tracks that never move are dropped. Unchanging tracks become one key, and rotations are stored as normalized 16-bit quaternions. Colour textures are capped at 1024 px and normal maps at 512 px. Phong mask textures are omitted because players currently use three.js standard materials; the VMT phong constants stay in each material's `extras.source`. Each GLB is about 3 MB.

## Runtime

`src/remote-players.ts` loads a model the first time someone in a room needs it, so solo practice never downloads them. Each actor clones the skeleton and has its own animation mixer.

Every frame, the actor's interpolated velocity, view yaw, crouch amount and grounded flag pick the clip weights:
- **Locomotion:** speed blends idle into walk (above 40 u/s) and walk into run (110–170 u/s); crouch amount blends standing and crouched sets.
- **Direction:** movement direction relative to the view blends the two nearest of the eight directional cycles.
- **Playback speed:** cycles play at the speed their feet cover the ground.
- **Air:** takeoff plays `jump` and leaving the ground fades to `fall`. Landing after more than 0.25 s in the air plays `land_light` briefly.

The body faces the view yaw. Aim pitch, the idle pose-breaker, lean and Source's feet-yaw lag are not applied.

## Rights

These are Valve's CS:GO assets. They keep their original owners' rights; this project assigns no license to them and claims no authorship. This project is not affiliated with Valve.
