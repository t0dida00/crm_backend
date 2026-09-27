# CRM Backend

Express + Prisma + PostgreSQL API for a restaurant/cafe ordering and
management platform. Serves the staff/admin app (`CRM` frontend) over an
authenticated REST API, and serves guests scanning a table's QR code over a
public, unauthenticated REST API — both backed by the same database and the
same order-placement logic.

Stack: **Express 4 · Prisma 5 · PostgreSQL · JWT (jsonwebtoken) · Pusher
Channels** (real-time), TypeScript throughout, run with `tsx`.

## Running locally

There are two ways to run the API: with Docker (easiest, Postgres included)
or directly with Node against a Postgres you provide.

Either way, the seed creates a login you can use right away:
**`admin@example.com` / `password123`**.

### Option A — Docker Compose

Requires Docker (Docker Desktop on macOS/Windows).

```bash
git clone https://github.com/t0dida00/crm_backend.git
cd crm_backend

docker compose up -d --build        # starts Postgres (port 5432) and the API (port 3000)
docker compose run --rm setup       # first run only: creates the tables and seeds data
docker compose run --rm setup sh -c "npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260926180000_dish_sold_count/migration.sql && echo 'CREATE UNIQUE INDEX IF NOT EXISTS \"one_open_session_per_table\" ON \"table_sessions\" (\"table_id\") WHERE \"closed_at\" IS NULL;' | npx prisma db execute --schema prisma/schema.prisma --stdin"
                                    # first run only: adds what db push skips (see below)

curl http://localhost:3000/health   # → {"status":"ok"}
```

Useful commands:

```bash
docker compose logs -f api          # follow API logs
docker compose down                 # stop (data is kept in the pgdata volume)
docker compose down -v              # stop and wipe the database
```

`JWT_SECRET` and the `PUSHER_*` variables can be overridden from your shell
or a `.env` file next to `docker-compose.yml`. Without Pusher credentials the
API still works; real-time events are simply not published.

To build and run just the API image against an existing database:

```bash
docker build -t crm-backend .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://USER:PASSWORD@host.docker.internal:5432/crm_platform?schema=public" \
  -e JWT_SECRET="change-me" \
  crm-backend
```

### Option B — Node directly

Requires **Node.js 20+** and a **PostgreSQL 14+** database.

```bash
git clone https://github.com/t0dida00/crm_backend.git
cd crm_backend

npm install                         # also runs `prisma generate` via postinstall
cp .env.local.example .env.local    # then fill in DATABASE_URL and JWT_SECRET (see Environment)
```

Don't have Postgres? Start one in Docker:

```bash
docker run -d --name crm-postgres -p 5432:5432 \
  -e POSTGRES_USER=crm -e POSTGRES_PASSWORD=crm -e POSTGRES_DB=crm_platform \
  postgres:16-alpine
# DATABASE_URL="postgresql://crm:crm@localhost:5432/crm_platform?schema=public"
```

Create the schema and seed data, then start the dev server:

```bash
npx dotenv -e .env.local -- prisma db push   # creates all tables from prisma/schema.prisma
# add the trigger and partial index that db push skips (see below)
npx dotenv -e .env.local -- prisma db execute --schema prisma/schema.prisma \
  --file prisma/migrations/20260926180000_dish_sold_count/migration.sql
echo 'CREATE UNIQUE INDEX IF NOT EXISTS "one_open_session_per_table" ON "table_sessions" ("table_id") WHERE "closed_at" IS NULL;' \
  | npx dotenv -e .env.local -- prisma db execute --schema prisma/schema.prisma --stdin
SEED_DEMO=1 npm run prisma:seed              # platform types (+ demo login admin@example.com / password123)
npm run dev                                  # tsx watch, reloads on change
```

Server listens on `PORT` (default `3000`); check it with
`curl http://localhost:3000/health`.

> **Fresh database? Use `prisma db push`, not `prisma migrate`.** The
> `prisma/migrations` folder only holds incremental changes on top of an
> existing schema (there is no initial migration), so `npm run
> prisma:migrate` fails against an empty database. Use it only on a database
> that already has the base tables.

> **`db push` skips triggers and partial indexes.** A fresh database needs the
> two extra commands above:
> - The `order_lines_sold_count` trigger keeps `menu_items.sold_count` current.
> - The `one_open_session_per_table` index keeps a table to one open dining
>   session; order placement relies on it when two orders arrive at once.
>
> Don't run the other migration files on a `db push` database. They alter
> tables `db push` has already created in their final form, so they fail.

### Applying a new migration

The existing databases (local and the one Vercel uses) were built with
`db push`, so they have no migration history and `prisma migrate deploy`
would try to replay every migration. Instead, apply a new migration's SQL to
each database directly:

```bash
npx dotenv -e .env.local -- prisma db execute --schema prisma/schema.prisma \
  --file prisma/migrations/<name>/migration.sql         # local
npx dotenv -e .env.development -- prisma db execute --schema prisma/schema.prisma \
  --file prisma/migrations/<name>/migration.sql         # the database Vercel uses
```

Write migration SQL so it can safely run twice (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`), and add the column to
`schema.prisma` too so the Prisma Client knows about it.

### Production build

```bash
npm run build     # compiles src/ to dist/
npm start         # node dist/server.js — reads env vars from the process environment
```

### Tests

```bash
npm test                # Jest + ts-jest, all tests
npm run test:watch      # re-run on change
npm run test:coverage   # writes a report to coverage/
```

The tests mock Prisma, bcrypt, JWT and Pusher, so they need no database or
env file.

## Environment

Two local env files, both gitignored — this project has no
`.env.development.local`-style auto-switching (that's a Next.js feature the
frontend uses; here it's opt-in via npm scripts, see below):

- **`.env.local`** — used by `npm run dev` and the plain `prisma:*` scripts.
  Point this at whatever Postgres you're developing against day-to-day
  (a local instance, or a shared dev database).
- **`.env.development`** — used by `npm run dev:development` and the
  `prisma:*:development` scripts. Useful for testing against a second
  database (e.g. the same one production/Vercel uses) without touching your
  main `.env.local`.

Both need:

| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DATABASE_URL` | Postgres connection string, read by Prisma |
| `JWT_SECRET` | Signs/verifies staff session tokens |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Real-time event publishing (see Real-time below). The shared app, used by businesses that haven't connected their own |
| `BLOB_READ_WRITE_TOKEN` | The shared Vercel Blob store for dish photos and logos, used by businesses that haven't connected their own storage. Without it, those businesses can't upload images |
| `CREDENTIALS_KEY` | Encrypts the database URLs, Pusher secrets and storage keys businesses connect. 64 hex chars (`openssl rand -hex 32`). **Every server using the same central database needs the same key** (Vercel and `.env.development` included), and changing it makes saved credentials unreadable. Without it, businesses can't connect their own services |
| `ALLOW_SHARED_INFRA` | `true` (default): a business without its own database/Pusher/storage uses the shared ones above. `false`: each business must connect all three before it can use the app |
| `REQUIRE_ACCOUNT_APPROVAL` | `true`: new owner accounts wait for review and can't sign in until approved (see Auth model). Unset or `false` (default): they sign in right away, and accounts still waiting are let in too |

`npm run prisma:seed` always seeds the platform types. It creates the demo
login `admin@example.com` / `password123` only when `SEED_DEMO=1` (Docker
Compose's `setup` sets it); otherwise owners sign up in the app.

**Vercel deployment** (`crm-backend` project) reads none of these files —
its env vars are set independently in the Vercel dashboard (Settings →
Environment Variables) and must be kept in sync with whichever `DATABASE_URL`
you want it hitting. A known gotcha: a newly-added Vercel env var sometimes
doesn't reach already-built functions even after a redeploy — if a var
that's clearly set still isn't showing up at runtime, remove it and re-add
it, then redeploy again.

`vercel env pull` / `vercel link` also add a `VERCEL_OIDC_TOKEN` line to
`.env.local`. Nothing in this app reads it and it expires within hours, so it's
safe to delete.

## Structure

```
src/
  app.ts                  Express app: cors, json body parsing, route mounting
  server.ts               app.listen() — the local/standalone entrypoint
  config/prisma.ts        shared PrismaClient instance
  middleware/
    auth.middleware.ts    requireAuth — verifies the Bearer JWT, sets req.userId
  lib/
    platform-context.ts   resolvePlatformId(userId) — every authed
                           controller starts here to scope its query
    order-placement.ts    placeOrderForTable() — shared by the staff and
                           public order-creation endpoints
    table-token.ts         signs/verifies the QR code token (platformId + tableId)
    best-sellers.ts        bestSellerIds() — the top 5 dishes by sold_count,
                           flagged on the guest menu
    crypto.ts              AES-256-GCM encrypt/decrypt with CREDENTIALS_KEY
    account-approval.ts    REQUIRE_ACCOUNT_APPROVAL: is a new owner account
                           still waiting for review?
    connection-input.ts    checks a business's database URL / Pusher credentials /
                           storage config
    storage.ts             uploads to Vercel Blob or S3-compatible storage,
                           verifies a storage connection
    tenant-provision.ts    sets up a business's own database, verifies Pusher
    platform-connections.ts  a business's decrypted connections (cached 30 s)
  config/tenant-db.ts      tenantDb(platformId) — the Prisma client for that
                           business's data (its own database, or the shared one)
  generated/tenant-init-sql.ts   full schema SQL for a business database
                           (npm run tenant:sql; never edit by hand)
  realtime/
    socket.ts              emitToPlatform(platformId, event, payload) — publishes
                           to Pusher; every write worth telling other sessions
                           about calls this after committing
  controllers/             one file per resource (auth, platform, table,
                           category, dish, order, booking, settings,
                           table-request, staff, connection, upload, public)
  routes/                  thin Router wiring per resource, mirrors controllers
prisma/
  schema.prisma            models below
  seed.ts                  platform_types (RESTAURANT/CAFE) + admin@example.com
```

## Data model (Prisma)

- **`User`** — login identity (email/password hash). One user per
  `platform_users` row (enforced unique).
- **`platforms`** — a restaurant/cafe workspace (name, address, phone,
  domain via `platform_type_id`).
- **`platform_types`** — fixed lookup: `RESTAURANT`, `CAFE`.
- **`platform_users`** — links a `User` to a `platforms` row with a `role`
  (`OWNER` or `STAFF`). One `OWNER` per platform (partial unique index).
- **`platform_preferences`** — currency + common tax rate for a platform.
- **`menu_categories`**, **`menu_items`** — the menu; a dish can carry its
  own special tax (`tax_mode: include|exclude`, `tax_name`, `tax_pct`).
  `menu_items.sold_count` is the units ordered across all existing orders. A
  trigger on `order_lines` keeps it current: placing an order, changing a line
  and deleting an order all update it. Never write it from code. The guest
  menu (`GET /public/platforms/:id/menu`) never returns it; instead it flags
  the top 5 sellers with `is_best_seller`.
- **`special_taxes`** — named extra taxes a dish can reference.
- **`tables`** — `state` (`Free|Booked|Seated|Finished`), `seated_at`.
- **`orders`**, **`order_lines`** — an order snapshots its `tax_rate` at
  creation time from `platform_preferences.common_tax_rate`, so a later
  Settings change never retroactively changes a past order's numbers.
  `closed_ts` set means the order is checked out / in history.
- **`bookings`** — reservations, optionally assigned to a table.
- **`table_requests`** — guest-initiated "call staff" / "checkout" pings
  from the `/client` app, `status: pending|resolved`.

## Each business's own database, Pusher and storage

The database in `DATABASE_URL` is the **central** database. Once a business
connects its own database, everything it can keep there lives there, and the
central database keeps only what's needed to sign in and find the business:

| Data | Business's own database | Central database |
|---|---|---|
| Menu, tables, sessions, orders, bookings, table requests, preferences, special taxes | ✓ | |
| Staff accounts (name, email, phone, password hash, active) | ✓ (`users`, `platform_users`) | `staff_directory`: email → business, so login knows where to look |
| Business profile (phone, email, address, logo) | ✓ (`platforms` row) | cleared |
| Business name, type, active flag | copy | ✓ (finds the business for guest QR links and login) |
| Owner account | | ✓, so the owner can always sign in, even if their database is down |
| Database / Pusher / storage credentials | | ✓ `platform_connections`, encrypted |

A business that hasn't connected one keeps all of this in the central database. Controllers get that business's client from
`tenantDb(platformId)`; central tables always use `prisma`.

The owner connects services in the app (onboarding step 1, before the
business exists, or Settings → Connections), through these OWNER-only routes:

| Route | Does |
|---|---|
| `GET /platforms/me/connections` | What's connected: database label (`host/db`), Pusher app id/key/cluster, storage provider and label (store id, or bucket and public host). Never the URL, secret or keys |
| `PUT /platforms/me/connections` `{ databaseUrl, pusher: { appId, key, secret, cluster }, storage }` | Connects all three together. `storage` is `{ provider: "vercel_blob", token }` or `{ provider: "s3", endpoint, region, bucket, accessKeyId, secretAccessKey, publicUrl }`. Checks Pusher with its API, then storage (uploads a test file, reads it back from its public URL, deletes it), then checks the URL, connects and creates every table in an **empty** database (or accepts one this business set up before). Only when all pass are they saved, encrypted, in one write |
| `POST /platforms/me/connections/test` | Re-checks all three |
| `POST /platforms/me/connections/check` (same body as PUT) | Runs every PUT check (Pusher, storage's test file, database connects and is empty, or already this business's) but saves and sets up nothing. Also open to a signed-in owner with **no business yet**: onboarding asks for connections before the business details. `GET /platforms/me/connections` answers such a user too (nothing connected, plus the server's options) |

Images are uploaded with `POST /platforms/me/uploads` (any member; raw PNG,
JPEG, WEBP or GIF body up to 5 MB, file name in `X-Filename`), which answers
`{ url }`. It uses the business's own storage, else the shared
`BLOB_READ_WRITE_TOKEN` store (409 when `ALLOW_SHARED_INFRA=false`).

- In production a database URL must use SSL (`sslmode=require`) and must not
  resolve to a private or loopback address, so the API can't be pointed at
  machines on the host's own network. Locally, `localhost` is allowed.
- Setting up a database runs `src/generated/tenant-init-sql.ts` with the `pg`
  driver, because Vercel functions can't run the Prisma CLI. After changing
  `schema.prisma` or `prisma/tenant-extras.sql`, run `npm run tenant:sql`; a
  test fails if it's out of date. Existing business databases don't upgrade
  themselves yet: `tenant_meta.schema_version` records which version each has.
- Connecting a different database later doesn't move any data. Switching
  storage doesn't move images either: saved URLs keep pointing at the old one.
- Storage endpoints and public URLs follow the same production rules as
  database URLs (https, public hosts). The public-read check doesn't follow
  redirects. S3 uses path-style URLs, which every S3-compatible service accepts.
- Staff accounts a business had on the shared database stop working when it
  connects its own (they're not copied). The owner recreates them; the same
  email can be reused and replaces the old account.
- Nothing read from a business's own database can choose the business or the
  role: a staff login's business comes from `staff_directory`, and accounts
  found there are always STAFF. (The owner controls that database.)
- Each serverless instance caches a business's connection for 30 s, so other
  instances switch over within that time.
- Browsers get the business's Pusher key and cluster from `GET /platforms/me`
  and `GET /public/platforms/:id/settings` (`pusher`, null = the shared app).

## Auth model

Two trust levels, both hitting the same controllers/data where relevant:

1. **Staff/admin** (`requireAuth` middleware): owners create an account with
   `POST /auth/register` (`fullName`, `email`, `password` of 8+ characters),
   then `POST /platforms` makes them the new business's OWNER. `POST /auth/login` with
   email+password returns a JWT (`sub` = user id).
   With `REQUIRE_ACCOUNT_APPROVAL=true`, register answers `pendingApproval: true`
   and no token, and records the account in the central `account_approvals`
   table (`status: "pending"`). Login then answers 403 `ACCOUNT_PENDING_APPROVAL`
   (after the password check) until you approve it by setting `status` to
   `"approved"`, e.g. in `npm run prisma:studio`. Accounts without a row
   (everyone from before, and all staff) are approved. The table is separate
   from `users` because business databases also have a `users` table and don't
   upgrade themselves. Every other non-public
   route requires `Authorization: Bearer <token>`; `resolvePlatformId(userId)`
   then scopes all reads/writes to that user's one platform.
2. **Guest/public** (`/platforms/:platformId/...` routes in
   `public.controller.ts`, mounted under `/public`): no auth at all — a
   guest reaches these by scanning a table's QR code, which resolves to a
   `platformId`+`tableId` via a signed token (`GET /tokens/:token`,
   `table-token.ts`). Guests can view the menu/tables/settings, place
   orders, view their own table's still-open orders, and raise a table
   request — nothing more.

Order placement (`placeOrderForTable`) is shared code between the staff
endpoint (`POST /orders`) and the guest endpoint
(`POST /platforms/:platformId/orders`) — both create a **new** order each
call (no merging into a prior open order) and auto-seat the table if it
isn't already `Seated`.

## Real-time (Pusher)

`emitToPlatform(platformId, event, payload)` in `src/realtime/socket.ts`
publishes to a **public** Pusher channel named `platform-{platformId}` — no
per-client auth, matching the fact that a guest with just a `platformId`
can already read the same order/table-request data over the public REST
endpoints.

Events currently published:

| Event | Emitted from |
|---|---|
| `order:created` | `order-placement.ts` (both staff and guest order creation) |
| `order:updated` | status change, line added, line qty changed |
| `order:deleted` | order deleted |
| `table:updated` | seat / free |
| `table:checked_out` | checkout (bulk-closes orders; listeners should refetch rather than expect a per-order payload) |
| `table_request:created` | guest raises a call-staff/checkout request |
| `table_request:resolved` | staff resolves a request |

This intentionally does **not** use Socket.IO — a persistent
connection needs a long-running server process, which Vercel's serverless
functions don't provide. Pusher's REST-based `trigger()` call works from
any stateless invocation, which is why it replaced an earlier Socket.IO
implementation that silently never worked once this backend moved to
Vercel.

## Deployment

Deployed to Vercel (`crm-backend` project) as a serverless Node app — the
same `app.ts` Express app handles requests, just without `server.ts`'s
`app.listen()` (Vercel wraps the export itself). Because of that:

- No persistent WebSocket connections — real-time goes through Pusher, not
  a socket server.
- `DATABASE_URL` should point at a Postgres reachable from Vercel's network
  (e.g. Prisma Postgres / `db.prisma.io`, Neon, Supabase) — a `localhost`
  connection string will hang every DB-touching request until timeout.
- `postinstall: prisma generate` exists specifically because Vercel caches
  `node_modules` between builds, which otherwise skips Prisma's normal
  generation step and leaves a stale/mismatched Prisma Client.
