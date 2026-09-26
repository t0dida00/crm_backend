# Routing, input rules, real-time and errors

- **Routing:** `src/app.ts` mounts every router at `/`, except `public.routes.ts` at `/public`. Routes are thin; authed routes add `requireAuth` per route, which verifies the Bearer JWT and sets `req.userId` (`AuthedRequest`).
- **Public/guest API:** `public.controller.ts` takes `platformId` from the URL with no auth. `table-token.ts` signs non-expiring QR tokens with `JWT_SECRET` and a `type: "table-qr"` claim so they can't be used as login tokens.
- **Input rules:** `src/lib/validation.ts` (the frontend's `lib/validation.ts` mirrors it).
  - `isValidPhone`, `isValidEmail`, `isFullName`.
  - `isCount`: whole number from 1. `isNonNegative`: prices and percentages.
  - `MAX_COMMON_TAX` = 100, `MAX_SPECIAL_TAX` = 200.
  - Updates reject an invalid value instead of silently ignoring it. Mandatory fields (phone, address, dish category) can be changed but not cleared.
  - `middleware/limit-text.ts` rejects any request string over 250 characters, except text-area and URL fields (`description`, `note`, `databaseUrl`, `url`, `imageUrl`, `logoUrl`).
  - A new business's email is the owner's signup email.
- **Real-time:** `emitToPlatform` uses the business's own Pusher app if it connected one, else the `PUSHER_*` env app; it never throws. After a committed write that other sessions should see, call and **await** `emitToPlatform(platformId, event, payload)` (`realtime/socket.ts`, Pusher REST) before responding. Vercel can freeze the function once the response is sent, so a fire-and-forget call may never run. If `PUSHER_*` env vars are missing it is a no-op. Don't reintroduce Socket.IO (no persistent connections on Vercel).
- **Error handling:** controllers validate input inline and return `{ error }` JSON; unexpected errors (Prisma, Pusher) are not caught and propagate. The tests assert this with `rejects.toThrow`. In the running app, `express-async-errors` (imported in `app.ts`) routes them to the error handler there, which answers 500 (or 409 for `TenantNotConnectedError`).
- **Env loading:** `JWT_SECRET` is read at module load in `auth.controller.ts`, `auth.middleware.ts` and `table-token.ts`. Env must be set before these modules are imported, which is why the Jest config uses `setupFiles` (`tests/setup.ts`).
