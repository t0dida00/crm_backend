# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Express 4 + Prisma 5 + PostgreSQL REST API (TypeScript, run with `tsx`) for a restaurant/cafe ordering platform. It serves two clients from a central database (plus each business's own database once it connects one; see `.claude/rules/tenancy.md`): the authenticated staff/admin app (the Next.js `CRM` repo, a sibling directory, dev server on port 3001 pointing at `localhost:3000`) and unauthenticated guests who reach a table via its QR code. `README.md` is the full project brief (data model, auth model, Pusher events, deployment); read it before larger changes.

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

## Tests

**Every new feature, endpoint or utility ships with tests in the same change**, and a behavior change to existing code updates the tests that cover it. Run `npm test` before committing. Test-writing conventions: `.claude/rules/testing.md` (loaded when working in `tests/`).

## Rules

Detailed guidance lives in `.claude/rules/` and is loaded automatically:

| File | Covers |
|---|---|
| `database.md` | No initial migration, `db push` gaps (triggers, partial indexes), applying migrations with `prisma db execute` |
| `tenancy.md` | Central vs business database (`tenantDb`), where accounts and the profile live, business connections, tenant scoping |
| `orders.md` | Order placement, lifecycle, history at scale, dish sales count, best sellers |
| `api.md` | Routing, guest API, input validation rules, real-time (Pusher), error handling, env loading |
| `deployment.md` | Vercel deployment |
| `testing.md` | Jest mocking conventions (loaded when working in `tests/`) |
