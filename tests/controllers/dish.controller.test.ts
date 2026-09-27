jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    menu_categories: { findFirst: jest.fn() },
    menu_items: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../../src/config/tenant-db', () => ({
  tenantDb: async () => jest.requireMock('../../src/config/prisma').default,
}));
jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformId: async () => 'p1' }));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { createDish, updateDish } from '../../src/controllers/dish.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const db = prisma as unknown as {
  menu_categories: { findFirst: jest.Mock };
  menu_items: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
};
const call = async (handler: typeof createDish, body: unknown) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await handler({ userId: 'u1', body, params: { id: 'd1' } } as unknown as AuthedRequest, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

beforeEach(() => {
  jest.resetAllMocks();
  db.menu_categories.findFirst.mockResolvedValue({ id: 'c1' });
  db.menu_items.findFirst.mockResolvedValue({ id: 'd1' });
  db.menu_items.create.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
});

describe('dish validation', () => {
  it.each([
    [{ name: 'Latte', price: 3 }, 'category is required'],
    [{ name: 'Latte', price: -1, categoryId: 'c1' }, 'price must be a non-negative number'],
    [{ name: 'Latte', price: 3, categoryId: 'c1', taxPct: -5 }, 'taxPct must be between 0 and 200'],
    [{ name: 'Latte', price: 3, categoryId: 'c1', taxPct: 201 }, 'taxPct must be between 0 and 200'],
  ])('rejects %p on create', async (body, error) => {
    expect(await call(createDish, body)).toEqual({ status: 400, body: { error } });
    expect(db.menu_items.create).not.toHaveBeenCalled();
  });

  it("rejects another business's category", async () => {
    db.menu_categories.findFirst.mockResolvedValue(null);
    expect(await call(createDish, { name: 'Latte', price: 3, categoryId: 'other' })).toEqual({
      status: 400,
      body: { error: 'Unknown category' },
    });
  });

  it('creates a dish with name, price and category', async () => {
    const res = await call(createDish, { name: 'Latte', price: 3, categoryId: 'c1' });
    expect(res.status).toBe(201);
    expect(db.menu_items.create.mock.calls[0][0].data.category_id).toBe('c1');
  });

  it('does not let an update remove the category or go negative', async () => {
    expect((await call(updateDish, { categoryId: null })).body).toEqual({ error: 'category is required' });
    expect((await call(updateDish, { price: -2 })).status).toBe(400);
    expect(db.menu_items.update).not.toHaveBeenCalled();
  });
});
