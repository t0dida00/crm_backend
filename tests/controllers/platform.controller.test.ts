jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    platform_users: { findUnique: jest.fn() },
    staff_directory: { findUnique: jest.fn() },
    platform_types: { findUnique: jest.fn() },
    platforms: { update: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  },
}));
jest.mock('../../src/realtime/socket', () => ({ emitToPlatform: jest.fn() }));
jest.mock('../../src/lib/platform-connections', () => ({
  getConnection: async () => ({ databaseUrl: null, pusher: null }),
  publicPusherConfig: async () => null,
  databaseName: async () => 'crm_platform_test',
}));
// The business's own database: a separate mocked client, or the shared one.
const ownDb = { platforms: { update: jest.fn(), findUnique: jest.fn() }, platform_users: { findUnique: jest.fn() } };
let useOwnDb = false;
jest.mock('../../src/config/tenant-db', () => ({
  tenantDb: async () => (useOwnDb ? ownDb : jest.requireMock('../../src/config/prisma').default),
}));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { createPlatform, getMyPlatform, updateMyPlatform } from '../../src/controllers/platform.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const db = prisma as unknown as {
  platform_users: { findUnique: jest.Mock };
  staff_directory: { findUnique: jest.Mock };
  platform_types: { findUnique: jest.Mock };
  platforms: { update: jest.Mock; findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
};
const EMPTY = { phone: null, email: null, address: null, logo_url: null };

const call = async (handler: typeof updateMyPlatform, body?: unknown) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await handler({ userId: 'u1', body } as AuthedRequest, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

beforeEach(() => {
  jest.resetAllMocks();
  useOwnDb = false;
  db.platform_users.findUnique.mockResolvedValue({ platform_id: 'p1', role: 'OWNER', is_active: true });
  db.platforms.update.mockImplementation(async ({ data }) => ({ id: 'p1', name: 'Casa', ...data }));
  db.platforms.findUnique.mockResolvedValue(EMPTY);
  ownDb.platforms.findUnique.mockResolvedValue(EMPTY);
});

describe('updateMyPlatform', () => {
  it('on the shared database, updates name, type and profile in one row', async () => {
    db.platform_types.findUnique.mockResolvedValue({ id: 'type-cafe' });

    const res = await call(updateMyPlatform, { name: ' Casa ', phone: ' +34 600 000 000 ', email: ' hi@casa.com ', address: 'Mar 1', platformTypeCode: 'cafe' });

    expect(db.platform_types.findUnique).toHaveBeenCalledWith({ where: { code: 'CAFE' } });
    expect(db.platforms.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'Casa', platform_type_id: 'type-cafe', phone: '+34 600 000 000', email: 'hi@casa.com', address: 'Mar 1' },
      include: { platform_types: true },
    });
    expect(res.status).toBe(200);
  });

  it("with its own database, keeps name/type central and writes the profile to the business's database", async () => {
    useOwnDb = true;
    db.platforms.findUnique.mockResolvedValue(EMPTY); // nothing left centrally to move

    await call(updateMyPlatform, { name: 'Casa', phone: '+34 600 000 000', address: 'Mar 1' });

    expect(db.platforms.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { name: 'Casa' }, include: { platform_types: true } });
    expect(ownDb.platforms.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'Casa', phone: '+34 600 000 000', address: 'Mar 1' },
    });
  });

  it.each([
    [{ phone: '' }, 'Phone must contain only digits, with an optional + at the start'],
    [{ phone: 'call me' }, 'Phone must contain only digits, with an optional + at the start'],
    [{ address: '  ' }, 'Address cannot be empty'],
  ])('rejects clearing or corrupting a mandatory field %p', async (body, error) => {
    expect(await call(updateMyPlatform, body)).toEqual({ status: 400, body: { error } });
    expect(db.platforms.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown type without updating', async () => {
    db.platform_types.findUnique.mockResolvedValue(null);
    expect(await call(updateMyPlatform, { platformTypeCode: 'BAR' })).toEqual({ status: 400, body: { error: 'Unknown platform type' } });
    expect(db.platforms.update).not.toHaveBeenCalled();
  });

  it('returns 404 without a platform', async () => {
    db.platform_users.findUnique.mockResolvedValue(null);
    db.staff_directory.findUnique.mockResolvedValue(null);
    expect((await call(updateMyPlatform, { name: 'Casa' })).status).toBe(404);
  });
});

describe('getMyPlatform', () => {
  it("finds a staff member stored in their business's own database, as STAFF of the directory's business", async () => {
    useOwnDb = true;
    db.platform_users.findUnique.mockResolvedValue(null);
    db.staff_directory.findUnique.mockResolvedValue({ user_id: 'u1', platform_id: 'p1' });
    // Even if the business's database claims another business and OWNER, neither is trusted.
    ownDb.platform_users.findUnique.mockResolvedValue({ user_id: 'u1', platform_id: 'other', role: 'OWNER', is_active: true });
    db.platforms.findUniqueOrThrow.mockResolvedValue({ id: 'p1', name: 'Casa', ...EMPTY, platform_types: { code: 'CAFE' } });
    ownDb.platforms.findUnique.mockResolvedValue({ phone: '+34 600', email: null, address: 'Mar 1', logo_url: null });

    const res = await call(getMyPlatform);

    expect(db.platforms.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'p1' }, include: { platform_types: true } });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('STAFF');
    expect(res.body.databaseName).toBe('crm_platform_test');
    expect(res.body.platform).toMatchObject({ id: 'p1', phone: '+34 600', address: 'Mar 1' });
  });
});

describe('createPlatform', () => {
  it.each([
    [{ name: 'Casa', platformTypeCode: 'CAFE', address: 'Mar 1' }, 'Phone must contain only digits, with an optional + at the start'],
    [{ name: 'Casa', platformTypeCode: 'CAFE', phone: 'abc', address: 'Mar 1' }, 'Phone must contain only digits, with an optional + at the start'],
    [{ name: 'Casa', platformTypeCode: 'CAFE', phone: '+34 600 000 000' }, 'Address is required'],
  ])('requires a valid phone and an address %#', async (body, error) => {
    expect(await call(createPlatform, body)).toEqual({ status: 400, body: { error } });
  });
});
