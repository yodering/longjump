# Leaderboard and multiplayer

Updated 9 October 2026. Accounts are shelved: the username/password prototype lives on the `accounts-prototype` branch. Players pick a name instead. Next: deploy the leaderboard, then build shared practice rooms. Keep instant solo play available at every stage.

## What exists

Attempts, personal bests and backups live in the browser (IndexedDB, with version-2 backup files). That stays as it is.

A public leaderboard is implemented and tested locally; it is not deployed yet. See the [server README](../../server/README.md).

- **Names.** A browser claims a name (3–16 letters, numbers or underscores) and receives a private key, stored in localStorage. Only its hash is kept on the server. Names are unique after lowercasing and folding look-alikes (`0/o`, `1/i/l`, `5/s`, underscores and so on). Reserved and offensive names are refused. Clearing site data loses the key, and the name stays reserved.
- **One board.** One leaderboard across maps. Each row shows the name, distance, tick rate and map; a filter narrows it to 64 or 128 tick. Each name keeps one best per tick rate. Auto-hop jumps never post.
- **Verification.** The game records the movement state on the takeoff tick and every command until the result. The server reruns those with the same `physics.ts`, the map's collision boxes, manual jumping, matching physics and map versions, and a grounded takeoff at rest height. The distance it computes is the one stored. Edited results, impossible takeoffs and truncated or padded replays fail. A perfectly scripted input sequence still passes; that needs full-session simulation (section 3).
- **Moderation.** `bun run leaderboard:admin` lists entries, deletes them, renames players and bans names. Banned names disappear from the board and can't post.
- **Hosting.** Cloudflare serves the game, about 21 MB per first visit, from its free CDN. A minimal Worker forwards `/api/*` to one Bun service on Railway, which stores the board in SQLite on a volume. Replay checks run on Railway, not in the Worker, which has a 10 ms CPU limit on the free plan. Railway Hobby includes $5 of monthly usage. Measure actual memory and traffic after launch.

Done when the leaderboard is deployed, real jumps from both maps and tick rates post, moderation works against production, and the volume has backups.

## 2. Shared practice rooms

**Status, October 2026:** the first version is built: invite links, 8-player rooms on a shared map, server-assigned names, capsule stand-ins with name labels, 20 Hz pose relay with interpolation, and jump announcements in the in-game feed. See the [server README](../../server/README.md#rooms). Third-person CS:GO player models (ST6 and Phoenix with their knives, baked locomotion, crouch and jump clips) replaced the capsules; see [player models](../players/README.md). Latency tests at 30/80/150 ms RTT remain open.

The first multiplayer release should let friends practice on the same map and see one another. Invite links, a small room list, leaderboard names and jump announcements are enough. Joining asks for a name when the browser has none, using the same claim as the leaderboard. Start with at most eight players, no player collisions, and no chat or voice. Public discovery and moderation can follow private rooms.

Keep local movement at the selected 64/128 tick rate. Send remote pose updates at a proposed 20 Hz and interpolate other players between received snapshots. Test 20 versus 30 Hz before choosing the final rate. Share map-content version, physics version and movement mode on join; reject mismatches instead of letting players compare incompatible results.

### Third-person player models

Import full player bodies so room occupants can see one another. The current knife-and-arms GLBs are first-person viewmodels and cannot represent a remote player. Start with one CT and one T body, using the existing knife/team preference to choose between them. Defer agent selection, skins and an avatar picker.

Audit the existing [MDL/VVD/VTX/ANI conversion pipeline](../viewmodels/README.md) against full player files. Check included animation models, skinning, body groups, pose parameters and blended sequences; the knife importer is not proof that full-body animation works. Convert supported bodies to skinned GLB assets and retain source paths, conversion steps, hashes and original asset credits. Reuse compatible third-person knife geometry separately from the local viewmodel. If the stock bodies cannot be converted cleanly, use a clearly credited permissively licensed placeholder while completing the importer.

First load and animate one local test actor in the actual map before adding networking. Check Source-to-Three axes, scale, feet at the collision origin, standing/crouched hull alignment and lighting. Idle, walk/run, crouch movement, jump, fall and landing must read correctly. Disable root motion; physics owns the actor's position. Blend locomotion from speed and crouch amount, turn the body from yaw, and add pitch to the upper body where the rig permits it.

Room snapshots carry position, yaw, pitch, velocity, grounded state, crouch amount, model ID and a reset/teleport marker. Derive locomotion locally from that state rather than streaming bone transforms. Interpolate remote motion, but snap resets and map changes so actors do not slide across the map. Give each actor its own skeleton and animation mixer while sharing geometry and textures. Attach its name above the body with distance limits. Hide the local third-person body in the first-person camera, keep the existing knife viewmodel, and keep remote bodies out of movement collision.

Done when eight actors animate independently, crouched feet stay on the floor, jumps and resets show correctly, names match server identity, and repeated joins/leaves release per-player resources. Measure download size, draw calls and frame times with all eight visible. Lazy-load room assets so solo practice does not pay the model download or animation cost.

Run rooms as WebSockets in the Railway Bun service that already hosts the leaderboard. It can check a player's name key directly. Pose fan-out is a few hundred bytes per player per update. One always-on process keeps the cost predictable, unlike per-message billing. Cloudflare Durable Objects were considered, but per-message charges and active duration would apply while players move. Keep room state in memory and persist only metadata needed after a restart. Do not write every pose to SQLite. Reconnect from current client state after a server restart. Connect clients directly to a room subdomain; proxy WebSockets through the Worker only if measurements justify it.

The server assigns player identity and checks invitation/session tickets, message schema, sequence order, size, send rate and room capacity. Ignore client-supplied player IDs and discard stale updates. Drop old pose updates when a socket falls behind; never build an unbounded send queue. Reconnect with backoff and expire abandoned rooms. Ghost positions and jump announcements remain client-reported. Only replay-verified submissions reach the leaderboard.

Done when eight clients can join, leave, reconnect and change maps safely; pose traffic remains bounded; and solo practice stays responsive with 30/80/150 ms RTT, jitter and a stalled connection. Measure room CPU, bandwidth and usage charges before production. 

## 3. Verified competition, if wanted

Replay checks already confirm that a posted distance follows from its commands. Full verification would also simulate the run-up and every command on the server, so scripted inputs and edited pre-jump states have nowhere to hide.

Use sequenced commands, bounded input buffering, fixed simulation ticks, server snapshots, client prediction and replay of unacknowledged commands after a correction. Tag results with map/rules versions and preserve old categories through physics changes. Separate practice teleports/resets from eligible jumps.

A continuously simulated 128-tick room needs benchmarks; the Railway Bun service is the candidate host. [Bun has server WebSockets](https://bun.sh/docs/runtime/http/websockets), and [Railway public networking supports WebSockets](https://docs.railway.com/networking/public-networking/specs-and-limits). Measure tick deadlines, correction size and bandwidth at full room capacity under latency and packet-loss tests. WebSockets use TCP, so delayed delivery can stall later commands; compare another transport only if measurements justify its extra complexity. Establish native game parity with the [movement capture plan](../movement/README.md#next-fidelity-work) before claiming CS:GO-equivalent competitive scores.
