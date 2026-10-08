# Old long-jump map research

Researched 6 October 2026. The user wanted old vanilla CS:GO practice maps, particularly their familiar 246 blocks. Vanilla describes the physics profile, not a separate map format or necessarily a map name.

The [KZ-GC collection](https://steamcommunity.com/sharedfiles/filedetails/?id=1288167226) and [older KZ/BHOP collection](https://steamcommunity.com/sharedfiles/filedetails/?id=329519212) establish the old map lineage. We chose two recoverable original Workshop uploads:

- [longjump_source_go](https://steamcommunity.com/sharedfiles/filedetails/?id=249758765), uploaded 16 April 2014. Original map by AZiRES, CS:GO port by badgec (now kernel). The author identifies it as a port requested by Blasdfa. The imported courtyard contains original 225–260 gaps, including 246.
- [kz_longjumps_go](https://steamcommunity.com/sharedfiles/filedetails/?id=249444895), uploaded 15 April 2014 and updated 18 May 2014. Draw made the original 1.6 map; THEBUGUSER made the Source port; badgec made this CS:GO port. We import the static 240–249 wing, including its actual 246 gap. The author says CS:GO high jumps do not work.

`kz_gc_jumpstats` by GameChaos appeared in the historic collections, but its original download was not recovered, so it is not included. `kz_longjumps2` is an older 1.6 map, rather than a CS:GO BSP, and its original author's page restricts remakes; it was not selected.

## Provenance

[provenance.json](provenance.json) records original Workshop IDs, public Steam CDN file URLs, upload/update timestamps, filenames and SHA-256 hashes of the exact BSPs converted. Source metadata comes from Steam's `ISteamRemoteStorage/GetPublishedFileDetails/v1/` API. The CDN files are ZIP archives containing the BSPs. Original BSP binaries are not part of this project.

No separate permissive license was found. The assets remain credited to the map authors and other original asset owners. The Workshop description of longjump_source_go allows its use on KZ-related game servers; it does not grant a new general asset license. These imports are prepared for this local browser project, and assets are not relicensed.

## Reproduce

The exporter uses [Valve's published BSP structures](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspfile.h) and Pillow's DDS decoder for DXT-compressed VTF pixel blocks. Install Pillow and vpk in a Python environment (`pip install pillow vpk`), download the two archives from the recorded CDN URLs, and extract the BSPs. No map script or downloaded executable is run.

```sh
python scripts/import_source_map.py /path/longjump_source_go_1_1_release.bsp /tmp/imported-source --vpk /path/csgo/pak01_dir.vpk
python scripts/import_source_map.py /path/kz_longjumps_go11.bsp /tmp/imported-go --vpk /path/csgo/pak01_dir.vpk
python scripts/prepare_classic_maps.py --source /tmp/imported-source --go /tmp/imported-go
```

The first pass exports triangulated brush faces, normals, original texture UVs, packed textures, entity origins and axial solid/player-clip brush collision. The second pass selects practice pads by their original brush coordinates. It clips kz_longjumps_go to a supported static wing and adds browser boundaries at the crop. It never expands, shrinks or relocates the practice blocks. The courtyard has 36 fixed gaps; the GO wing has 10. Textures are lossless WebP with a maximum dimension of 512.

The importer also exports the compiled lighting. Each drawn face's style-0 lightmap comes from `LUMP_LIGHTING` (or `LUMP_LIGHTING_HDR` when present; both maps are LDR-only), with per-vertex lightmap coordinates from texinfo `lightmapVecs`. It also writes the BSP planes and nodes, the per-leaf ambient samples (`LUMP_LEAF_AMBIENT_INDEX`/`LIGHTING`) and the world lights (`LUMP_WORLDLIGHTS`). Preparation then:

- packs the lightmaps of kept faces only into a 512² `lightmap.webp`. Each luxel is stored as Source's LDR lightmap texel, 8-bit (L/2)^(1/2.2), with luxels decoded as `c·2^e/255` and one replicated border luxel per face.
- lays out bumped faces (`SURF_BUMPLIGHT`) with their four style-0 lightmaps (flat, then one per bump basis direction) side by side, as in a Source lightmap page, with a per-vertex `lmStep` giving the offset between them. Their materials' `$bumpmap` normal maps are exported as near-lossless WebP. The shader combines the three directional lightmaps with Source's `bumpBasis` exactly as `lightmappedgeneric_ps2_3_x.h` does (`saturate(dot(n, basis))²` weights normalized by their sum, or `$ssbump`'s `n · lightmaps × 0.57735`). The normal-map texel is used in VRAD's own tangent basis, so no vertex tangents are needed.
- prunes the BSP tree to the kept area.
- writes the leaf ambient cubes to `lighting.bin`: 30 bytes per sample (int16 position plus six raw ColorRGBExp32 values, which are `c·2^e` in 0–1 units).

Static props (`sprp` game lump, version 10) were surveyed. longjump_source_go has none, and kz_longjumps_go's ten `props_c17/fence01a.mdl` instances are all outside the imported wing, so no prop importer is included yet. Neither map packs per-vertex prop lighting (`.vhv`).

Static decals (`infodecal`) are projected at import with the engine's rules from `engine/r_decal.cpp` and `engine/decal_clip.cpp`:

- every world surface whose plane is within `DECAL_DISTANCE` (4 units) of the origin, skipping `SURF_NODECALS`, gets the decal;
- the decal is sized by the base texture's mapping size × `$decalscale`;
- the basis comes from `R_DecalComputeBasis` on the surface's unflipped plane normal (S along +X on floors, T down on walls);
- texture coordinates are `dot(p − origin, S) / width + 0.5`, clipped to [0, 1];
- vertices are offset 0.1 along that normal. This is the value as recalled for Source's `OVERLAY_AVOID_FLICKER_NORMAL_OFFSET`; its header is not in the source tree. The browser adds a polygon offset.

Decals carry their surfaces' lightmap coordinates. Materials and textures come from the map pak (the courtyard's `decalindustrialnumber*` and `decal_signroute006a`); `us-expert/us-expert`, used three times in kz_longjumps_go outside the wing, exists in neither the map nor CS:GO. Stock world textures the maps do not pack (`cs_italy/pwood1`, `stone/infwllftop`, `de_mirage/marble/marble_01`, `concrete/vertigo_concretefloora`) are read from the CS:GO VPK, depot 731 chunks 006, 049 and 127.

The importer also exports the 2D skybox named by worldspawn's `skyname`. It uses the map's packed copy if present (kz_longjumps_go packs `italy`); otherwise it takes the stock textures from the CS:GO VPK, passed with `--vpk` (longjump_source_go uses `sky_dust`, from depot 731 chunk 132; see research/viewmodels/README.md). The six faces are saved as lossy WebP at 512 px or less. Geometry, collision and lanes are unchanged by the lighting and sky export, and `bun test` checks lightmap coverage and that every block has ambient samples.

The conversion deliberately excludes gameplay triggers and moving brush behavior. Original decals, compiled lighting and 2D skyboxes are included. Other Source shader effects and prop rendering are outside this static geometry import; neither imported area contains props. GO's angled roof/entrance brush collision is omitted; its selected jump pads and courtyard collision are axial.

`bun test` checks all 46 fixed gaps against their imported brush bounds, verifies unobstructed spawn support and triangle winding, and simulates successful strafing and unsuccessful forward-only jumps on both original 246 lanes at both tick rates. These are controller regression checks, not comparisons against CS:GO recordings.

The browser now starts players in an entrance area instead of selecting a block through the menu. The source courtyard uses the first original spawn, settled one unit onto its supporting floor. The cropped GO wing has an entrance spawn on its original connecting walkway. Original block brush bounds are unchanged.
