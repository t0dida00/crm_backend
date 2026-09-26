jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    platform_users: { findUnique: jest.fn() },
    platform_types: { findUnique: jest.fn() },
    platforms: { update: jest.fn() },
  },
}));
jest.mock('../../src/realtime/socket', () => ({ emitToPlatform: jest.fn() }));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { updateMyPlatform } from '../../src/controllers/platform.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const db = prisma as unknown as {
  platform_users: { findUnique: jest.Mock };
  platform_types: { findUnique: jest.Mock };
  platforms: { update: jest.Mock };
};

const call = async (body: unknown) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await updateMyPlatform({ userId: 'u1', body } as AuthedRequest, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

describe('updateMyPlatform', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    db.platform_users.findUnique.mockResolvedValue({ platform_id: 'p1', is_active: true });
    db.platforms.update.mockImplementation(async ({ data }) => ({ id: 'p1', ...data }));
  });

  it('updates the setup fields, including email and restaurant/cafe type', async () => {
    db.platform_types.findUnique.mockResolvedValue({ id: 'type-cafe' });

    const res = await call({ name: ' Casa ', phone: '', email: ' hi@casa.com ', address: 'Mar 1', platformTypeCode: 'cafe' });

    expect(db.platform_types.findUnique).toHaveBeenCalledWith({ where: { code: 'CAFE' } });
    expect(db.platforms.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'Casa', phone: null, email: 'hi@casa.com', address: 'Mar 1', platform_type_id: 'type-cafe' },
      include: { platform_types: true },
    });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown type without updating', async () => {
    db.platform_types.findUnique.mockResolvedValue(null);
    expect(await call({ platformTypeCode: 'BAR' })).toEqual({ status: 400, body: { error: 'Unknown platform type' } });
    expect(db.platforms.update).not.toHaveBeenCalled();
  });

  it('leaves the type alone when none is sent', async () => {
    await call({ name: 'Casa' });
    expect(db.platform_types.findUnique).not.toHaveBeenCalled();
    expect(db.platforms.update.mock.calls[0][0].data).toEqual({ name: 'Casa' });
  });

  it('returns 404 without a platform', async () => {
    db.platform_users.findUnique.mockResolvedValue(null);
    expect((await call({ name: 'Casa' })).status).toBe(404);
  });
});
