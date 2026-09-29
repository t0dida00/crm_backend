jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    menu_categories: { findMany: jest.fn(), create: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../../src/config/tenant-db', () => ({
  tenantDb: async () => jest.requireMock('../../src/config/prisma').default,
}));
jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformId: async () => 'p1' }));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { CATEGORY_ORDER, createCategory, listCategories, reorderCategories } from '../../src/controllers/category.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const db = prisma as unknown as {
  menu_categories: { findMany: jest.Mock; create: jest.Mock; aggregate: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const call = async (handler: typeof listCategories, body?: unknown) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await handler({ userId: 'u1', body, params: {} } as unknown as AuthedRequest, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

beforeEach(() => {
  jest.resetAllMocks();
  db.menu_categories.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  db.menu_categories.update.mockImplementation((args) => args);
  db.$transaction.mockResolvedValue([]);
});

describe('category order', () => {
  it('lists categories in the owner\'s order, then by name', async () => {
    await call(listCategories);
    expect(db.menu_categories.findMany).toHaveBeenCalledWith({ where: { platform_id: 'p1' }, orderBy: CATEGORY_ORDER });
    expect(CATEGORY_ORDER).toEqual([{ sort_order: 'asc' }, { name: 'asc' }]);
  });

  it('adds a new category at the end', async () => {
    db.menu_categories.aggregate.mockResolvedValue({ _max: { sort_order: 4 } });
    db.menu_categories.create.mockImplementation(async ({ data }) => ({ id: 'n', ...data }));
    const res = await call(createCategory, { name: 'Desserts' });
    expect(res.status).toBe(201);
    expect(res.body.category.sort_order).toBe(5);
  });

  it('puts the first category at 0 when there are none yet', async () => {
    db.menu_categories.aggregate.mockResolvedValue({ _max: { sort_order: null } });
    db.menu_categories.create.mockImplementation(async ({ data }) => ({ id: 'n', ...data }));
    expect((await call(createCategory, { name: 'Mains' })).body.category.sort_order).toBe(0);
  });

  it('saves a full new order as positions from 0', async () => {
    const res = await call(reorderCategories, { ids: ['c', 'a', 'b'] });
    expect(res.status).toBe(200);
    expect(db.$transaction.mock.calls[0][0]).toEqual([
      { where: { id: 'c' }, data: { sort_order: 0 } },
      { where: { id: 'a' }, data: { sort_order: 1 } },
      { where: { id: 'b' }, data: { sort_order: 2 } },
    ]);
  });

  it.each([
    ['a missing category', ['a', 'b']],
    ['a repeated category', ['a', 'b', 'b']],
    ["another business's category", ['a', 'b', 'x']],
    ['something other than ids', 'a,b,c'],
  ])('refuses an order with %s', async (_label, ids) => {
    const res = await call(reorderCategories, { ids });
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
