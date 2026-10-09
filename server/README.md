# Leaderboard server

One Bun process on Railway with SQLite on a persistent volume. Rooms will join it later. Cloudflare keeps serving the game. The Worker in [`worker/proxy.ts`](../worker/proxy.ts) forwards `/api/*` here, so the game calls a single origin.

```text
browser ──> longjump.ing (Cloudflare) ──static──> dist/
                    └── /api/* proxy ──> Railway Bun service ──> SQLite volume
```

## How a jump gets on the board

1. The Leaderboard tab claims a name. The server returns a random 256-bit key, which the browser keeps in localStorage; only its SHA-256 hash is stored.
2. The game records the movement state before each takeoff tick and every command through the result ([`src/replay.ts`](../src/replay.ts)).
3. After a valid jump with auto-hop off that beats the name's posted best, the browser posts the replay.
4. The server checks the physics version and map-content version, replays the jump with the same `physics.ts` and the map's collision boxes, and stores the distance it computed. The result must be valid, start grounded at rest height, begin on the takeoff tick and end on the final command.

Each name keeps one best per tick rate. The board is the top 100 across maps, optionally filtered by tick rate. Replays are stored for later review.

## Run locally

```sh
bun run server:dev
```

In a second terminal:

```sh
bun run dev -- --port 5178
```

Vite proxies `/api/*` to port 8787 (or `LONGJUMP_API`). `ALLOW_DIRECT=1` lets the server run without the Cloudflare proxy secret. The database goes in ignored `.data/` unless `DATABASE_PATH` says otherwise.

## API

| Route | Request / response |
| --- | --- |
| `GET /api/leaderboard?tick=64\|128` | Top 100: rank, name, distance, tick rate, map, takeoff stats, date |
| `POST /api/players` | `name`; returns player and key. 5 claims per address per hour |
| `GET /api/players/me` | Bearer key; name, banned flag and posted bests |
| `POST /api/players/me` | Bearer key, `name`; renames |
| `POST /api/jumps` | Bearer key, `replay`; returns verified distance, rank and whether it improved |
| `/api/admin/*` | `ADMIN_TOKEN` bearer: list entries, delete entries, rename and ban players |

Names use 3–16 letters, numbers or underscores. Uniqueness ignores case, underscores and look-alikes, so `Y0der_ing` collides with `yodering`. Reserved and offensive names are refused. Banned names vanish from the board and cannot post.

## Moderation

```sh
ADMIN_TOKEN=… bun run leaderboard:admin list [name]
```

The same script takes `delete <entry id>`, `ban <player id>`, `unban <player id>` and `rename <player id> <name>`. Set `LONGJUMP_API` to target another host.

## Deployment

[`railway.json`](../railway.json) builds with Railpack and type-checks the server. It starts `bun server/main.ts` and checks `/healthz`. It runs one replica because SQLite lives on one volume. Migrations apply at startup.

| Railway variable | Value |
| --- | --- |
| `PROXY_SECRET` | 32+ random characters, shared only with the Cloudflare Worker |
| `ADMIN_TOKEN` | 32+ random characters for moderation |
| `DATABASE_PATH` | A file on the volume, e.g. `/data/longjump.sqlite` |

Attach a volume at `/data`. On the `longjump` Cloudflare Worker, set the secrets `API_URL` (the Railway public URL) and the same `PROXY_SECRET`. Without them, `/api/*` returns a plain 503 and the tab shows the leaderboard as unavailable. Railway's domain answers 404 to requests without the proxy secret, so rate limits always see the real client address.

Physics or map changes alter the version hashes. Clients and the server must deploy together. Until both update, posts get a "reload" message.

## Verification

```sh
bun test tests/replay.test.ts tests/leaderboard.test.ts
bun run build
```
