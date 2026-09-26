import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { login } from '../../src/controllers/auth.controller';
import prisma from '../../src/config/prisma';

// Mock dependencies
jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
    },
    platform_users: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('bcrypt');
jest.mock('jsonwebtoken');

describe('Auth Controller - Intensive Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a mockRejectedValue/mockImplementation
    // from one test can't leak into the next.
    jest.resetAllMocks();
    
    jsonMock = jest.fn().mockReturnValue({});
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      body: {},
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };
  });

  describe('Input Validation - Intensive Tests', () => {
    test('should reject missing email', async () => {
      mockRequest.body = { password: 'password123' };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email and password are required',
      });
    });

    test('should reject missing password', async () => {
      mockRequest.body = { email: 'test@example.com' };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email and password are required',
      });
    });

    test('should reject both missing email and password', async () => {
      mockRequest.body = {};

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email and password are required',
      });
    });

    test('should reject non-string email', async () => {
      mockRequest.body = { email: 123, password: 'password123' };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email and password are required',
      });
    });

    test('should reject non-string password', async () => {
      mockRequest.body = { email: 'test@example.com', password: 123 };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Email and password are required',
      });
    });

    test('should reject null values', async () => {
      mockRequest.body = { email: null, password: null };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should reject undefined values', async () => {
      mockRequest.body = { email: undefined, password: undefined };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should handle empty string email', async () => {
      mockRequest.body = { email: '', password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    test('should handle very long email string', async () => {
      const longEmail = 'a'.repeat(1000) + '@example.com';
      mockRequest.body = { email: longEmail, password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    test('should handle special characters in email', async () => {
      mockRequest.body = {
        email: 'test+special!@example.com',
        password: 'password123',
      };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });
  });

  describe('User Not Found - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.body = { email: 'nonexistent@example.com', password: 'password123' };
    });

    test('should return 401 for non-existent user', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid email or password',
      });
    });

    test('should use case-insensitive email search', async () => {
      mockRequest.body = { email: 'Test@Example.COM', password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'Test@Example.COM', mode: 'insensitive' } },
      });
    });

    test('should not reveal user existence through different error messages', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      mockRequest.body = { email: 'nonexistent@example.com', password: 'anypassword' };

      await login(mockRequest as Request, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid email or password',
      });
    });
  });

  describe('Inactive User Account - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.body = { email: 'inactive@example.com', password: 'password123' };
    });

    test('should reject inactive user', async () => {
      const inactiveUser = {
        id: '1',
        email: 'inactive@example.com',
        full_name: 'Inactive User',
        password_hash: 'hashedpassword',
        is_active: false,
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(inactiveUser);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid email or password',
      });
    });

    test('should not even check password for inactive user', async () => {
      const inactiveUser = {
        id: '1',
        email: 'inactive@example.com',
        full_name: 'Inactive User',
        password_hash: 'hashedpassword',
        is_active: false,
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(inactiveUser);

      await login(mockRequest as Request, mockResponse as Response);

      // bcrypt.compare should not be called for inactive users
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe('Password Validation - Intensive Tests', () => {
    const validUser = {
      id: '1',
      email: 'test@example.com',
      full_name: 'Test User',
      password_hash: '$2b$10$hashedpassword',
      is_active: true,
    };

    beforeEach(() => {
      mockRequest.body = { email: 'test@example.com', password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
    });

    test('should accept correct password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(bcrypt.compare).toHaveBeenCalledWith('password123', validUser.password_hash);
      expect(statusMock).toHaveBeenCalledWith(200);
    });

    test('should reject incorrect password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Invalid email or password',
      });
    });

    test('should handle bcrypt comparison errors', async () => {
      (bcrypt.compare as jest.Mock).mockRejectedValue(new Error('bcrypt error'));

      await expect(login(mockRequest as Request, mockResponse as Response)).rejects.toThrow();
    });

    test('should handle very long password strings', async () => {
      mockRequest.body = { email: 'test@example.com', password: 'a'.repeat(1000) };
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    test('should be case-sensitive for password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      mockRequest.body = { email: 'test@example.com', password: 'PASSWORD123' };

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });
  });

  describe('Platform Users Check - Intensive Tests', () => {
    const validUser = {
      id: '1',
      email: 'test@example.com',
      full_name: 'Test User',
      password_hash: '$2b$10$hashedpassword',
      is_active: true,
    };

    beforeEach(() => {
      mockRequest.body = { email: 'test@example.com', password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    test('should handle user with no platform assignment', async () => {
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        token: 'mock_token',
        user: { id: '1', email: 'test@example.com', full_name: 'Test User', role: null },
      });
    });

    test('should reject disabled platform user', async () => {
      const disabledPlatformUser = {
        user_id: '1',
        is_active: false,
        role: 'admin',
      };
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(disabledPlatformUser);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'ACCOUNT_DISABLED',
        message: 'Your account is disabled temporarily. Please contact your owner(s).',
      });
    });

    test('should accept active platform user with role', async () => {
      const activePlatformUser = {
        user_id: '1',
        is_active: true,
        role: 'staff',
      };
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(activePlatformUser);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        token: 'mock_token',
        user: { id: '1', email: 'test@example.com', full_name: 'Test User', role: 'staff' },
      });
    });
  });

  describe('JWT Token Generation - Intensive Tests', () => {
    const validUser = {
      id: '1',
      email: 'test@example.com',
      full_name: 'Test User',
      password_hash: '$2b$10$hashedpassword',
      is_active: true,
    };

    beforeEach(() => {
      mockRequest.body = { email: 'test@example.com', password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    test('should generate JWT with correct payload for user without role', async () => {
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: '1', email: 'test@example.com', role: null },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
    });

    test('should generate JWT with correct payload for user with role', async () => {
      const platformUser = { user_id: '1', is_active: true, role: 'admin' };
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(platformUser);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: '1', email: 'test@example.com', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
    });

    test('should handle JWT generation errors', async () => {
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockImplementation(() => {
        throw new Error('JWT error');
      });

      await expect(login(mockRequest as Request, mockResponse as Response)).rejects.toThrow();
    });

    test('should use 1d expiration for all tokens', async () => {
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      const callArgs = (jwt.sign as jest.Mock).mock.calls[0];
      expect(callArgs[2].expiresIn).toBe('1d');
    });
  });

  describe('Response Format - Intensive Tests', () => {
    const validUser = {
      id: '1',
      email: 'test@example.com',
      full_name: 'Test User',
      password_hash: '$2b$10$hashedpassword',
      is_active: true,
    };

    beforeEach(() => {
      mockRequest.body = { email: 'test@example.com', password: 'password123' };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
    });

    test('should return 200 status on successful login', async () => {
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
    });

    test('should include token in response', async () => {
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      const call = jsonMock.mock.calls[0][0];
      expect(call.token).toBe('mock_token');
    });

    test('should include user object in response', async () => {
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      const call = jsonMock.mock.calls[0][0];
      expect(call.user).toBeDefined();
      expect(call.user.id).toBe('1');
      expect(call.user.email).toBe('test@example.com');
      expect(call.user.full_name).toBe('Test User');
    });

    test('should not include password_hash in response', async () => {
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      const call = jsonMock.mock.calls[0][0];
      expect(call.user.password_hash).toBeUndefined();
    });

    test('should include role in user response', async () => {
      const platformUser = { user_id: '1', is_active: true, role: 'admin' };
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(platformUser);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      const call = jsonMock.mock.calls[0][0];
      expect(call.user.role).toBe('admin');
    });
  });

  describe('Edge Cases - Intensive Tests', () => {
    test('should handle SQL injection attempts in email', async () => {
      mockRequest.body = {
        email: "'; DROP TABLE users; --",
        password: 'password123',
      };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    test('should handle request body as null', async () => {
      mockRequest.body = null;

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should handle request body as undefined', async () => {
      mockRequest.body = undefined;

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should handle additional fields in request body', async () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
        extra_field: 'should_be_ignored',
        admin: true,
      };

      const validUser = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test User',
        password_hash: '$2b$10$hashedpassword',
        is_active: true,
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
    });

    test('should handle unicode characters in email', async () => {
      mockRequest.body = {
        email: 'test+😀@example.com',
        password: 'password123',
      };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
    });

    test('should handle whitespace in email', async () => {
      mockRequest.body = {
        email: '  test@example.com  ',
        password: 'password123',
      };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await login(mockRequest as Request, mockResponse as Response);

      expect(prisma.user.findFirst).toHaveBeenCalled();
    });

    test('should handle multiple concurrent login attempts', async () => {
      const validUser = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test User',
        password_hash: '$2b$10$hashedpassword',
        is_active: true,
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');

      const requests = [1, 2, 3].map(() => ({
        body: { email: 'test@example.com', password: 'password123' },
      }));

      const responses = requests.map(() => ({
        status: statusMock,
        json: jsonMock,
      }));

      await Promise.all(
        requests.map((req, idx) => login(req as Request, responses[idx] as unknown as Response))
      );

      expect(statusMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('Performance and Load - Intensive Tests', () => {
    const validUser = {
      id: '1',
      email: 'test@example.com',
      full_name: 'Test User',
      password_hash: '$2b$10$hashedpassword',
      is_active: true,
    };

    beforeEach(() => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.platform_users.findUnique as jest.Mock).mockResolvedValue(null);
      (jwt.sign as jest.Mock).mockReturnValue('mock_token');
    });

    test('should complete login within reasonable time', async () => {
      mockRequest.body = { email: 'test@example.com', password: 'password123' };
      const startTime = Date.now();

      await login(mockRequest as Request, mockResponse as Response);

      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    test('should handle rapid successive login attempts', async () => {
      for (let i = 0; i < 10; i++) {
        mockRequest.body = { email: 'test@example.com', password: 'password123' };
        await login(mockRequest as Request, mockResponse as Response);
      }

      expect(statusMock).toHaveBeenCalledTimes(10);
      expect(statusMock).toHaveBeenLastCalledWith(200);
    });
  });

  describe('Database Error Handling - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.body = { email: 'test@example.com', password: 'password123' };
    });

    test('should handle database connection error', async () => {
      (prisma.user.findFirst as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(login(mockRequest as Request, mockResponse as Response)).rejects.toThrow(
        'Database connection failed'
      );
    });

    test('should handle Prisma query errors', async () => {
      const prismaNativeError = new Error('Prisma error: Invalid query');
      (prisma.user.findFirst as jest.Mock).mockRejectedValue(prismaNativeError);

      await expect(login(mockRequest as Request, mockResponse as Response)).rejects.toThrow();
    });

    test('should handle platform_users query errors gracefully', async () => {
      const validUser = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test User',
        password_hash: '$2b$10$hashedpassword',
        is_active: true,
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(validUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prisma.platform_users.findUnique as jest.Mock).mockRejectedValue(
        new Error('Platform query failed')
      );

      await expect(login(mockRequest as Request, mockResponse as Response)).rejects.toThrow();
    });
  });
});
