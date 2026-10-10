# Whole maps: de_mirage and de_nuke

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

The importer also writes `entities.json` beside the output for inspection; it is not used by the game. Each import takes under a minute.

## Conversion

`scripts/import_full_map.py` and `scripts/static_props.py` read the BSP, VPK, MDL/VVD/VTX, PHY and VHV files directly.

- **Collision** is everything solid to players (`MASK_PLAYERSOLID`: solid, window, grate, player clip). Brushes whose real faces are all axis-aligned become boxes, collided with the same slab test as the classic maps. The rest keep their planes, including vbsp's bevels, and the player's box is clipped against them as `CM_ClipBoxToBrush` does. A brush side's high byte marks it thin, not bevelled. Displacements collide per triangle, except those vbsp tagged removed. Static props collide with their PHY convex hulls (IVP compact ledges, converted from metres as vphysics does); `SOLID_BBOX` props use their hull box. A column grid keeps traces cheap, at about 0.07 ms per tick on Mirage. The nearest hit wins, then the lowest primitive, so the game and the leaderboard server always agree.
- **World geometry** is every drawn face of the world and visible brush entities (rotated ones included). Displacements are built as `CCoreDispInfo` does, with their lightmaps interpolated over the base face. `WorldVertexTransition` displacements blend `$basetexture2` by vertex alpha. Bump-mapped faces keep their three directional lightmaps, as on the classic maps.
- **Lighting** comes from both maps' HDR lightmaps (they ship no LDR ones), packed into one atlas in the same LDR encoding and `LightmappedGeneric` combine the classic maps use.
- **Static props** are LOD0 meshes lit by VRAD's own baked per-vertex lighting (`sp_hdr_<n>.vhv`, one colour per VTX hardware vertex). The three bump-basis colours CS:GO stores are averaged. Each model is stored once; the browser places every instance and merges them per material. Positions are int16 over the model's bounds and uvs are float16.
- **The 3D skybox** is left out: faces, displacements and props in the clusters visible from the `sky_camera`. The 2D sky (`sky_dust`, `nukeblank`) is drawn as on the classic maps.
- **Placement:** the entry is the first CT spawn. The menu preview uses the map's first showcase camera.

## Not reproduced

Overlays (`info_overlay` posters, markings and cracks), the 3D skybox, water, and dynamic entities (`prop_dynamic`, `prop_physics_multiplayer`, `prop_door_rotating`, moving `func_door`s) are not imported, so doorways stay open and loose props are absent. Ladders are not climbable. Props fade at no distance.

## Rights

These are Valve's CS:GO maps and assets. They keep their original owners' rights; this project assigns no license to them and claims no authorship. This project is not affiliated with Valve.
