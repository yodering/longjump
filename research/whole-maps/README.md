# Whole maps: de_mirage and de_nuke

**Removed from the game on 18 October 2026.** The importer and engine support remain; the steps below rebuild `public/maps/de_mirage` and `public/maps/de_nuke`, which then also need entries in `src/maps.ts`, out of `retiredMaps`.

Valve's competitive maps are imported whole and walkable, so long jumps can be practised anywhere flat. They have no fixed lanes: a jump counts when it lands at its takeoff height, exactly as on the classic maps, and history records no gap.

## Source

The BSPs and the stock content they use come from Valve's final CS:GO content depot (app 740, depot 731, manifest `1224088799001669801`, 12 October 2023), downloaded anonymously with [DepotDownloader](https://github.com/SteamRE/DepotDownloader) 3.4.0 as for the [viewmodels](../viewmodels/README.md).

| File | SHA-256 |
| --- | --- |
| `csgo/maps/de_mirage.bsp` | `1b5ba30d9757cbab1b9f49a04dac7dd59d995f27959bea28c64854ac8ad07aac` |
| `csgo/maps/de_nuke.bsp` | `7733e871727c28facbe14a525c09ec87c1e342ac36ccfa2b1262b9ea61fe0c9d` |
| `csgo/pak01_dir.vpk` | `a9ffaa07380d70e1b4362007cf50351c25844905e200c0e6c20c7d10cfe1364a` |

Nuke packs most of its own content in the BSP. Stock materials, models and skies come from these `pak01` chunks (about 2.3 GB to download, 5.7 GB on disk):

```
002 003 004 006 028 033 040 049 053 054 061 064 067 070 072 073 077 078 079 080 082 087 088 091
092 095 098 104 109 111 114 116 125 126 127 132 149 170 178 182 188 201
```

## Reproduce

```sh
printf 'regex:^csgo/(maps/de_(mirage|nuke)\\.bsp|pak01_dir\\.vpk|pak01_(002|003|004|006|028|033|040|049|053|054|061|064|067|070|072|073|077|078|079|080|082|087|088|091|092|095|098|104|109|111|114|116|125|126|127|132|149|170|178|182|188|201)\\.vpk)$\n' > files.txt
DepotDownloader -app 740 -depot 731 -manifest 1224088799001669801 -filelist files.txt -dir csgo-depot
pip install pillow numpy vpk
python scripts/import_full_map.py csgo-depot/csgo/maps/de_mirage.bsp public/maps/de_mirage --vpk csgo-depot/csgo/pak01_dir.vpk
python scripts/import_full_map.py csgo-depot/csgo/maps/de_nuke.bsp public/maps/de_nuke --vpk csgo-depot/csgo/pak01_dir.vpk
```

The importer also writes `entities.json` beside the output for inspection; it is not used by the game, so delete it before committing. `python scripts/test_static_props.py` checks which entity props become solid. Each import takes under a minute.

## Conversion

`scripts/import_full_map.py` and `scripts/static_props.py` read the BSP, VPK, MDL/VVD/VTX, PHY and VHV files directly.

- **Collision** is everything solid to players (`MASK_PLAYERSOLID`: solid, window, grate, player clip). Brushes that are also `CONTENTS_LADDER` carry a ladder flag (collision.bin `LJC2` stores one contents byte per box and brush; `LJC1` files load as all solid). The importer prints how many ladder brushes it found, and how many ladder-only brushes it skipped because `LadderMove`'s `MASK_PLAYERSOLID` trace cannot reach them. Both maps have none of those (Mirage 2 ladder brushes, Nuke 6). Mappers set ladder faces flush with neighbouring clip brushes, so a trace reports a ladder whenever a ladder face is hit within 0.01 units of the nearest hit. Two ladders stay out of reach, as `tests/whole-maps.test.ts` records: Mirage's ladder behind the scaffolding is walled in by clips, and Nuke's short ladder at (−228, −1195) sits 0.02 units back in a recess narrower than the player. Brushes whose real faces are all axis-aligned become boxes, collided with the same slab test as the classic maps. The rest keep their planes, including vbsp's bevels, and the player's box is clipped against them as `CM_ClipBoxToBrush` does. A brush side's high byte marks it thin, not bevelled. Displacements collide per triangle, except those vbsp tagged removed. Static props collide with their PHY convex hulls (IVP compact ledges, converted from metres as vphysics does); `SOLID_BBOX` props use their hull box. A column grid keeps traces cheap, at about 0.07 ms per tick on Mirage. The nearest hit wins, then the lowest primitive, so the game and the leaderboard server always agree.
- **World geometry** is every drawn face of the world and visible brush entities (rotated ones included). Displacements are built as `CCoreDispInfo` does. Their lightmaps span the displacement grid from its start corner (`CCoreDispSurface::CalcLuxelCoords`, `CalcDispSurfCoords`), not the base face's planar projection; projecting them misplaced lighting across displacement seams. `WorldVertexTransition` displacements blend `$basetexture2` by vertex alpha. Bump-mapped faces keep their three directional lightmaps, as on the classic maps.
- **Lighting** comes from both maps' HDR lightmaps (they ship no LDR ones), packed into one atlas in the same LDR encoding and `LightmappedGeneric` combine the classic maps use.
- **Static props** are LOD0 meshes lit by VRAD's own baked per-vertex lighting (`sp_hdr_<n>.vhv`, one colour per VTX hardware vertex). The three bump-basis colours CS:GO stores are averaged. Each model is stored once; the browser places every instance and merges them per material. Positions are int16 over the model's bounds and uvs are float16.
- **The 3D skybox** is left out: faces, displacements and props in the clusters visible from the `sky_camera`. The 2D sky (`sky_dust`, `nukeblank`) is drawn as on the classic maps.
- **Placement:** the entry is the first CT spawn. The menu preview uses the map's first showcase camera.

## Not reproduced

Overlays (`info_overlay` posters, markings and cracks), the 3D skybox, water and `prop_door_rotating` are not imported, so those doorways stay open. Brush entities such as `func_door` keep their spawn position. Model entities (`prop_dynamic`, `prop_physics_multiplayer` and the like) are drawn and collide at their spawn pose but never move or animate. `prop_dynamic` is solid by its `solid` keyvalue unless spawnflag 256 disables collision; `prop_physics_multiplayer` only with `physicsmode 1`, since autodetect can make it client-side debris. They have no baked per-prop lighting, so they take the leaf's ambient colour. The importer prints how many it placed, how many are solid, and what it skipped. Props fade at no distance.

## Rights

These are Valve's CS:GO maps and assets. They keep their original owners' rights; this project assigns no license to them and claims no authorship. This project is not affiliated with Valve.
