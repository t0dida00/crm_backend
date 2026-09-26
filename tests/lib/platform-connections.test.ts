jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: { platform_connections: { findUnique: jest.fn() } },
}));

import prisma from '../../src/config/prisma';
import { databaseName } from '../../src/lib/platform-connections';

const findUnique = (prisma as unknown as { platform_connections: { findUnique: jest.Mock } }).platform_connections.findUnique;

describe('databaseName', () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns only the database's name from its host/database label", async () => {
    findUnique.mockResolvedValue({ database_label: 'db.example.com/crm_platform_test', database_url_enc: 'v1:...' });
    await expect(databaseName('p1')).resolves.toBe('crm_platform_test');
  });

  it('is null on the shared database', async () => {
    findUnique.mockResolvedValue(null);
    await expect(databaseName('p1')).resolves.toBeNull();
    findUnique.mockResolvedValue({ database_label: null, database_url_enc: null });
    await expect(databaseName('p1')).resolves.toBeNull();
  });
});
