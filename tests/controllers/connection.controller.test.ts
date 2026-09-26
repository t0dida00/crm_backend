jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    platform_connections: { findUnique: jest.fn(), upsert: jest.fn() },
    platforms: { findUniqueOrThrow: jest.fn() },
  },
}));
jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformMembership: jest.fn() }));
jest.mock('../../src/lib/tenant-provision', () => ({
  TENANT_SCHEMA_VERSION: 1,
  provisionTenantDatabase: jest.fn(),
  testDatabase: jest.fn(),
  verifyPusher: jest.fn(),
}));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { resolvePlatformMembership } from '../../src/lib/platform-context';
import { provisionTenantDatabase, verifyPusher } from '../../src/lib/tenant-provision';
import { ConnectionInputError } from '../../src/lib/connection-input';
import { decrypt } from '../../src/lib/crypto';
import {
  getConnections,
  putDatabase,
  putPusher,
} from '../../src/controllers/connection.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const db = prisma as unknown as {
  platform_connections: { findUnique: jest.Mock; upsert: jest.Mock };
  platforms: { findUniqueOrThrow: jest.Mock };
};
const DB_URL = 'postgresql://owner:hunter2@db.example.com:5432/shop';
const PUSHER = { appId: '123456', key: 'abcdef1234567890', secret: 'fedcba0987654321', cluster: 'eu' };

const call = async (handler: typeof getConnections, body?: unknown) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await handler({ userId: 'u1', body } as AuthedRequest, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

describe('connection controller', () => {
  const originalKey = process.env.CREDENTIALS_KEY;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.CREDENTIALS_KEY = 'c'.repeat(64);
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'OWNER' });
    db.platform_connections.upsert.mockImplementation(async ({ create }) => ({ ...create }));
  });
  afterAll(() => {
    process.env.CREDENTIALS_KEY = originalKey;
  });

  it('is owner-only', async () => {
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'STAFF' });
    for (const handler of [getConnections, putDatabase, putPusher]) {
      expect((await call(handler, {})).status).toBe(403);
    }
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('reports nothing connected yet', async () => {
    db.platform_connections.findUnique.mockResolvedValue(null);
    const res = await call(getConnections);
    expect(res.body).toMatchObject({ database: null, pusher: null, sharedInfraAllowed: true, canStoreCredentials: true });
  });

  it('sets up and stores the database encrypted, returning only the label', async () => {
    db.platforms.findUniqueOrThrow.mockResolvedValue({ id: 'p1', name: 'Casa', platform_types: { id: 't', code: 'CAFE', name: 'Cafe' } });

    const res = await call(putDatabase, { url: DB_URL });

    expect(provisionTenantDatabase).toHaveBeenCalledWith(DB_URL, expect.objectContaining({ id: 'p1' }));
    const saved = db.platform_connections.upsert.mock.calls[0][0].create;
    expect(saved.database_url_enc).not.toContain('hunter2');
    expect(decrypt(saved.database_url_enc)).toBe(DB_URL);
    expect(res.status).toBe(200);
    expect(res.body.database.label).toBe('db.example.com/shop');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('returns 400 with the reason when the database is refused', async () => {
    db.platforms.findUniqueOrThrow.mockResolvedValue({ id: 'p1', name: 'Casa', platform_types: {} });
    (provisionTenantDatabase as jest.Mock).mockRejectedValue(new ConnectionInputError('This database already has tables. Use an empty database.'));
    const res = await call(putDatabase, { url: DB_URL });
    expect(res).toEqual({ status: 400, body: { error: 'This database already has tables. Use an empty database.' } });
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('refuses to store credentials without CREDENTIALS_KEY', async () => {
    delete process.env.CREDENTIALS_KEY;
    expect((await call(putDatabase, { url: DB_URL })).status).toBe(503);
    expect((await call(putPusher, PUSHER)).status).toBe(503);
  });

  it('verifies Pusher and never returns the secret', async () => {
    const res = await call(putPusher, PUSHER);
    expect(verifyPusher).toHaveBeenCalledWith(PUSHER);
    const saved = db.platform_connections.upsert.mock.calls[0][0].create;
    expect(decrypt(saved.pusher_secret_enc)).toBe(PUSHER.secret);
    expect(res.body.pusher).toMatchObject({ appId: '123456', key: PUSHER.key, cluster: 'eu' });
    expect(JSON.stringify(res.body)).not.toContain(PUSHER.secret);
  });

  it('rejects Pusher credentials that fail verification', async () => {
    (verifyPusher as jest.Mock).mockRejectedValue(new ConnectionInputError('Pusher rejected these credentials: 401'));
    const res = await call(putPusher, PUSHER);
    expect(res.status).toBe(400);
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });
});
