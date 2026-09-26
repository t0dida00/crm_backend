---
paths:
  - "tests/**"
---

# Writing tests

Unit tests only: controllers in `tests/controllers/*.test.ts`, called directly with mock `req`/`res`; pure helpers from `src/lib` in `tests/lib/*.test.ts`. Database triggers aren't covered by these mocked tests; check them against a real database inside a rolled-back transaction. Conventions:
- Mock `src/config/prisma` with an **explicit factory** listing the delegates used (`orders: { findFirst: jest.fn(), ... }`). Automocking the module leaves `prisma.<model>` undefined because the client's model delegates aren't own properties.
- Controllers that touch business data also need `jest.mock('../../src/config/tenant-db', () => ({ tenantDb: async () => jest.requireMock('../../src/config/prisma').default }))`, a plain function so `resetAllMocks()` can't clear it.
- Use `jest.resetAllMocks()` in `beforeEach`, not `clearAllMocks`, so a `mockRejectedValue` in one test doesn't leak into the next.
- When mocking `lib/order-placement`, keep the real `OrderPlacementError` via `jest.requireActual` so `instanceof` checks work.
- For `res.status(204).send()` endpoints, the mock `status` must return an object with `send`.
