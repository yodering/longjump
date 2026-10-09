# Account-service prototype

Local prototype for username/password accounts and private attempt/PB storage. The public game uses the root static-assets Wrangler config. This separate config lives under `worker/` so the current dashboard deployment does not publish the account API accidentally.

## Run locally

```sh
bun install --frozen-lockfile
bun run build
bun run accounts:setup
bun run accounts:dev
```

In a second terminal:

```sh
bun run dev -- --port 5178
```

Vite proxies `/api/*` to the Worker on port 8787. Setup generates an ignored `worker/.dev.vars` with a random local auth secret and the allowed origin `http://127.0.0.1:5178`. Keep that origin consistent with the frontend URL. The local database and credentials stay in ignored Wrangler state.

There is no account UI yet. This is an API prototype. The next milestone adds the UI, a durable upload queue and separate account caches before enabling public signup. See [the plan](../research/roadmap/accounts-multiplayer.md).

## API

All writes need an exact matching Origin and JSON content type. Authenticated requests use HTTP-only session cookies. Responses use `Cache-Control: no-store` and omit internal email addresses and credential hashes.

| Route | Request / response |
| --- | --- |
| `GET /api/account` | Current public user or `null` |
| `POST /api/account/signup` | `username`, `password`; returns user and one-time recovery key |
| `POST /api/account/login` | `username`, `password`; establishes session |
| `POST /api/account/logout` | Revokes current session |
| `POST /api/account/recover` | `username`, `password`, `recoveryKey`; changes password, revokes all sessions, returns replacement key |
| `GET /api/sync?after=0` | Up to 50 account-owned attempts, server cursor, `more`, bests |
| `POST /api/sync` | Up to 50 attempts and 24 standalone bests; returns acknowledged IDs |

Usernames use 3–20 ASCII letters, digits or underscores. Login ignores capitalization; display preserves it. Reserved service names are unavailable. Passwords need 15–128 characters. Better Auth owns password hashing and session management. Its required internal email is a server-generated address under `accounts.invalid`; raw `/api/auth/*` endpoints are inaccessible.

Recovery keys have 256 bits of randomness. Store only their SHA-256 hash. A successful recovery atomically replaces the credential and key and revokes every session. Never log or send keys, usernames, passwords or account IDs to analytics.

The server derives save ownership from the session. Attempt IDs are unique per account and retries are idempotent. A different payload with an existing ID rejects the entire batch. PBs use the current map/tick/auto-hop categories and compete regardless of LJ bind. These are private, client-reported practice results, not verified competitive scores.

Credential bodies are limited to 4 KiB; sync bodies to 256 KiB. Accounts have a provisional 100,000-attempt / 128 MiB payload quota enforced by transactional database triggers. A quota failure keeps the whole batch unsaved. Clients must retain local attempts until acknowledgment. Shared D1 counters limit signup, login, recovery and sync. Counters contain salted address hashes and expire. Production bot controls and CPU/storage cost measurements remain part of the release checks.

## Deployment prerequisites

The database ID in `wrangler.jsonc` is a local placeholder. Do not deploy it as-is. Before enabling public accounts:

1. Finish the client UI, durable retry queue, account-separated caches and deletion/export controls described in the plan.
2. Authenticate the Cloudflare CLI with `bunx wrangler login`.
3. Create the production D1 database and replace the placeholder binding ID.
4. Apply all migrations to the remote database with the explicit worker config.
5. Set `AUTH_SECRET` through Wrangler's secret storage. Do not commit it or reuse the local secret.
6. Confirm the custom domain, exact `AUTH_ORIGIN`, static-assets binding and GitHub build variables. Update the deployment command to use this config deliberately.
7. Test production cookies, origins, recovery, account ownership and failure/retry behavior before exposing signup.

Cloudflare's same-origin static assets and API Worker allow the game to stay on its current domain. No Railway service is required for this prototype.

## Verification

```sh
bun test tests/accounts.test.ts tests/backup.test.ts
bun run build
```

Tests use a D1-compatible SQLite fixture for migrations, auth, recovery, ownership, deduplication, atomic conflicts and quotas. Signup, case-insensitive login, recovery, session revocation, logout and repeated D1 uploads also passed against Wrangler's local Worker runtime. This does not measure production CPU limits or establish a monthly cost.
