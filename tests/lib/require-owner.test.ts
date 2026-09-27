jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformMembership: jest.fn() }));

import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { resolvePlatformMembership } from '../../src/lib/platform-context';
import { requireOwner } from '../../src/middleware/require-owner';
import { requireAuth, AuthedRequest } from '../../src/middleware/auth.middleware';
import dishRoutes from '../../src/routes/dish.routes';
import categoryRoutes from '../../src/routes/category.routes';
import tableRoutes from '../../src/routes/table.routes';
import settingsRoutes from '../../src/routes/settings.routes';
import orderRoutes from '../../src/routes/order.routes';
import platformRoutes from '../../src/routes/platform.routes';

const run = async (mw: typeof requireOwner, req: Partial<AuthedRequest>) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const next = jest.fn();
  await mw(req as AuthedRequest, { status } as unknown as Response, next);
  return { status: status.mock.calls[0]?.[0], next };
};

describe('requireOwner', () => {
  beforeEach(() => jest.resetAllMocks());

  it('lets the owner through and stops staff and strangers', async () => {
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'OWNER' });
    expect((await run(requireOwner, { userId: 'u1' })).next).toHaveBeenCalled();
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'STAFF' });
    expect(await run(requireOwner, { userId: 'u1' })).toMatchObject({ status: 403 });
    (resolvePlatformMembership as jest.Mock).mockResolvedValue(null);
    expect(await run(requireOwner, { userId: 'u1' })).toMatchObject({ status: 404 });
  });
});

describe('requireAuth', () => {
  const secret = process.env.JWT_SECRET as string;
  const withToken = (t: string) => ({ headers: { authorization: `Bearer ${t}` } }) as Partial<AuthedRequest>;

  it('accepts sign-in tokens', async () => {
    const req = withToken(jwt.sign({ sub: 'u1', email: 'a@b.co', role: null }, secret));
    expect((await run(requireAuth as never, req)).next).toHaveBeenCalled();
    expect(req.userId).toBe('u1');
  });

  it('refuses a table QR token even though it shares the secret', async () => {
    const qr = jwt.sign({ type: 'table-qr', platformId: 'p1', tableId: 't1' }, secret);
    expect(await run(requireAuth as never, withToken(qr))).toMatchObject({ status: 401 });
  });
});

/** The owner-only routes: each must run requireOwner before its handler. */
const OWNER_ONLY: [string, { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } }[] }, string, string][] = [
  ['dishes', dishRoutes as never, 'post', '/dishes'],
  ['dishes', dishRoutes as never, 'delete', '/dishes/:id'],
  ['categories', categoryRoutes as never, 'post', '/categories'],
  ['categories', categoryRoutes as never, 'patch', '/categories/:id'],
  ['categories', categoryRoutes as never, 'delete', '/categories/:id'],
  ['tables', tableRoutes as never, 'get', '/tables/qr-tokens'],
  ['tables', tableRoutes as never, 'post', '/tables'],
  ['tables', tableRoutes as never, 'patch', '/tables/:id'],
  ['tables', tableRoutes as never, 'delete', '/tables/:id'],
  ['settings', settingsRoutes as never, 'patch', '/settings'],
  ['settings', settingsRoutes as never, 'post', '/settings/special-taxes'],
  ['settings', settingsRoutes as never, 'patch', '/settings/special-taxes/:id'],
  ['settings', settingsRoutes as never, 'delete', '/settings/special-taxes/:id'],
  ['orders', orderRoutes as never, 'get', '/orders/stats'],
  ['orders', orderRoutes as never, 'get', '/orders/stats/series'],
  ['platform', platformRoutes as never, 'patch', '/platforms/me'],
];
const STAFF_ALLOWED: [typeof dishRoutes, string, string][] = [
  [dishRoutes, 'patch', '/dishes/:id'],
  [orderRoutes, 'delete', '/orders/:id'],
  [tableRoutes, 'post', '/tables/:id/seat'],
];
const handlersOf = (router: unknown, method: string, path: string) =>
  (router as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } }[] }).stack
    .find((l) => l.route?.path === path && l.route.methods[method])
    ?.route?.stack.map((s) => s.handle);

describe('owner-only routes', () => {
  it.each(OWNER_ONLY)('%s: %s %s requires the owner', (_name, router, method, path) => {
    expect(handlersOf(router, method, path)).toContain(requireOwner);
  });
  it.each(STAFF_ALLOWED)('staff keep %#', (router, method, path) => {
    const handlers = handlersOf(router, method, path);
    expect(handlers).toBeDefined();
    expect(handlers).not.toContain(requireOwner);
  });
});
