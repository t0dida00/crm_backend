# CRM Backend

Express + Prisma + PostgreSQL API for a restaurant/cafe ordering and
management platform. Serves the staff/admin app (`CRM` frontend) over an
authenticated REST API, and serves guests scanning a table's QR code over a
public, unauthenticated REST API — both backed by the same database and the
same order-placement logic.

Stack: **Express 4 · Prisma 5 · PostgreSQL · JWT (jsonwebtoken) · Pusher
Channels** (real-time), TypeScript throughout, run with `tsx`.

## Install

```bash
npm install         # also runs `prisma generate` via postinstall
cp .env.local.example .env.local
# fill in DATABASE_URL, JWT_SECRET, PUSHER_* — see Environment below
npm run prisma:migrate   # or: npx dotenv -e .env.local -- prisma db push
npm run prisma:seed      # creates platform_types (RESTAURANT/CAFE) + admin@example.com / password123
npm run dev
```

Server listens on `PORT` (default `3000`).

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
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Real-time event publishing (see Real-time below) |

**Vercel deployment** (`crm-backend` project) reads none of these files —
its env vars are set independently in the Vercel dashboard (Settings →
Environment Variables) and must be kept in sync with whichever `DATABASE_URL`
you want it hitting. A known gotcha: a newly-added Vercel env var sometimes
doesn't reach already-built functions even after a redeploy — if a var
that's clearly set still isn't showing up at runtime, remove it and re-add
it, then redeploy again.

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
  realtime/
    socket.ts              emitToPlatform(platformId, event, payload) — publishes
                           to Pusher; every write worth telling other sessions
                           about calls this after committing
  controllers/             one file per resource (auth, platform, table,
                           category, dish, order, booking, settings,
                           table-request, public)
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
- **`special_taxes`** — named extra taxes a dish can reference.
- **`tables`** — `state` (`Free|Booked|Seated|Finished`), `seated_at`.
- **`orders`**, **`order_lines`** — an order snapshots its `tax_rate` at
  creation time from `platform_preferences.common_tax_rate`, so a later
  Settings change never retroactively changes a past order's numbers.
  `closed_ts` set means the order is checked out / in history.
- **`bookings`** — reservations, optionally assigned to a table.
- **`table_requests`** — guest-initiated "call staff" / "checkout" pings
  from the `/client` app, `status: pending|resolved`.

## Auth model

Two trust levels, both hitting the same controllers/data where relevant:

1. **Staff/admin** (`requireAuth` middleware): `POST /auth/login` with
   email+password returns a JWT (`sub` = user id). Every other non-public
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
