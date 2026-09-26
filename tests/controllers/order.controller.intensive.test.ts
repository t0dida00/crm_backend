import { Response } from 'express';
import { AuthedRequest } from '../../src/middleware/auth.middleware';
import {
  getOrderSeries,
  getOrderStats,
  listOrderHistory,
  listOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
} from '../../src/controllers/order.controller';
import prisma from '../../src/config/prisma';
import * as platformContext from '../../src/lib/platform-context';
import * as orderPlacement from '../../src/lib/order-placement';
import * as socket from '../../src/realtime/socket';

// The Prisma client's model delegates aren't own properties, so automocking
// the module leaves `prisma.orders` undefined — spell out what's used instead.
jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    orders: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../../src/lib/platform-context');
// Keep the real OrderPlacementError so the controller's instanceof check and
// its `status`/`message` fields behave as in production.
jest.mock('../../src/lib/order-placement', () => ({
  ...jest.requireActual('../../src/lib/order-placement'),
  placeOrderForTable: jest.fn(),
}));
jest.mock('../../src/realtime/socket');

describe('Order Controller - Intensive Tests', () => {
  let mockRequest: Partial<AuthedRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a mockRejectedValue from one test
    // (e.g. the socket error case) can't leak into the next.
    jest.resetAllMocks();

    jsonMock = jest.fn().mockReturnValue({});
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

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

  describe('List Orders - Intensive Tests', () => {
    test('should return open orders followed by recent closed orders', async () => {
      const openOrders = [{ id: '1', closed_ts: null, order_lines: [] }];
      const closedOrders = [{ id: '2', closed_ts: new Date(), order_lines: [] }];

      (prisma.orders.findMany as jest.Mock)
        .mockResolvedValueOnce(openOrders)
        .mockResolvedValueOnce(closedOrders);

      await listOrders(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ orders: [...openOrders, ...closedOrders] });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await listOrders(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'No platform found for this user' });
    });

    test('should only query open orders when open=true', async () => {
      mockRequest.query = { open: 'true' };
      const openOrders = [{ id: '1', closed_ts: null }];

      (prisma.orders.findMany as jest.Mock).mockResolvedValue(openOrders);

      await listOrders(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.orders.findMany).toHaveBeenCalledWith({
        where: { platform_id: 'platform-123', closed_ts: null },
        include: { order_lines: true },
        orderBy: { ts: 'desc' },
      });
      expect(jsonMock).toHaveBeenCalledWith({ orders: openOrders });
    });

    test('should cap closed orders to the most recently closed', async () => {
      (prisma.orders.findMany as jest.Mock).mockResolvedValue([]);

      await listOrders(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.findMany).toHaveBeenNthCalledWith(2, {
        where: { platform_id: 'platform-123', closed_ts: { not: null } },
        include: { order_lines: true },
        orderBy: { closed_ts: 'desc' },
        take: 500,
      });
    });

    test('should handle empty orders list', async () => {
      (prisma.orders.findMany as jest.Mock).mockResolvedValue([]);

      await listOrders(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ orders: [] });
    });

    test('should handle database errors', async () => {
      (prisma.orders.findMany as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await expect(listOrders(mockRequest as AuthedRequest, mockResponse as Response)).rejects.toThrow();
    });
  });

  describe('Order History - Pagination', () => {
    test('should return sessions in key order with the total', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ key: 'session-1' }, { key: 'order-3' }])
        .mockResolvedValueOnce([{ total: BigInt(42) }]);
      (prisma.orders.findMany as jest.Mock).mockResolvedValue([
        { id: 'order-3', session_id: null, closed_ts: new Date() },
        { id: 'order-1', session_id: 'session-1', closed_ts: new Date() },
        { id: 'order-2', session_id: 'session-1', closed_ts: new Date() },
      ]);
      mockRequest.query = { page: '2', pageSize: '2' };

      await listOrderHistory(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      const body = jsonMock.mock.calls[0][0];
      expect(body.total).toBe(42);
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(2);
      expect(body.sessions.map((s: { id: string }[]) => s.map((o) => o.id))).toEqual([
        ['order-1', 'order-2'],
        ['order-3'],
      ]);
    });

    test('should cap pageSize at 100 and default invalid page to 1', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);
      mockRequest.query = { page: 'abc', pageSize: '5000' };

      await listOrderHistory(mockRequest as AuthedRequest, mockResponse as Response);

      const body = jsonMock.mock.calls[0][0];
      expect(body).toEqual({ sessions: [], total: 0, page: 1, pageSize: 100 });
      expect(prisma.orders.findMany).not.toHaveBeenCalled();
    });

    test('should key an open order by its own id, not its session', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ key: 'open-1' }])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);
      (prisma.orders.findMany as jest.Mock).mockResolvedValue([
        { id: 'open-1', session_id: 'session-9', closed_ts: null },
      ]);
      mockRequest.query = { status: 'all' };

      await listOrderHistory(mockRequest as AuthedRequest, mockResponse as Response);

      expect(jsonMock.mock.calls[0][0].sessions).toEqual([
        [{ id: 'open-1', session_id: 'session-9', closed_ts: null }],
      ]);
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await listOrderHistory(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('Order Stats', () => {
    test('should aggregate orders within the requested range', async () => {
      (prisma.orders.aggregate as jest.Mock).mockResolvedValue({
        _count: { _all: 3 },
        _sum: { total: 90 },
      });
      (prisma.orders.findMany as jest.Mock).mockResolvedValue([{ id: 'order-1' }]);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { item_id: 'dish-1', name: 'Pepsi', qty: BigInt(5), takings: 60 },
      ]);
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue({ ts: new Date(0) });
      mockRequest.query = { from: '1000', to: '2000' };

      await getOrderStats(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.aggregate).toHaveBeenCalledWith({
        where: { platform_id: 'platform-123', ts: { gte: new Date(1000), lte: new Date(2000) } },
        _count: { _all: true },
        _sum: { total: true },
      });
      expect(jsonMock).toHaveBeenCalledWith({
        orderCount: 3,
        takings: 90,
        recent: [{ id: 'order-1' }],
        bestsellers: [{ itemId: 'dish-1', name: 'Pepsi', qty: 5, takings: 60 }],
        oldestTs: new Date(0),
      });
    });

    test('should ignore an invalid range bound', async () => {
      (prisma.orders.aggregate as jest.Mock).mockResolvedValue({ _count: { _all: 0 }, _sum: { total: null } });
      (prisma.orders.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);
      mockRequest.query = { from: 'abc' };

      await getOrderStats(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { platform_id: 'platform-123' } }),
      );
      expect(jsonMock.mock.calls[0][0]).toMatchObject({ orderCount: 0, takings: 0, oldestTs: null });
    });
  });

  describe('Order Series', () => {
    test('should return bucketed orders and takings as numbers', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucket: '2026-09-26T09', orders: BigInt(3), takings: 36 },
      ]);
      mockRequest.query = { bucket: 'hour', from: '1000', to: '2000', tz: 'Europe/Madrid' };

      await getOrderSeries(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        series: [{ bucket: '2026-09-26T09', orders: 3, takings: 36 }],
      });
    });

    test('should accept year buckets', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucket: '2025-01-01T00', orders: BigInt(10), takings: 120 },
      ]);
      mockRequest.query = { bucket: 'year', from: '1000', to: '2000', tz: 'UTC' };

      await getOrderSeries(mockRequest as AuthedRequest, mockResponse as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        series: [{ bucket: '2025-01-01T00', orders: 10, takings: 120 }],
      });
    });

    test('should accept a time zone alias', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      mockRequest.query = { bucket: 'day', from: '1000', to: '2000', tz: 'Asia/Ho_Chi_Minh' };

      await getOrderSeries(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
    });

    test.each([
      [{ bucket: 'week', from: '1', to: '2' }, 'bucket must be one of hour, day, month, year'],
      [{ bucket: 'day', from: '1', to: '2', tz: 'Not/AZone' }, 'Unknown time zone'],
      [{ bucket: 'day', from: '1' }, 'from and to are required'],
    ])('should reject invalid params %j', async (query, error) => {
      mockRequest.query = query;

      await getOrderSeries(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('Get Order - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.params = { id: 'order-123' };
    });

    test('should return a specific order', async () => {
      const mockOrder = {
        id: 'order-123',
        platform_id: 'platform-123',
        order_lines: [],
      };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(mockOrder);

      await getOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ order: mockOrder });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await getOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'No platform found for this user' });
    });

    test('should return 404 if order not found', async () => {
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);

      await getOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Order not found' });
    });

    test('should verify platform ownership before returning order', async () => {
      const mockOrder = { id: 'order-123', platform_id: 'platform-123' };
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(mockOrder);

      await getOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-123', platform_id: 'platform-123' },
        include: { order_lines: true },
      });
    });

    test('should handle invalid order ID', async () => {
      mockRequest.params = { id: '' };
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);

      await getOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });
  });

  describe('Create Order - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.body = {
        tableName: 'Table 1',
        status: 'Pending',
        lines: [{ dishId: 'dish-1', quantity: 2 }],
      };
    });

    test('should create a new order successfully', async () => {
      const mockOrder = { id: 'new-order' };
      (orderPlacement.placeOrderForTable as jest.Mock).mockResolvedValue({
        order: mockOrder,
        created: true,
      });

      await createOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({ order: mockOrder });
    });

    test('should return 404 if no platform found', async () => {
      (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

      await createOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    test('should handle order placement errors', async () => {
      const error = new orderPlacement.OrderPlacementError(400, 'Invalid table');
      (orderPlacement.placeOrderForTable as jest.Mock).mockRejectedValue(error);

      await createOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid table' });
    });

    test('should handle missing request body', async () => {
      mockRequest.body = null;

      (orderPlacement.placeOrderForTable as jest.Mock).mockResolvedValue({
        order: {},
        created: true,
      });

      await createOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(orderPlacement.placeOrderForTable).toHaveBeenCalled();
    });

    test('should default lines to empty array if missing', async () => {
      mockRequest.body = { tableName: 'Table 1', status: 'Pending' };

      (orderPlacement.placeOrderForTable as jest.Mock).mockResolvedValue({
        order: {},
        created: true,
      });

      await createOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(orderPlacement.placeOrderForTable).toHaveBeenCalledWith(
        'platform-123',
        'Table 1',
        'Pending',
        []
      );
    });

    test('should return 200 if updating existing order', async () => {
      (orderPlacement.placeOrderForTable as jest.Mock).mockResolvedValue({
        order: { id: 'existing-order' },
        created: false,
      });

      await createOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
    });
  });

  describe('Update Order Status - Intensive Tests', () => {
    beforeEach(() => {
      mockRequest.params = { id: 'order-123' };
      mockRequest.body = { status: 'Paid' };
    });

    test('should update order status successfully', async () => {
      const existingOrder = { id: 'order-123', closed_ts: null };
      const updatedOrder = { id: 'order-123', status: 'Paid', closed_ts: new Date() };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue(updatedOrder);
      (socket.emitToPlatform as jest.Mock).mockResolvedValue(undefined);

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ order: updatedOrder });
    });

    test('should return 404 if order not found', async () => {
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Order not found' });
    });

    test('should return 400 if status is missing', async () => {
      mockRequest.body = {};
      const existingOrder = { id: 'order-123' };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'status is required' });
    });

    test('should return 400 if status is not a string', async () => {
      mockRequest.body = { status: 123 };
      const existingOrder = { id: 'order-123' };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should return 400 if status is empty string', async () => {
      mockRequest.body = { status: '   ' };
      const existingOrder = { id: 'order-123' };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    test('should close order when status is "Paid"', async () => {
      mockRequest.body = { status: 'Paid' };
      const existingOrder = { id: 'order-123', closed_ts: null };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue({});

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'Paid',
          closed_ts: expect.any(Date),
        },
        include: { order_lines: true },
      });
    });

    test('should not close order if already closed', async () => {
      mockRequest.body = { status: 'Paid' };
      const existingOrder = { id: 'order-123', closed_ts: new Date('2024-01-01') };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue({});

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'Paid',
        },
        include: { order_lines: true },
      });
    });

    test('should trim status value', async () => {
      mockRequest.body = { status: '  Paid  ' };
      const existingOrder = { id: 'order-123', closed_ts: null };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue({});

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'Paid',
          closed_ts: expect.any(Date),
        },
        include: { order_lines: true },
      });
    });

    test('should emit order updated event via socket', async () => {
      const existingOrder = { id: 'order-123', closed_ts: null };
      const updatedOrder = { id: 'order-123', status: 'Paid' };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue(updatedOrder);

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(socket.emitToPlatform).toHaveBeenCalledWith('platform-123', 'order:updated', {
        order: updatedOrder,
      });
    });

    test('should verify platform ownership before updating', async () => {
      const existingOrder = { id: 'order-123' };
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);

      mockRequest.params = { id: 'order-123' };

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-123', platform_id: 'platform-123' },
      });
    });
  });

  describe('Order Controller - Error Handling', () => {
    test('should handle Prisma errors in listOrders', async () => {
      (prisma.orders.findMany as jest.Mock).mockRejectedValue(
        new Error('Prisma error')
      );

      await expect(
        listOrders(mockRequest as AuthedRequest, mockResponse as Response)
      ).rejects.toThrow('Prisma error');
    });

    test('should handle socket emission errors', async () => {
      mockRequest.params = { id: 'order-123' };
      mockRequest.body = { status: 'Paid' };
      const existingOrder = { id: 'order-123' };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue({});
      (socket.emitToPlatform as jest.Mock).mockRejectedValue(
        new Error('Socket error')
      );

      await expect(
        updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response)
      ).rejects.toThrow('Socket error');
    });
  });

  describe('Order Controller - Edge Cases', () => {
    test('should handle very long order IDs', async () => {
      mockRequest.params = { id: 'a'.repeat(1000) };
      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(null);

      await getOrder(mockRequest as AuthedRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
    });

    test('should handle special characters in status', async () => {
      mockRequest.params = { id: 'order-123' };
      mockRequest.body = { status: '<script>alert("xss")</script>' };
      const existingOrder = { id: 'order-123', closed_ts: null };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue({});

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      expect(prisma.orders.update).toHaveBeenCalled();
    });

    test('should handle unicode characters in status', async () => {
      mockRequest.params = { id: 'order-123' };
      mockRequest.body = { status: 'Paid 🎉' };
      const existingOrder = { id: 'order-123', closed_ts: null };

      (prisma.orders.findFirst as jest.Mock).mockResolvedValue(existingOrder);
      (prisma.orders.update as jest.Mock).mockResolvedValue({});

      await updateOrderStatus(mockRequest as AuthedRequest, mockResponse as Response);

      // Only the exact "Paid" status closes an order.
      expect(prisma.orders.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'Paid 🎉',
        },
        include: { order_lines: true },
      });
    });
  });
});
