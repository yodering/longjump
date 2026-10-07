# Classic KZ sound research

Researched 6 October 2026. The browser uses real archived clips, not oscillator effects or text-to-speech.

## Primary behavior references

Pinned GOKZ revision: `c56aa84f0581167bc5a2998e9f631382f67141be`.

- [Jumpstat sound config](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/cfg/sourcemod/gokz/gokz-jumpstats-sounds.cfg): maps the five distance tiers to the bundled MP3s.
- [Distance tier config](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/cfg/sourcemod/gokz/gokz-jumpstats-tiers.cfg): the vanilla longjump profile uses Impressive 235, Perfect 240, Godlike 245, Ownage 248 and Wrecker 250. SimpleKZ/KZTimer use substantially higher thresholds and must not be substituted for vanilla.
- [Jump reporting](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/gokz-jumpstats/jump_reporting.sp): reports one sound for the resulting tier. Fail reporting does not call the tier-sound function.
- [Core definitions](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/include/gokz/core.inc): checkpoint and teleport use `buttons/blip1.wav`. Vanilla timer start/end use `common/wpn_select.wav`, a different event.
- [Error handling](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/gokz-core/misc.sp): rejected actions use `buttons/button10.wav`.

GOKZ's repository specifies 128-tick servers. We use its verified vanilla distance profile on both browser tick rates; a separate historical 64-tick profile has not been verified. Sound choice and thresholds were server configurable. The archive also contains holyshit and wickedsick clips, but these are not in the default five-tier vanilla config, so they are not arbitrarily inserted into our profile. The older 1.6 [Unique Jumpstats](https://github.com/MichaelKheel/UQJumpstats) lists a different collection of announcer calls. We do not claim one universal pack for all KZ servers or infer voice actors from filenames.

## Exact assets

[provenance.json](provenance.json) records each downloaded URL, byte count and SHA-256. The five unmodified MP3s come from GOKZ's `sound/gokz` directory. The two unmodified WAVs come from the [Source Sounds CS:GO archive](https://github.com/sourcesounds/csgo), pinned at `08f1bd6835d4f510d2ccaedeab6bb9f637b388ab`; the archive is an asset mirror, while GOKZ's source identifies the relevant event filenames.

GOKZ's published repository license is preserved in [GOKZ-LICENSE.txt](GOKZ-LICENSE.txt). Original sound recordings and Valve game assets retain their original owners' rights; this project does not assign a new license or claim original authorship of the recordings.

## Browser behavior

- Only valid, landed long jumps reach the announcer. Choose the highest threshold met; never stack all lower-tier voices.
- No synthetic beep on takeoff, low-distance jumps or misses.
- X saves, C returns, and R resets use the checkpoint/teleport sample. Invalid checkpoint commands use the error sample.
- Imported floor landings do not teleport the player, so there is no misleading reset beep on every miss.
- A user gesture unlocks Web Audio. Files decode once and play through a shared volume control. A new callout stops the previous callout to avoid overlapping announcer voices.
- Settings provides independent sample buttons for verification; explicit preview still works when gameplay sound is muted.

Tests cover threshold boundaries, non-finite scores, silent invalid/missed jumps, asset presence, fixed-map entrances and staying on walkable pit floors. Browser verification checks real MP3/WAV decoding and playback. Movement and jumpstats remain a prototype and are not certified GOKZ scores.
