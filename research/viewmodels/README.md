# Viewmodels

The first-person knife and arms are CS:GO's own default knife viewmodels, converted to animated GLB files.

| Option | Knife | Arms (from `viewmodel_arm_config.inc`) |
| --- | --- | --- |
| CT default | `v_knife_default_ct.mdl` | ST6: `v_glove_hardknuckle.mdl` + `v_sleeve_st6.mdl` |
| T default | `v_knife_default_t.mdl` | Phoenix: `v_glove_fullfinger.mdl` (no sleeve) |

ST6 and Phoenix are the player models CS:GO uses on community maps without map-specific agents. The arms use skin family 0 (`bare_arm_133`).

## Source

No public mirror of the stock model files was found, so they come from Valve's own CDN. The legacy CS:GO dedicated server (Steam app 740) includes the shared CS:GO content depot 731 and allows anonymous downloads. Only the archive index and the six chunks holding these files are needed (about 300 MB compressed):

```sh
# SteamRE/DepotDownloader 3.4.0; no Steam login required
printf 'regex:^csgo/pak01_(dir|001|005|006|049|081|126|127|132|140)\\.vpk$\n' > files.txt
DepotDownloader -app 740 -depot 731 -filelist files.txt -dir csgo-depot
pip install pillow vpk
python scripts/import_viewmodels.py csgo-depot/csgo/pak01_dir.vpk public/viewmodels
```

Manifest `1224088799001669801` (12 Oct 2023) is the final CS:GO build. [provenance.json](provenance.json) records the SHA-256 of every source file read from the VPK and of the two outputs.

## Conversion

`scripts/import_viewmodels.py` reads the MDL, VVD, VTX, ANI, VMT and VTF files directly. Layouts follow CS:GO's `public/studio.h`, `public/optimize.h`, `public/mathlib/compressed_vector.h` and `bonesetup/bone_decode.cpp`.

- The knife models carry no animations. They include `v_ct_knife_anim.mdl` / `v_t_knife_anim.mdl`, whose sequences are CS:GO `STUDIO_FRAMEANIM` data (frame × bone, `Quaternion48`/`Quaternion48S`/`Vector48`) in `.ani` blocks, split into 30-frame sections.
- The arms are separate models that Source bone-merges onto the knife skeleton by name. The GLB has one skeleton: knife bones, plus the arm-only bones (clavicles, upper arms) in the arms' idle pose under their parents. Each model keeps its own inverse bind matrices.
- Exported sequences: `draw`, `idle1`, `idle2`, `lookat01` (inspect), `light_miss1`, `light_miss2`, `heavy_miss1`.
- Each material keeps its base texture and normal map (JPEG; normal-map green flipped from DirectX to glTF convention), plus a PNG mask texture: R = phong mask (base alpha with `$basemapalphaphongmask`, otherwise normal-map alpha), G/B/A = the `$phongexponenttexture` red (exponent), green (albedo tint) and alpha (rim mask). The VMT constants that `phong_dx9_helper.cpp` derives (`$phongboost`, `$phongalbedoboost`, `$phongfresnelranges`, `$phongexponent`, `$phongtint`, `$rimlight*`, `$rimmask`) are stored in the material's `extras.source`.
- Env maps are omitted; their tints on these materials are about 0.01. The bare arm's `character` shader (specular warp and fresnel-ranges textures) is approximated with the phong model and its `masks1` rim and albedo masks.
- Triangle winding is chosen from the authored vertex normals, and Source axes (x forward, z up) are rotated to glTF's on the root node.

## Runtime

`src/viewmodel.ts` draws the model in its own pass with `viewmodel_fov 60` and the `viewmodel_presetpos 1` offsets (1, 1, −1). Bob, running lower and lag are ported from `weapon_csbase.cpp` (`CalcViewModelBobHelper`, `AddViewModelBobHelper`) and `baseviewmodel_shared.cpp` (`CalcViewModelLag`) with CS:GO's default `cl_bob*` values; a 250-speed knife bobs on a 0.21 s cycle. `src/source-phong.ts` is Source's phong pixel shader (`phong_ps20b.fxc`, `common_vertexlitgeneric_dx9.h`) with CS:GO's half-lambert-off `SoftenCosineTerm` diffuse, √(N·L)-masked specular, fresnel remapping and rim lighting. On imported maps the light state comes from the map's compiled lighting (`src/map-lighting.ts`): the eye's BSP leaf, an inverse-distance blend of that leaf's ambient cubes, the `emit_skylight` sun with a sky-visibility ray, the strongest visible `emit_point`/`emit_spotlight` with engine falloff `1 / (c + l·d + q·d²)`, other lights added to the cube, and the LDR light scale (2^1.2) that matches the lightmapped world. The concrete room uses a stand-in. Draw plays on spawn and reset, `idle1` loops, F inspects, and mouse 1 / mouse 2 play light and heavy swings; these are cosmetic and never touch movement.

## Rights

These are Valve's CS:GO assets. They keep their original owners' rights; this project assigns no license to them and claims no authorship. This project is not affiliated with Valve.
