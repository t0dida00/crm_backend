import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { register } from '../../src/controllers/auth.controller';
import prisma from '../../src/config/prisma';

jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('bcrypt');
jest.mock('jsonwebtoken');

const mockPrisma = prisma as unknown as { user: { findFirst: jest.Mock; create: jest.Mock } };

describe('register', () => {
  let res: Partial<Response>;
  let json: jest.Mock;
  let status: jest.Mock;
  const call = (body: unknown) => register({ body } as Request, res as Response);
  const valid = { fullName: ' Ana Ruiz ', email: ' Ana@Example.com ', password: 'longenough' };

  beforeEach(() => {
    jest.resetAllMocks();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    res = { status };
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    (jwt.sign as jest.Mock).mockReturnValue('token-1');
  });

  test.each([
    [{ ...valid, fullName: '  ' }, 'Full name is required'],
    [{ ...valid, email: 'not-an-email' }, 'A valid email is required'],
    [{ ...valid, password: 'short' }, 'Password must be at least 8 characters'],
    [undefined, 'Full name is required'],
  ])('rejects invalid input %#', async (body, error) => {
    await call(body);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  test('rejects an email that is already registered', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u0' });
    await call(valid);
    expect(status).toHaveBeenCalledWith(409);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  test('creates the user with a hashed password and signs them in without a role', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'u1', email: 'ana@example.com', full_name: 'Ana Ruiz' });

    await call(valid);

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: { email: 'ana@example.com', password_hash: 'hashed', full_name: 'Ana Ruiz' },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'u1', email: 'ana@example.com', role: null },
      expect.anything(),
      { expiresIn: '1d' },
    );
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      token: 'token-1',
      user: { id: 'u1', email: 'ana@example.com', full_name: 'Ana Ruiz', role: null },
    });
  });
});
