jest.mock('../../src/config/prisma', () => ({ __esModule: true, default: { shared: true } }));
jest.mock('../../src/lib/platform-connections', () => ({
  getConnection: jest.fn(),
  sharedInfraAllowed: jest.fn(),
}));
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation((opts) => ({ opts, $disconnect: jest.fn(async () => {}) })),
}));

import prisma from '../../src/config/prisma';
import { getConnection, sharedInfraAllowed } from '../../src/lib/platform-connections';
import { tenantDb, TenantNotConnectedError, withPoolLimits } from '../../src/config/tenant-db';

describe('tenantDb', () => {
  beforeEach(() => {
    (sharedInfraAllowed as jest.Mock).mockReturnValue(true);
  });

  it('uses the shared client when the business has no database', async () => {
    (getConnection as jest.Mock).mockResolvedValue({ databaseUrl: null, pusher: null });
    expect(await tenantDb('p1')).toBe(prisma);
  });

  it('refuses when the shared database is turned off', async () => {
    (getConnection as jest.Mock).mockResolvedValue({ databaseUrl: null, pusher: null });
    (sharedInfraAllowed as jest.Mock).mockReturnValue(false);
    await expect(tenantDb('p1')).rejects.toBeInstanceOf(TenantNotConnectedError);
  });

  it('connects to the business database with pool limits and reuses the client', async () => {
    (getConnection as jest.Mock).mockResolvedValue({ databaseUrl: 'postgresql://u:p@db.example.com/shop', pusher: null });
    const first = (await tenantDb('p2')) as unknown as { opts: { datasources: { db: { url: string } } } };
    const second = await tenantDb('p2');
    expect(second).toBe(first);
    expect(first.opts.datasources.db.url).toContain('connection_limit=1');
  });
});

describe('withPoolLimits', () => {
  it('keeps limits the owner already set', () => {
    expect(withPoolLimits('postgresql://u:p@h/db?connection_limit=5')).toContain('connection_limit=5');
    expect(withPoolLimits('postgresql://u:p@h/db')).toMatch(/connection_limit=1.*pool_timeout=10/);
  });
});
