// Business data goes through tenantDb(); in tests it's the same mocked client.
jest.mock('../../src/config/tenant-db', () => ({
  tenantDb: async () => jest.requireMock('../../src/config/prisma').default,
}));
jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    platforms: { findUnique: jest.fn() },
    menu_categories: { findMany: jest.fn() },
    menu_items: { findMany: jest.fn() },
  },
}));
jest.mock('../../src/realtime/socket', () => ({ emitToPlatform: jest.fn() }));

import { Request, Response } from 'express';
import prisma from '../../src/config/prisma';
import { getPublicMenu } from '../../src/controllers/public.controller';

const mockPrisma = prisma as unknown as {
  platforms: { findUnique: jest.Mock };
  menu_categories: { findMany: jest.Mock };
  menu_items: { findMany: jest.Mock };
};

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('getPublicMenu', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.platforms.findUnique.mockResolvedValue({ id: 'p1', is_active: true });
    mockPrisma.menu_categories.findMany.mockResolvedValue([{ id: 'c1' }]);
  });

  it('flags the top 5 sellers and hides sold_count from guests', async () => {
    const counts = [0, 12, 3, 8, 5, 20, 1];
    mockPrisma.menu_items.findMany.mockResolvedValue(
      counts.map((sold_count, i) => ({ id: `d${i}`, name: `Dish ${i}`, category_id: 'c1', sold_count })),
    );
    const res = mockRes();

    await getPublicMenu({ params: { platformId: 'p1' } } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { dishes } = (res.json as jest.Mock).mock.calls[0][0];
    expect(dishes.filter((d: { is_best_seller: boolean }) => d.is_best_seller).map((d: { id: string }) => d.id))
      .toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(dishes.every((d: object) => !('sold_count' in d))).toBe(true);
  });

  it('returns 404 for an inactive platform', async () => {
    mockPrisma.platforms.findUnique.mockResolvedValue({ id: 'p1', is_active: false });
    const res = mockRes();
    await getPublicMenu({ params: { platformId: 'p1' } } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
