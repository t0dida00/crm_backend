jest.mock('../../src/config/prisma', () => {
  const client = {
    user: { findFirst: jest.fn(), delete: jest.fn(), create: jest.fn(), update: jest.fn() },
    platform_users: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    staff_directory: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
  return { __esModule: true, default: client };
});
jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformMembership: jest.fn() }));
let ownDatabase = false;
jest.mock('../../src/lib/platform-connections', () => ({
  getConnection: async () => ({ databaseUrl: ownDatabase ? 'postgresql://own/db' : null, pusher: null }),
}));
const ownDb = {
  user: { create: jest.fn(), update: jest.fn() },
  platform_users: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../../src/config/tenant-db', () => ({
  tenantDb: async () => (ownDatabase ? ownDb : jest.requireMock('../../src/config/prisma').default),
}));
jest.mock('bcrypt', () => ({ hash: async () => 'hashed' }));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { resolvePlatformMembership } from '../../src/lib/platform-context';
import { createStaff, listStaff } from '../../src/controllers/staff.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const central = prisma as unknown as Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
const BODY = { email: ' Ana@Casa.com ', password: 'longenough', fullName: 'Ana' };
const record = (userId: string) => ({ id: 'pu1', role: 'STAFF', is_active: true, created_at: new Date(0), users: { id: userId, email: 'ana@casa.com', phone: null, full_name: 'Ana', is_active: true } });

const call = async (handler: typeof createStaff, body?: unknown) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await handler({ userId: 'owner', body, params: {} } as unknown as AuthedRequest, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

/** Runs a $transaction callback against the given client. */
const runTx = (client: { user: { create: jest.Mock }; platform_users: { create: jest.Mock } }) =>
  async (fn: (tx: unknown) => unknown) => fn(client);

beforeEach(() => {
  jest.resetAllMocks();
  ownDatabase = false;
  (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'OWNER' });
  central.staff_directory.findUnique.mockResolvedValue(null);
  central.user.findFirst.mockResolvedValue(null);
});

describe('staff accounts', () => {
  it('on the shared database, creates them centrally with no directory entry', async () => {
    central.platform_users.count.mockResolvedValue(0);
    central.$transaction.mockImplementation(runTx(central as never));
    central.user.create.mockImplementation(async ({ data }) => ({ id: data.id }));
    central.platform_users.create.mockImplementation(async ({ data }) => record(data.user_id));

    const res = await call(createStaff, BODY);

    expect(res.status).toBe(201);
    expect(central.user.create).toHaveBeenCalled();
    expect(central.staff_directory.create).not.toHaveBeenCalled();
  });

  it("with its own database, stores the account there and only a directory entry centrally", async () => {
    ownDatabase = true;
    ownDb.platform_users.count.mockResolvedValue(0);
    ownDb.$transaction.mockImplementation(runTx(ownDb));
    ownDb.user.create.mockImplementation(async ({ data }) => ({ id: data.id }));
    ownDb.platform_users.create.mockImplementation(async ({ data }) => record(data.user_id));

    const res = await call(createStaff, BODY);

    expect(res.status).toBe(201);
    const created = ownDb.user.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ email: 'ana@casa.com', password_hash: 'hashed', full_name: 'Ana' });
    expect(central.staff_directory.create).toHaveBeenCalledWith({
      data: { email: 'ana@casa.com', user_id: created.id, platform_id: 'p1' },
    });
    expect(central.user.create).not.toHaveBeenCalled();
  });

  it('replaces the account left on the shared database with the same email', async () => {
    ownDatabase = true;
    central.user.findFirst.mockResolvedValue({ id: 'old', platform_users: { platform_id: 'p1', role: 'STAFF' } });
    ownDb.platform_users.count.mockResolvedValue(0);
    ownDb.$transaction.mockImplementation(runTx(ownDb));
    ownDb.user.create.mockImplementation(async ({ data }) => ({ id: data.id }));
    ownDb.platform_users.create.mockImplementation(async ({ data }) => record(data.user_id));

    expect((await call(createStaff, BODY)).status).toBe(201);
    expect(central.user.delete).toHaveBeenCalledWith({ where: { id: 'old' } });
  });

  it("refuses an email another business's staff already uses", async () => {
    ownDatabase = true;
    central.staff_directory.findUnique.mockResolvedValue({ email: 'ana@casa.com', user_id: 'x', platform_id: 'p2' });
    ownDb.platform_users.count.mockResolvedValue(0);
    expect((await call(createStaff, BODY)).status).toBe(409);
    expect(ownDb.user.create).not.toHaveBeenCalled();
  });

  it('frees the directory entry if creating the account fails', async () => {
    ownDatabase = true;
    ownDb.platform_users.count.mockResolvedValue(0);
    ownDb.$transaction.mockRejectedValue(new Error('database unreachable'));
    central.staff_directory.delete.mockResolvedValue({});
    await expect(call(createStaff, BODY)).rejects.toThrow('database unreachable');
    expect(central.staff_directory.delete).toHaveBeenCalled();
  });

  it("lists staff from the business's own database", async () => {
    ownDatabase = true;
    ownDb.platform_users.findMany.mockResolvedValue([record('u9')]);
    const res = await call(listStaff);
    expect(res.body.staff).toHaveLength(1);
    expect(central.platform_users.findMany).not.toHaveBeenCalled();
  });
});
