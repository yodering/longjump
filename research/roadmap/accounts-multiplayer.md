# Accounts, portable saves and multiplayer

Draft, updated 9 October 2026. Recommended order: complete file backups, add optional account sync, then build shared practice rooms. Keep instant solo play available at every stage.

## What exists

Attempts live in IndexedDB. The History menu pages and filters them and exports version-1 JSON containing attempts and personal bests. Preferences have a separate JSON export/import. History has no import yet, checkpoints last only for the current session, and clearing browser storage can erase progress. There is no account service or multiplayer server.

Current best categories are map, tick rate and auto-hop setting; LJ bind usage is metadata. Preserve that behavior. Older attempts whose auto-hop setting was never recorded retain their unknown category.

## 1. Complete portable saves

Add **Import backup** and **Export backup** to History using the existing menu controls. A version-2 backup contains attempts, standalone bests, preferences, a persistent device identifier, and map-specific saved positions. Include the physics version and map-content version for new attempts. Mark older records' versions as unknown; do not assign them today's rules.

Every new attempt needs a globally unique ID. Existing `legacy-0` style IDs only identify records within one browser, so migrate them once to a persisted device namespace. For old files without global IDs, retain a file fingerprint and row identity so importing the same file twice is idempotent. Equal distance and timestamp alone cannot identify an attempt.

Preview attempt counts, new/duplicate records and settings before import. Merge attempts and bests by default; applying preferences or checkpoints is a separate choice. Keep a backup of the previous preferences. Validate versions, enums, finite numbers, string lengths and array sizes before any write. Reject oversized files with an explanation and use a single transaction for each committed import batch. Define and test actual size limits using a large archive fixture.

A checkpoint includes position, angles, map ID and map-content version. Restore it only if that version matches and the current hull has safe standing support. Otherwise use the map entrance. Transfer display resolution/fullscreen preferences only by explicit choice because devices differ.

Done when a second browser can restore the archive, bests and chosen preferences, importing twice adds no duplicates, and malformed or interrupted imports leave existing data intact. Test backups with at least 10,000 attempts, including legitimate identical-looking attempts and records from both legacy categories. Request persistent browser storage where supported, while keeping file backups available.

## 2. Optional accounts and cloud saves

Use **Sign in to sync** in History. Continue playing while signed out or offline. On first sign-in, offer to merge this browser's progress into the account. Never discard guest records or block a physics tick on a network request. When changing accounts, keep each account's local cache separate and require an explicit choice before copying guest data into another account.

### Signup and identity

Use username and password for the first release. The username is also the public name shown in rooms. Signup has those two fields and a Create account button; login uses the same fields. Allow password-manager autofill, paste and a show-password control. No email, separate display-name field or social-login requirement. Guest solo play remains available.

Require a unique case-insensitive username, initially 3–20 ASCII letters, digits or underscores. Preserve chosen capitalization for display and enforce uniqueness on the normalized value in the database, including simultaneous signups. Reserve service names such as admin and system. Keep a permanent opaque account ID behind the name. A future rename changes the login/display name, not save ownership or room identity. Escape names when rendering them; room clients cannot choose a different name for a signed-in account.

Recommend a recovery key after creation, with Copy and Download actions. Generate it on the server using cryptographic randomness, store only a hash, and never include it in logs or analytics. A username plus that key can reset the password, revoke existing sessions and replace the key. It is a full account credential, so show that purpose clearly. Without the password or recovery key, recovery is unavailable; there is no email reset. Key regeneration while signed in requires reauthentication. Saving the key need not block entry into practice.

Use an established library for password hashing and sessions. Better Auth was the initial candidate and documents [Cloudflare D1 through a Kysely dialect](https://better-auth.com/docs/adapters/other-relational-databases), but its documented [username signup](https://better-auth.com/docs/plugins/username) still requires an email field. Do not treat that plugin as email-free signup out of the box. The implementation spike must prove the username-only flow, recovery, cookie sessions and D1 migrations together before selecting it. If an internal non-deliverable address is necessary for the library schema, generate it from the opaque account ID on the server and disable email login, email recovery and email-based account linking. Never ask the player to supply a fake email or expose an alternate signup route that bypasses the username rules. Prefer a library with native email-free accounts if that avoids extensive adapter work.

Recommended initial service: a Cloudflare Worker for `/api/*` and D1 for account-owned saves, alongside the existing static game. Workers support [serving static assets with an API Worker](https://developers.cloudflare.com/workers/static-assets/binding/), and [D1](https://developers.cloudflare.com/d1/) supplies the SQL store. Add an explicit deployment config and tested database migrations; the repository currently relies on dashboard deployment configuration. Keep Bun for development, installation and tests. The Worker runs in Cloudflare's runtime.

Suggested records:

| Record | Ownership and identity |
| --- | --- |
| Auth users, linked providers, sessions | Auth library's schema |
| Player profile | Permanent account ID; unique normalized username and displayed capitalization |
| Recovery credential | Account ID; hashed recovery key and rotation metadata |
| Attempts | Unique `(account ID, attempt ID)`; full bounded result payload, map/rules versions, server receipt sequence |
| Standalone legacy bests | Account ID + category + version; retain bests missing from history |
| Preferences and checkpoints | Account ID + record key + revision |
| Devices and sync cursors | Account ID + device ID; opaque server cursor |

Save locally first. A durable IndexedDB outbox uploads bounded batches after a landing or while in the menu. The server derives ownership from the session, validates every payload and acknowledges IDs. Duplicate uploads are harmless. Download changes using a server sequence, not the device clock. Derive new bests from accepted attempts; keep unknown-version legacy bests visibly comparable only within their existing category.

Preference conflicts use revisions: reject stale writes and offer the local/cloud choice in the menu. Display/device settings stay local unless explicitly transferred. Account logout retains the offline archive. Account deletion must remove cloud records and revoke sessions; provide an export before that action and let the player choose whether to clear local records too.

Use secure HTTP-only session cookies and request-origin/CSRF protection. Rate-limit password attempts and account creation using shared server-side counters; never store plaintext passwords or recovery keys. Use a bot challenge when abuse requires it rather than adding one to every signup. Enforce payload and per-account storage limits, login/upload rate limits and account ownership on reads and writes. Return actionable quota errors without dropping local attempts. Keep names, passwords, recovery keys and account IDs out of Umami events. Attempts remain private by default; joining a room shares the username with its occupants.

Done when username/password signup and login work without email, duplicate names cannot race through signup, recovery keys are single-use after reset, and logout/recovery revoke the intended sessions. Also require that two devices merge offline attempts without duplicates, retries and expired sessions lose no records, one account cannot read another's data, and paused/failed sync does not change movement or cause landing stalls. Measure full attempt storage and sync bandwidth with the 10,000-attempt fixture before choosing quotas or committing to a monthly operating cost.

## 3. Shared practice rooms

The first multiplayer release should let friends practice on the same map and see one another. Invite links, a small room list, player names and jump announcements are enough. Start with at most eight players, no player collisions, and no chat or voice. Public discovery and moderation can follow private rooms.

Keep local movement at the selected 64/128 tick rate. Send remote pose updates at a proposed 20 Hz and interpolate other players between received snapshots. Test 20 versus 30 Hz before choosing the final rate. Share map-content version, physics version and movement mode on join; reject mismatches instead of letting players compare incompatible results.

### Third-person player models

Import full player bodies so room occupants can see one another. The current knife-and-arms GLBs are first-person viewmodels and cannot represent a remote player. Start with one CT and one T body, using the existing knife/team preference to choose between them. Defer agent selection, skins and an avatar picker.

Audit the existing [MDL/VVD/VTX/ANI conversion pipeline](../viewmodels/README.md) against full player files. Check included animation models, skinning, body groups, pose parameters and blended sequences; the knife importer is not proof that full-body animation works. Convert supported bodies to skinned GLB assets and retain source paths, conversion steps, hashes and original asset credits. Reuse compatible third-person knife geometry separately from the local viewmodel. If the stock bodies cannot be converted cleanly, use a clearly credited permissively licensed placeholder while completing the importer.

First load and animate one local test actor in the actual map before adding networking. Check Source-to-Three axes, scale, feet at the collision origin, standing/crouched hull alignment and lighting. Idle, walk/run, crouch movement, jump, fall and landing must read correctly. Disable root motion; physics owns the actor's position. Blend locomotion from speed and crouch amount, turn the body from yaw, and add pitch to the upper body where the rig permits it.

Room snapshots carry position, yaw, pitch, velocity, grounded state, crouch amount, model ID and a reset/teleport marker. Derive locomotion locally from that state rather than streaming bone transforms. Interpolate remote motion, but snap resets and map changes so actors do not slide across the map. Give each actor its own skeleton and animation mixer while sharing geometry and textures. Attach its username above the body with distance limits. Hide the local third-person body in the first-person camera, keep the existing knife viewmodel, and keep remote bodies out of movement collision.

Done when eight actors animate independently, crouched feet stay on the floor, jumps and resets show correctly, names match server identity, and repeated joins/leaves release per-player resources. Measure download size, draw calls and frame times with all eight visible. Lazy-load room assets so solo practice does not pay the model download or animation cost.

Prototype one Cloudflare Durable Object per room. Its [WebSocket hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) retains connections while an idle object sleeps. Active movement messages still consume resources. Do not write every pose to D1 or promise hibernation savings while players are moving. Persist only room metadata needed for reconnects; reconnect from current client state after a server restart.

The server assigns player identity and checks invitation/session tickets, message schema, sequence order, size, send rate and room capacity. Ignore supplied account IDs and discard stale updates. Drop old pose updates when a socket falls behind; never build an unbounded send queue. Reconnect with backoff and expire abandoned rooms. Ghost positions and jump announcements remain client-reported; they do not establish verified records.

Done when eight clients can join, leave, reconnect and change maps safely; pose traffic remains bounded; and solo practice stays responsive with 30/80/150 ms RTT, jitter and a stalled connection. Measure room CPU, bandwidth and usage charges before production. Guest invitations can follow once anonymous access has explicit abuse limits.

## 4. Verified competition, if wanted

Competitive rankings require a server to compute movement and jump results from input commands. Browser-submitted distances are editable, and importing a backup cannot make an attempt verified. Keep private PBs and social announcements available without pretending they are anti-cheat scores.

Extract a browser-independent shared controller and collision pack. Use sequenced commands, bounded input buffering, fixed simulation ticks, server snapshots, client prediction and replay of unacknowledged commands after a correction. Tag results with map/rules versions and preserve old categories through physics changes. Separate practice teleports/resets from eligible jumps.

A continuously simulated 128-tick room needs benchmarks before choosing its host. A Bun service on Railway is the proposed candidate at this stage: [Bun has server WebSockets](https://bun.sh/docs/runtime/http/websockets), and [Railway public networking supports WebSockets](https://docs.railway.com/networking/public-networking/specs-and-limits). Cloudflare can keep serving the game and account API. Issue short-lived room tickets so the room server does not need direct access to auth session secrets.

Measure tick deadlines, correction size and bandwidth at full room capacity under latency and packet-loss tests. WebSockets use TCP, so delayed delivery can stall later commands; compare another transport only if measurements justify its extra complexity. Establish native game parity with the [movement capture plan](../movement/README.md#next-fidelity-work) before claiming CS:GO-equivalent competitive scores. Store replay evidence for verified attempts and define leaderboard eligibility independently of personal backups.

## First implementation milestone

Build backup import/export first. It solves transfer and recovery without an account service and gives cloud sync a tested merge format. Follow with optional account sync. Shared ghost rooms then add a useful multiplayer experience while server-authoritative competition remains a separate project.
