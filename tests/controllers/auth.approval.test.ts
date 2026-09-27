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

describe('login with the sign-in page\'s Owner / Staff choice', () => {
  const callAs = async (signInAs: string | undefined, password = 'longenough') => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const body = { email: 'ana@example.com', password, ...(signInAs ? { signInAs } : {}) };
    await login({ body } as Request, { status } as unknown as Response);
    return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
  };

  beforeEach(() => {
    jest.resetAllMocks();
    db.user.findFirst.mockResolvedValue(OWNER);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (jwt.sign as jest.Mock).mockReturnValue('token-1');
  });

  it.each([
    ['an owner as Owner', { role: 'OWNER', is_active: true, platform_id: 'p1' }, 'owner', 200],
    ['a new owner with no business as Owner', null, 'owner', 200],
    ['a staff member as Staff', { role: 'STAFF', is_active: true, platform_id: 'p1' }, 'staff', 200],
    ['an owner as Staff', { role: 'OWNER', is_active: true, platform_id: 'p1' }, 'staff', 401],
    ['a new owner as Staff', null, 'staff', 401],
    ['a staff member as Owner', { role: 'STAFF', is_active: true, platform_id: 'p1' }, 'owner', 401],
  ])('%s → %s', async (_label, membership, signInAs, expected) => {
    db.platform_users.findUnique.mockResolvedValue(membership);
    const res = await callAs(signInAs);
    expect(res.status).toBe(expected);
  });

  it('refuses the wrong choice exactly like a wrong password', async () => {
    db.platform_users.findUnique.mockResolvedValue({ role: 'STAFF', is_active: true, platform_id: 'p1' });
    const wrongChoice = await callAs('owner');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const wrongPassword = await callAs('staff', 'nope-nope');
    expect(wrongChoice).toEqual(wrongPassword);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("doesn't reveal a disabled account to the wrong choice", async () => {
    db.platform_users.findUnique.mockResolvedValue({ role: 'STAFF', is_active: false, platform_id: 'p1' });
    expect((await callAs('owner')).status).toBe(401);
    expect((await callAs('staff')).status).toBe(403);
  });

  it('checks nothing extra without a choice (older clients)', async () => {
    db.platform_users.findUnique.mockResolvedValue({ role: 'STAFF', is_active: true, platform_id: 'p1' });
    expect((await callAs(undefined)).status).toBe(200);
  });
});
