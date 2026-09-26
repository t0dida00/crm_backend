import { Response } from 'express';
import { AuthedRequest } from '../../src/middleware/auth.middleware';
import {
  listTables,
  listTableQrTokens,
  createTable,
  updateTable,
  deleteTable,
} from '../../src/controllers/table.controller';
import prisma from '../../src/config/prisma';
import * as platformContext from '../../src/lib/platform-context';
import * as tableToken from '../../src/lib/table-token';

// The Prisma client's model delegates aren't own properties, so automocking
// the module leaves `prisma.tables` undefined — spell out what's used instead.
jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    tables: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    orders: { findFirst: jest.fn() },
    bookings: { findFirst: jest.fn() },
  },
}));
jest.mock('../../src/lib/platform-context');
jest.mock('../../src/lib/table-token');

describe('Table Controller - Intensive Tests', () => {
  let mockRequest: Partial<AuthedRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let sendMock: jest.Mock;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a mockRejectedValue from one test
    // can't leak into the next.
    jest.resetAllMocks();

    jsonMock = jest.fn().mockReturnValue({});
    sendMock = jest.fn().mockReturnValue({});
    statusMock = jest.fn().mockReturnValue({ json: jsonMock, send: sendMock });

    mockRequest = {
      userId: 'user-123',
      body: {},
      params: {},
      query: {},
    };

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue('platform-123');
  });

  describe('List Tables - Intensive Tests', () => {
    test('should return all tables for a platform', async () => {
      const mockTables = [
        { id: '1', name: 'Table 1', seats: 4, zone: 'A' },
        { id: '2', name: 'Table 2', seats: 2, zone: 'B' },
      ];

      (prisma.tables.findMany as jest.Mock).mockResolvedValue(mockTables);

      await listTables(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ tables: mockTables });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await listTables(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'No platform found for this user' });
    });

    test('should sort tables by name', async () => {
      const mockTables: unknown[] = [];

      (prisma.tables.findMany as jest.Mock).mockResolvedValue(mockTables);

      await listTables(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.findMany).toHaveBeenCalledWith({
        where: { platform_id: 'platform-123' },
        orderBy: { name: 'asc' },
      });
    });

    test('should handle empty tables list', async () => {
      (prisma.tables.findMany as jest.Mock).mockResolvedValue([]);

      await listTables(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ tables: [] });
    });
  });

  describe('List Table QR Tokens - Intensive Tests', () => {
    test('should generate tokens for all tables', async () => {
      const mockTables = [
        { id: 'table-1', name: 'Table 1' },
        { id: 'table-2', name: 'Table 2' },
      ];

      (prisma.tables.findMany as jest.Mock).mockResolvedValue(mockTables);
      (tableToken.signTableToken as jest.Mock)
        .mockReturnValueOnce('token-1')
        .mockReturnValueOnce('token-2');

      await listTableQrTokens(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        tokens: [
          { tableId: 'table-1', tableName: 'Table 1', token: 'token-1' },
          { tableId: 'table-2', tableName: 'Table 2', token: 'token-2' },
        ],
      });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await listTableQrTokens(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    test('should handle empty tables list', async () => {
      (prisma.tables.findMany as jest.Mock).mockResolvedValue([]);

      await listTableQrTokens(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ tokens: [] });
    });

    test('should sign token with platform ID and table ID', async () => {
      const mockTables = [{ id: 'table-1', name: 'Table 1' }];

      (prisma.tables.findMany as jest.Mock).mockResolvedValue(mockTables);
      (tableToken.signTableToken as jest.Mock).mockReturnValue('token');

      await listTableQrTokens(mockRequest as AuthedRequest, mockResponse as Response);

      expect(tableToken.signTableToken).toHaveBeenCalledWith('platform-123', 'table-1');
    });
  });

  describe('Create Table - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.body = {
        name: 'Table 1',
        seats: 4,
        zone: 'Zone A',
      };
    });

    test('should create a new table successfully', async () => {
      const mockTable = { id: 'new-table', name: 'Table 1', seats: 4, zone: 'Zone A' };

      (prisma.tables.create as jest.Mock).mockResolvedValue(mockTable);

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({ table: mockTable });
    });

    test('should return 400 if name is missing', async () => {
      mockRequest.body = { seats: 4, zone: 'Zone A' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'name is required' });
    });

    test('should return 400 if name is not a string', async () => {
      mockRequest.body = { name: 123, seats: 4, zone: 'Zone A' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should return 400 if name is empty string', async () => {
      mockRequest.body = { name: '   ', seats: 4, zone: 'Zone A' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should return 400 if seats is not a positive number', async () => {
      mockRequest.body = { name: 'Table 1', seats: 0, zone: 'Zone A' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'seats must be a positive number' });
    });

    test('should return 400 if seats is negative', async () => {
      mockRequest.body = { name: 'Table 1', seats: -5, zone: 'Zone A' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should return 400 if seats is not a number', async () => {
      mockRequest.body = { name: 'Table 1', seats: 'four', zone: 'Zone A' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should return 400 if zone is missing', async () => {
      mockRequest.body = { name: 'Table 1', seats: 4 };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'zone is required' });
    });

    test('should return 400 if zone is empty string', async () => {
      mockRequest.body = { name: 'Table 1', seats: 4, zone: '   ' };

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should trim name and zone values', async () => {
      mockRequest.body = { name: '  Table 1  ', seats: 4, zone: '  Zone A  ' };

      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalledWith({
        data: {
          platform_id: 'platform-123',
          name: 'Table 1',
          seats: 4,
          zone: 'Zone A',
          state: 'Free',
        },
      });
    });

    test('should set initial state to "Free"', async () => {
      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          state: 'Free',
        }),
      });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    test('should handle very large seat numbers', async () => {
      mockRequest.body = { name: 'Table 1', seats: 999999, zone: 'Zone A' };

      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalled();
    });
  });

  describe('Update Table - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.params = { id: 'table-123' };
      mockRequest.body = {
        name: 'Updated Table',
        seats: 6,
        zone: 'Zone B',
      };
    });

    test('should update all fields', async () => {
      const existingTable = { id: 'table-123', name: 'Table 1' };
      const updatedTable = { id: 'table-123', name: 'Updated Table', seats: 6, zone: 'Zone B' };

      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);
      (prisma.tables.update as jest.Mock).mockResolvedValue(updatedTable);

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ table: updatedTable });
    });

    test('should return 404 if table not found', async () => {
      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(null);

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Table not found' });
    });

    test('should only update provided fields', async () => {
      mockRequest.body = { name: 'Updated Table' };
      const existingTable = { id: 'table-123', name: 'Table 1' };

      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);
      (prisma.tables.update as jest.Mock).mockResolvedValue({});

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.update).toHaveBeenCalledWith({
        where: { id: 'table-123' },
        data: { name: 'Updated Table' },
      });
    });

    test('should ignore invalid field values', async () => {
      mockRequest.body = { name: 'Updated Table', seats: 0, zone: '   ' };
      const existingTable = { id: 'table-123' };

      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);
      (prisma.tables.update as jest.Mock).mockResolvedValue({});

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.update).toHaveBeenCalledWith({
        where: { id: 'table-123' },
        data: { name: 'Updated Table' },
      });
    });

    test('should trim name when updating', async () => {
      mockRequest.body = { name: '  New Name  ' };
      const existingTable = { id: 'table-123' };

      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);
      (prisma.tables.update as jest.Mock).mockResolvedValue({});

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.update).toHaveBeenCalledWith({
        where: { id: 'table-123' },
        data: { name: 'New Name' },
      });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    test('should verify platform ownership', async () => {
      const existingTable = { id: 'table-123' };
      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);

      await updateTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.findFirst).toHaveBeenCalledWith({
        where: { id: 'table-123', platform_id: 'platform-123' },
      });
    });
  });

  describe('Delete Table - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.params = { id: 'table-123' };
    });

    test('should delete a table successfully', async () => {
      const existingTable = { id: 'table-123' };

      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.bookings.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.tables.delete as jest.Mock).mockResolvedValue(existingTable);

      await deleteTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.delete).toHaveBeenCalledWith({ where: { id: 'table-123' } });
      expect(statusMock).toHaveBeenCalledWith(204);
      expect(sendMock).toHaveBeenCalled();
    });

    test('should return 409 if table has an open order', async () => {
      (prisma.tables.findFirst as jest.Mock).mockResolvedValue({ id: 'table-123' });
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue({ id: 'order-1' });
      (prisma.bookings.findFirst as jest.Mock).mockResolvedValue(null);

      await deleteTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.findFirst).toHaveBeenCalledWith({
        where: { table_id: 'table-123', closed_ts: null },
      });
      expect(statusMock).toHaveBeenCalledWith(409);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Table has an open order or active booking' });
      expect(prisma.tables.delete).not.toHaveBeenCalled();
    });

    test('should return 409 if table has an active booking', async () => {
      (prisma.tables.findFirst as jest.Mock).mockResolvedValue({ id: 'table-123' });
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.bookings.findFirst as jest.Mock).mockResolvedValue({ id: 'booking-1' });

      await deleteTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(409);
      expect(prisma.tables.delete).not.toHaveBeenCalled();
    });

    test('should return 404 if table not found', async () => {
      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(null);

      await deleteTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Table not found' });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await deleteTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    test('should verify platform ownership before deleting', async () => {
      const existingTable = { id: 'table-123' };
      (prisma.tables.findFirst as jest.Mock).mockResolvedValue(existingTable);

      await deleteTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.findFirst).toHaveBeenCalledWith({
        where: { id: 'table-123', platform_id: 'platform-123' },
      });
    });
  });

  describe('Table Controller - Edge Cases', () => {
    test('should handle SQL injection in table name', async () => {
      mockRequest.body = {
        name: "'; DROP TABLE tables; --",
        seats: 4,
        zone: 'Zone A',
      };

      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalled();
    });

    test('should handle very long table names', async () => {
      mockRequest.body = {
        name: 'a'.repeat(1000),
        seats: 4,
        zone: 'Zone A',
      };

      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalled();
    });

    test('should handle special characters in zone', async () => {
      mockRequest.body = {
        name: 'Table 1',
        seats: 4,
        zone: 'Zone-A/B (Outdoor)',
      };

      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalled();
    });

    test('should handle unicode characters in table name', async () => {
      mockRequest.body = {
        name: 'Table 1 🍽️',
        seats: 4,
        zone: 'Zone A',
      };

      (prisma.tables.create as jest.Mock).mockResolvedValue({});

      await createTable(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.tables.create).toHaveBeenCalled();
    });
  });

  describe('Table Controller - Error Handling', () => {
    test('should handle Prisma errors in listTables', async () => {
      (prisma.tables.findMany as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await expect(
        listTables(mockRequest as AuthedRequest, mockResponse as Response)
      ).rejects.toThrow('Database error');
    });

    test('should handle create errors', async () => {
      mockRequest.body = { name: 'Table 1', seats: 4, zone: 'Zone A' };

      (prisma.tables.create as jest.Mock).mockRejectedValue(
        new Error('Unique constraint failed')
      );

      await expect(
        createTable(mockRequest as AuthedRequest, mockResponse as Response)
      ).rejects.toThrow('Unique constraint failed');
    });
  });
});
