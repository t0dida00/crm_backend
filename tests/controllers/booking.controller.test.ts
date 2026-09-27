import { Response } from 'express';
import { AuthedRequest } from '../../src/middleware/auth.middleware';
import { createBooking } from '../../src/controllers/booking.controller';
import prisma from '../../src/config/prisma';
import * as platformContext from '../../src/lib/platform-context';

// Business data goes through tenantDb(); in tests it's the same mocked client.
jest.mock('../../src/config/tenant-db', () => ({
  tenantDb: async () => jest.requireMock('../../src/config/prisma').default,
}));
jest.mock('../../src/config/prisma', () => ({
  __esModule: true,
  default: {
    bookings: { create: jest.fn() },
  },
}));
jest.mock('../../src/lib/platform-context');

describe('Booking Controller - createBooking', () => {
  let mockRequest: Partial<AuthedRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    jsonMock = jest.fn().mockReturnValue({});
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockRequest = { userId: 'user-123', body: {}, params: {}, query: {} };
    mockResponse = { status: statusMock, json: jsonMock };
    (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue('platform-123');
    (prisma.bookings.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: 'b1', ...data }));
  });

  const create = (body: Record<string, unknown>) => {
    mockRequest.body = body;
    return createBooking(mockRequest as AuthedRequest, mockResponse as Response);
  };

  test('stores the given calendar date as UTC midnight', async () => {
    await create({ name: ' Khoa ', time: '19:15', party: 2, date: '2026-09-30' });

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(prisma.bookings.create).toHaveBeenCalledWith({
      data: {
        platform_id: 'platform-123',
        name: 'Khoa',
        time: '19:15',
        party: 2,
        date: new Date('2026-09-30T00:00:00.000Z'),
      },
    });
  });

  test("defaults to today's UTC date when no date is sent", async () => {
    await create({ name: 'Khoa', time: '19:00', party: 2 });

    const { date } = (prisma.bookings.create as jest.Mock).mock.calls[0][0].data;
    expect(date.toISOString()).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  });

  test.each([
    [{ name: '', time: '19:00', party: 2 }, 'name is required'],
    [{ name: 'Khoa', time: '7pm', party: 2 }, 'time must be HH:MM'],
    [{ name: 'Khoa', time: '24:00', party: 2 }, 'time must be HH:MM'],
    [{ name: 'Khoa', time: '19:00', party: 0 }, 'party must be a whole number from 1'],
    [{ name: 'Khoa', time: '19:00', party: 2.5 }, 'party must be a whole number from 1'],
    [{ name: 'Khoa', time: '19:00', party: 2, date: '30/09/2026' }, 'date must be YYYY-MM-DD'],
    [{ name: 'Khoa', time: '19:00', party: 2, date: '2026-02-30' }, 'date must be YYYY-MM-DD'],
    [{ name: 'Khoa', time: '19:00', party: 2, date: 20260930 }, 'date must be YYYY-MM-DD'],
  ])('rejects %j', async (body, error) => {
    await create(body);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error });
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  const utcDay = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  test('rejects a past date', async () => {
    await create({ name: 'Khoa', time: '19:00', party: 2, date: utcDay(-2) });

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Bookings can't be made for a past date" });
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  test("accepts yesterday in UTC (a client's today west of UTC) and future dates", async () => {
    await create({ name: 'Khoa', time: '19:00', party: 2, date: utcDay(-1) });
    await create({ name: 'Khoa', time: '19:00', party: 2, date: utcDay(30) });

    expect(prisma.bookings.create).toHaveBeenCalledTimes(2);
  });

  test('returns 404 without a platform', async () => {
    (platformContext.resolvePlatformId as jest.Mock).mockResolvedValue(null);

    await create({ name: 'Khoa', time: '19:00', party: 2 });

    expect(statusMock).toHaveBeenCalledWith(404);
  });
});
