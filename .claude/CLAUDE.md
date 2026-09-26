# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Express 4 + Prisma 5 + PostgreSQL REST API (TypeScript, run with `tsx`) for a restaurant/cafe ordering platform. It serves two clients from one database: the authenticated staff/admin app (the Next.js `CRM` repo, a sibling directory, dev server on port 3001 pointing at `localhost:3000`) and unauthenticated guests who reach a table via its QR code. `README.md` is the full project brief (data model, auth model, Pusher events, deployment); read it before larger changes.

## Commands

```bash
npm run dev                  # tsx watch src/server.ts with .env.local (port 3000)
npm run dev:development      # same, with .env.development (second DB, e.g. the one Vercel uses)
npm run build && npm start   # tsc → dist/, node dist/server.js
npm test                     # Jest (ts-jest), all suites
npx jest tests/controllers/order.controller.intensive.test.ts   # one file
npx jest -t "should close order"                                # tests matching a name
npm run test:coverage

npx dotenv -e .env.local -- prisma db push   # create/sync schema on a database
SEED_DEMO=1 npm run prisma:seed   # platform types (+ demo login admin@example.com / password123 only with SEED_DEMO=1)
npm run tenant:sql           # regenerate src/generated/tenant-init-sql.ts after schema changes
npm run prisma:studio

docker compose up -d --build && docker compose run --rm setup   # Postgres + API, then schema push + seed
```

`npm run lint` is defined but ESLint is not installed and has no config, so it fails. Type-check with `npm run build`.

## Database gotchas

- `prisma/migrations` has **no initial migration**, only incremental changes on top of an existing schema. `prisma migrate dev` fails on an empty database, so use `prisma db push` for fresh databases.
- `db push` does **not** create partial indexes that exist only in migration SQL. `one_open_session_per_table` (in `20260910211023_table_sessions`) guarantees one open `table_sessions` row per table, and `order-placement.ts` relies on it to resolve concurrent-order races. A `db push`-only database lacks it. The README also mentions a "one OWNER per platform" partial unique index that is not in the schema or migrations.
- Neither the local nor the Vercel database (`db.prisma.io`, `.env.development`) has a `_prisma_migrations` table: both were built with `db push`, so `prisma migrate deploy` would replay every migration and fail. Apply a new migration to each database with `npx dotenv -e <env file> -- prisma db execute --file prisma/migrations/<name>/migration.sql --schema prisma/schema.prisma`, and write its SQL to be re-runnable (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`).
- `db push` doesn't create triggers either. `menu_items.sold_count` is maintained by the `order_lines_sold_count` trigger (migration `20260926180000_dish_sold_count`); a database created with `db push` needs that file run on it.
- After editing `schema.prisma`, run `prisma generate` (also runs on `postinstall`).

## Architecture

- **Routing:** `src/app.ts` mounts every router at `/`, except `public.routes.ts` at `/public`. Routes are thin; authed routes add `requireAuth` per route, which verifies the Bearer JWT and sets `req.userId` (`AuthedRequest`).
- **Central vs business database:** `DATABASE_URL` is the central database: `users`, `platform_users`, `platforms`, `platform_types`, `platform_connections`. Every other table is a business's operational data and must be queried through `const db = await tenantDb(platformId)` (`src/config/tenant-db.ts`), right after resolving `platformId`. That returns the business's own database when it connected one, else the shared client. Never use the default `prisma` for business tables, and never use `db` for central ones. `$transaction` / `$queryRaw` on business data also go through `db`. With `ALLOW_SHARED_INFRA=false`, `tenantDb` throws `TenantNotConnectedError`, which `app.ts` answers with 409 `DATABASE_NOT_CONNECTED`.
- **Where accounts and the profile live:** `lib/accounts.ts` routes them. Owners stay central. Staff of a business with its own database live in that database's `users` / `platform_users`, with a central `staff_directory` row (email → business). `findMembership()` / `findAccountByEmail()` (used by `resolvePlatformId`, login, `/platforms/me`) check central first, then the directory. The business and role never come from the business's database: the directory gives the business and such accounts are always STAFF. Email uniqueness spans central `users` and the directory (`checkEmailAvailable`). The profile (phone, email, address, logo) is read and written through `lib/business-profile.ts` (`readProfile`), which uses the business database's `platforms` row when connected; the central row keeps name, type and the active flag.
- **Business connections:** owners connect their own Postgres and Pusher together with one `PUT /platforms/me/connections` (`connection.controller.ts`, OWNER only). It checks Pusher, then sets up the database, and saves both in one write only if both pass; keep it all-or-nothing. Secrets are AES-256-GCM encrypted with `CREDENTIALS_KEY` (`lib/crypto.ts`) and never returned; responses show only the database label and Pusher app id/key/cluster. Database URLs are checked by `lib/connection-input.ts`: in production SSL is required and private or loopback hosts are refused. A business database is created from `src/generated/tenant-init-sql.ts`, the Prisma schema from empty plus `prisma/tenant-extras.sql` (trigger, partial index, `tenant_meta`). Regenerate it with `npm run tenant:sql` whenever `schema.prisma` or the extras change; `tests/lib/tenant-sql.test.ts` fails if it's stale. Connections are cached per instance for 30 s (`lib/platform-connections.ts`).
- **Tenant scoping:** there is no per-request platform param for staff. Every authed controller starts with `resolvePlatformId(req.userId)` (returns 404 "No platform found for this user" if the user has none or their `platform_users` row is inactive), then filters **every** query by `platform_id`, including lookups by id (`findFirst({ where: { id, platform_id } })` before `update`/`delete`). Endpoints that need OWNER (staff management) use `resolvePlatformMembership` instead. Both re-read the DB rather than trusting the JWT's `role` claim.
- **Public/guest API:** `public.controller.ts` takes `platformId` from the URL with no auth. `table-token.ts` signs non-expiring QR tokens with `JWT_SECRET` and a `type: "table-qr"` claim so they can't be used as login tokens.
- **Order placement** lives in `lib/order-placement.ts` (`placeOrderForTable`), shared by staff `POST /orders` and guest `POST /public/platforms/:id/orders`. It always creates a new order (never merges), seats the table, attaches the order to the table's open `table_sessions` row (creating one if needed), accepts only dishes with `status: "valid"` in an active (or no) category, snapshots `platform_preferences.common_tax_rate` onto the order, and generates `ORD-<n>` codes from the max existing code with a retry on unique conflict (P2002). It throws `OrderPlacementError(status, message)`, which controllers map to HTTP responses.
- **Order lifecycle:** `closed_ts` set means the order is closed/in history. Setting status to exactly `"Paid"` closes an order. `checkoutTable` closes all of a table's open orders and its open session in one transaction and sets the table to `Finished`.
- **Order history at scale:** `GET /orders` (loaded into the frontend's workspace state) returns every open order but only the 500 most recently closed. Anything over full history must use the SQL-paginated `GET /orders/history` (sessions keyed by `COALESCE(session_id, id)`, or by `id` for open orders; `page`, `pageSize` ≤ 100, `q`, `status=closed|all`, `from` = checked out since, epoch ms; staff history passes the start of yesterday) or the aggregated `GET /orders/stats?from=&to=` (epoch ms), and `GET /orders/stats/series?bucket=hour|day|month|year&from=&to=&tz=` for chart buckets in the viewer's time zone. The local dev database has ~1M generated history orders for load testing.
- **Dish sales count:** `menu_items.sold_count` is the units ordered across all existing orders, kept current by a database trigger on `order_lines` (insert, qty/item change, delete including order cascades). Never write it from application code. A sale counts when the order is placed; deleting the order takes it back.
- **Best sellers:** `lib/best-sellers.ts` (`bestSellerIds`) picks the top 5 by `sold_count` among dishes guests can see, ties by name, never a dish with 0 sales. `GET /public/platforms/:id/menu` strips `sold_count` and adds `is_best_seller`; guests never get the raw count. The frontend's `lib/best-sellers.ts` mirrors this rule for the staff menu, so change both together.
- **Real-time:** `emitToPlatform` uses the business's own Pusher app if it connected one, else the `PUSHER_*` env app; it never throws. After a committed write that other sessions should see, call and **await** `emitToPlatform(platformId, event, payload)` (`realtime/socket.ts`, Pusher REST) before responding. Vercel can freeze the function once the response is sent, so a fire-and-forget call may never run. If `PUSHER_*` env vars are missing it is a no-op. Don't reintroduce Socket.IO (no persistent connections on Vercel).
- **Error handling:** controllers validate input inline and return `{ error }` JSON; unexpected errors (Prisma, Pusher) are not caught and propagate. The tests assert this with `rejects.toThrow`. In the running app, `express-async-errors` (imported in `app.ts`) routes them to the error handler there, which answers 500 (or 409 for `TenantNotConnectedError`).
- **Env loading:** `JWT_SECRET` is read at module load in `auth.controller.ts`, `auth.middleware.ts` and `table-token.ts`. Env must be set before these modules are imported, which is why the Jest config uses `setupFiles` (`tests/setup.ts`).

## Tests

**Every new feature, endpoint or utility ships with tests in the same change**, and a behavior change to existing code updates the tests that cover it. Run `npm test` before committing.

Unit tests only: controllers in `tests/controllers/*.test.ts`, called directly with mock `req`/`res`; pure helpers from `src/lib` in `tests/lib/*.test.ts`. Database triggers aren't covered by these mocked tests; check them against a real database inside a rolled-back transaction. Conventions:
- Mock `src/config/prisma` with an **explicit factory** listing the delegates used (`orders: { findFirst: jest.fn(), ... }`). Automocking the module leaves `prisma.<model>` undefined because the client's model delegates aren't own properties.
- Controllers that touch business data also need `jest.mock('../../src/config/tenant-db', () => ({ tenantDb: async () => jest.requireMock('../../src/config/prisma').default }))`, a plain function so `resetAllMocks()` can't clear it.
- Use `jest.resetAllMocks()` in `beforeEach`, not `clearAllMocks`, so a `mockRejectedValue` in one test doesn't leak into the next.
- When mocking `lib/order-placement`, keep the real `OrderPlacementError` via `jest.requireActual` so `instanceof` checks work.
- For `res.status(204).send()` endpoints, the mock `status` must return an object with `send`.

## Deployment

Deployed on Vercel (`crm-backend` project, production URL `https://crm-backend-rosy-ten.vercel.app`) as a serverless function wrapping `app.ts`; `server.ts` is only for local/Docker. Vercel env vars are set in its dashboard and are independent of the local `.env*` files.
