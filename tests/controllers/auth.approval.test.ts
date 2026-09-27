import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { login } from '../../src/controllers/auth.controller';
import prisma from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    staff_directory: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    platform_users: { findUnique: jest.fn() },
    account_approvals: { findUnique: jest.fn() },
  },
}));
jest.mock('../../src/lib/platform-connections', () => ({
  getConnection: async () => ({ databaseUrl: null, pusher: null }),
}));
jest.mock('bcrypt');
jest.mock('jsonwebtoken');

const db = prisma as unknown as {
  user: { findFirst: jest.Mock };
  platform_users: { findUnique: jest.Mock };
  account_approvals: { findUnique: jest.Mock };
};
const OWNER = { id: 'u1', email: 'ana@example.com', full_name: 'Ana Ruiz', password_hash: 'h', is_active: true };

const call = async (password = 'longenough') => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await login({ body: { email: 'ana@example.com', password } } as Request, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

describe('login while accounts need approval', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.REQUIRE_ACCOUNT_APPROVAL = 'true';
    db.user.findFirst.mockResolvedValue(OWNER);
    db.platform_users.findUnique.mockResolvedValue(null);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('token-1');
  });
  afterAll(() => {
    delete process.env.REQUIRE_ACCOUNT_APPROVAL;
  });

  it('refuses an account waiting for review', async () => {
    db.account_approvals.findUnique.mockResolvedValue({ user_id: 'u1', status: 'pending' });
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("doesn't reveal the review to a wrong password", async () => {
    db.account_approvals.findUnique.mockResolvedValue({ user_id: 'u1', status: 'pending' });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    expect((await call('wrong-pass')).status).toBe(401);
  });

  it.each([
    ['an approved account', { user_id: 'u1', status: 'approved' }],
    ['an account from before (no row)', null],
  ])('lets in %s', async (_label, row) => {
    db.account_approvals.findUnique.mockResolvedValue(row);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('token-1');
  });

  it('lets waiting accounts in once the review is turned off', async () => {
    delete process.env.REQUIRE_ACCOUNT_APPROVAL;
    db.account_approvals.findUnique.mockResolvedValue({ user_id: 'u1', status: 'pending' });
    expect((await call()).status).toBe(200);
    expect(db.account_approvals.findUnique).not.toHaveBeenCalled();
  });
});
