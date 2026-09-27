jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    platform_connections: { findUnique: jest.fn(), upsert: jest.fn() },
    platforms: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformMembership: jest.fn() }));
jest.mock('../../src/lib/business-profile', () => ({
  EMPTY_PROFILE: { phone: null, email: null, address: null, logo_url: null },
  readProfile: async () => ({ phone: '+34 600', email: null, address: 'Mar 1', logo_url: null }),
}));
jest.mock('../../src/lib/tenant-provision', () => ({
  TENANT_SCHEMA_VERSION: 1,
  checkTenantDatabase: jest.fn(),
  provisionTenantDatabase: jest.fn(),
  testDatabase: jest.fn(),
  verifyPusher: jest.fn(),
}));
jest.mock('../../src/lib/storage', () => ({ verifyStorage: jest.fn() }));

import { Response } from 'express';
import prisma from '../../src/config/prisma';
import { resolvePlatformMembership } from '../../src/lib/platform-context';
import { checkTenantDatabase, provisionTenantDatabase, verifyPusher } from '../../src/lib/tenant-provision';
import { verifyStorage } from '../../src/lib/storage';
import { ConnectionInputError } from '../../src/lib/connection-input';
import { decrypt } from '../../src/lib/crypto';
import { checkConnections, getConnections, putConnections } from '../../src/controllers/connection.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const db = prisma as unknown as {
  platform_connections: { findUnique: jest.Mock; upsert: jest.Mock };
  platforms: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
};
const DB_URL = 'postgresql://owner:hunter2@db.example.com:5432/shop';
const PUSHER = { appId: '123456', key: 'abcdef1234567890', secret: 'fedcba0987654321', cluster: 'eu' };
const STORAGE = {
  provider: 's3',
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'menu-photos',
  accessKeyId: 'AKIAEXAMPLE123',
  secretAccessKey: 'sup3r-s3cret-key',
  publicUrl: 'https://pub-123.r2.dev',
};

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

  const BODY = { databaseUrl: DB_URL, pusher: PUSHER, storage: STORAGE };
  const platformRow = { id: 'p1', name: 'Casa', platform_types: { id: 't', code: 'CAFE', name: 'Cafe' } };

  it('is owner-only', async () => {
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'STAFF' });
    expect((await call(getConnections)).status).toBe(403);
    expect((await call(putConnections, BODY)).status).toBe(403);
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('reports nothing connected yet', async () => {
    db.platform_connections.findUnique.mockResolvedValue(null);
    const res = await call(getConnections);
    expect(res.body).toMatchObject({ database: null, pusher: null, storage: null, sharedInfraAllowed: true, canStoreCredentials: true });
  });

  it('checks all three, sets up the database, and saves them encrypted in one write', async () => {
    db.platforms.findUniqueOrThrow.mockResolvedValue(platformRow);

    const res = await call(putConnections, BODY);

    expect(verifyPusher).toHaveBeenCalledWith(PUSHER);
    expect(verifyStorage).toHaveBeenCalledWith(STORAGE);
    expect(provisionTenantDatabase).toHaveBeenCalledWith(
      DB_URL,
      expect.objectContaining({ id: 'p1', profile: { phone: '+34 600', email: null, address: 'Mar 1', logo_url: null } }),
    );
    // The central row keeps only what finds the business.
    expect(db.platforms.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { phone: null, email: null, address: null, logo_url: null },
    });
    expect(db.platform_connections.upsert).toHaveBeenCalledTimes(1);
    const saved = db.platform_connections.upsert.mock.calls[0][0].create;
    expect(decrypt(saved.database_url_enc)).toBe(DB_URL);
    expect(decrypt(saved.pusher_secret_enc)).toBe(PUSHER.secret);
    expect(JSON.parse(decrypt(saved.storage_config_enc))).toEqual(STORAGE);
    expect(saved.storage_provider).toBe('s3');
    expect(res.status).toBe(200);
    expect(res.body.database.label).toBe('db.example.com/shop');
    expect(res.body.pusher).toMatchObject({ appId: '123456', key: PUSHER.key, cluster: 'eu' });
    expect(res.body.storage).toMatchObject({ provider: 's3', label: 'menu-photos · pub-123.r2.dev' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain(PUSHER.secret);
    expect(text).not.toContain(STORAGE.secretAccessKey);
    expect(text).not.toContain(STORAGE.accessKeyId);
  });

  it('requires the database URL, the Pusher details and the storage', async () => {
    expect((await call(putConnections, { databaseUrl: DB_URL, storage: STORAGE })).status).toBe(400);
    expect((await call(putConnections, { pusher: PUSHER, storage: STORAGE })).status).toBe(400);
    expect((await call(putConnections, { databaseUrl: DB_URL, pusher: PUSHER })).status).toBe(400);
    expect(provisionTenantDatabase).not.toHaveBeenCalled();
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('saves nothing and never touches the database when Pusher is rejected', async () => {
    (verifyPusher as jest.Mock).mockRejectedValue(new ConnectionInputError('Pusher rejected these credentials: 401'));
    const res = await call(putConnections, BODY);
    expect(res).toEqual({ status: 400, body: { error: 'Pusher rejected these credentials: 401' } });
    expect(provisionTenantDatabase).not.toHaveBeenCalled();
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('saves nothing and never touches the database when storage fails its check', async () => {
    (verifyStorage as jest.Mock).mockRejectedValue(new ConnectionInputError("The test file isn't publicly readable"));
    const res = await call(putConnections, BODY);
    expect(res).toEqual({ status: 400, body: { error: "The test file isn't publicly readable" } });
    expect(provisionTenantDatabase).not.toHaveBeenCalled();
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('saves nothing when the database is refused', async () => {
    db.platforms.findUniqueOrThrow.mockResolvedValue(platformRow);
    (provisionTenantDatabase as jest.Mock).mockRejectedValue(new ConnectionInputError('This database already has tables. Use an empty database.'));
    const res = await call(putConnections, BODY);
    expect(res).toEqual({ status: 400, body: { error: 'This database already has tables. Use an empty database.' } });
    expect(db.platform_connections.upsert).not.toHaveBeenCalled();
  });

  it('refuses to store credentials without CREDENTIALS_KEY', async () => {
    delete process.env.CREDENTIALS_KEY;
    expect((await call(putConnections, BODY)).status).toBe(503);
  });

  describe('before the business exists', () => {
    beforeEach(() => (resolvePlatformMembership as jest.Mock).mockResolvedValue(null));

    it("shows nothing connected, with the server's options", async () => {
      const res = await call(getConnections);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ database: null, pusher: null, storage: null, sharedInfraAllowed: true });
      expect(db.platform_connections.findUnique).not.toHaveBeenCalled();
    });

    it('checks all three without saving or setting anything up', async () => {
      const res = await call(checkConnections, BODY);
      expect(res).toEqual({ status: 200, body: { ok: true } });
      expect(verifyPusher).toHaveBeenCalledWith(PUSHER);
      expect(verifyStorage).toHaveBeenCalledWith(STORAGE);
      expect(checkTenantDatabase).toHaveBeenCalledWith(DB_URL, null);
      expect(provisionTenantDatabase).not.toHaveBeenCalled();
      expect(db.platform_connections.upsert).not.toHaveBeenCalled();
    });

    it('still needs the business itself to save', async () => {
      expect((await call(putConnections, BODY)).status).toBe(404);
    });
  });

  it("checks against the owner's own business once it exists", async () => {
    await call(checkConnections, BODY);
    expect(checkTenantDatabase).toHaveBeenCalledWith(DB_URL, 'p1');
  });

  it("reports the check's reason, and never lets staff check", async () => {
    (checkTenantDatabase as jest.Mock).mockRejectedValue(new ConnectionInputError('This database already has tables. Use an empty database.'));
    expect(await call(checkConnections, BODY)).toEqual({
      status: 400,
      body: { error: 'This database already has tables. Use an empty database.' },
    });
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'STAFF' });
    expect((await call(checkConnections, BODY)).status).toBe(403);
    expect((await call(getConnections)).status).toBe(403);
  });
});
