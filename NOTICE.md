# Notice

The [MIT License](LICENSE) covers this project's own source code, scripts, tests and documentation. It does not cover the third-party assets listed below. They keep their original owners' rights, this project claims no authorship of them, and the MIT License grants no rights in them.

This project is a free, non-commercial fan project. It is not affiliated with, endorsed by or sponsored by Valve Corporation. Counter-Strike, CS:GO and related names and marks belong to Valve.

## Third-party assets

| Path | Contents | Owner / license | Provenance |
| --- | --- | --- | --- |
| `public/maps/longjump_source_go`, `kz_longjumps_go`, `kz_baxter` | Converted Workshop map geometry, textures and lighting, plus stock CS:GO materials | The map authors credited in the README, and Valve; no license granted | [research/maps](research/maps/README.md) |
| `public/players` | CT and T player models and animations | Valve; no license granted | [research/players](research/players/README.md) |
| `public/viewmodels` | Default knife and arm viewmodels | Valve; no license granted | [research/viewmodels](research/viewmodels/README.md) |
| `public/audio/gokz` | KZ announcer clips from GOKZ | KZGlobalTeam/GOKZ, published under GPL-3.0 ([license](public/audio/GOKZ-LICENSE.txt)) | [research/audio](research/audio/README.md) |
| `public/audio/source` | Checkpoint and error sounds | Valve; no license granted | [research/audio](research/audio/README.md) |
| `public/fonts` | Inter | Rasmus Andersson, SIL Open Font License 1.1 ([license](public/fonts/Inter-LICENSE.txt)) | — |

Movement behaviour in `src/physics.ts` reimplements CS:GO's documented movement rules and constants; references are listed in [research/movement](research/movement/README.md).

## Rights holders

If you own any of the assets above and want them removed, please open an issue at https://github.com/yodering/longjump/issues or email david.yoder@live.com. We will take the material down promptly; no formal notice is needed.
