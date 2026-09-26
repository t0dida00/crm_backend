import { Response } from 'express';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

export function createMockRequest(): Partial<AuthedRequest> {
  return {
    userId: 'test-user-123',
    body: {},
    params: {},
    query: {},
  };
}

export function createMockResponse(): Partial<Response> {
  const jsonMock = jest.fn().mockReturnValue({});
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });

  return {
    status: statusMock,
    json: jsonMock,
  };
}

export function getMockFunctions(response: Partial<Response>) {
  return {
    jsonMock: response.json as jest.Mock,
    statusMock: response.status as jest.Mock,
  };
}

export interface MockUser {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  is_active: boolean;
}

export const mockUsers = {
  validUser: {
    id: '1',
    email: 'test@example.com',
    full_name: 'Test User',
    password_hash: '$2b$10$hashedpassword',
    is_active: true,
  } as MockUser,
  inactiveUser: {
    id: '2',
    email: 'inactive@example.com',
    full_name: 'Inactive User',
    password_hash: '$2b$10$hashedpassword',
    is_active: false,
  } as MockUser,
  adminUser: {
    id: '3',
    email: 'admin@example.com',
    full_name: 'Admin User',
    password_hash: '$2b$10$hashedpassword',
    is_active: true,
  } as MockUser,
};

export interface MockTable {
  id: string;
  platform_id: string;
  name: string;
  seats: number;
  zone: string;
  state: string;
}

export const mockTables = {
  table1: {
    id: 'table-1',
    platform_id: 'platform-123',
    name: 'Table 1',
    seats: 4,
    zone: 'Zone A',
    state: 'Free',
  } as MockTable,
  table2: {
    id: 'table-2',
    platform_id: 'platform-123',
    name: 'Table 2',
    seats: 2,
    zone: 'Zone B',
    state: 'Occupied',
  } as MockTable,
};

export interface MockOrder {
  id: string;
  platform_id: string;
  status: string;
  closed_ts: Date | null;
  order_lines: any[];
}

export const mockOrders = {
  openOrder: {
    id: 'order-1',
    platform_id: 'platform-123',
    status: 'Pending',
    closed_ts: null,
    order_lines: [],
  } as MockOrder,
  closedOrder: {
    id: 'order-2',
    platform_id: 'platform-123',
    status: 'Paid',
    closed_ts: new Date(),
    order_lines: [],
  } as MockOrder,
};

export class TestHelper {
  static validateErrorResponse(
    statusMock: jest.Mock,
    jsonMock: jest.Mock,
    expectedStatus: number,
    expectedError: string
  ) {
    expect(statusMock).toHaveBeenCalledWith(expectedStatus);
    const callArgs = jsonMock.mock.calls[0][0];
    if (typeof expectedError === 'string') {
      expect(callArgs.error).toContain(expectedError);
    }
  }

  static validateSuccessResponse(
    statusMock: jest.Mock,
    jsonMock: jest.Mock,
    expectedStatus: number
  ) {
    expect(statusMock).toHaveBeenCalledWith(expectedStatus);
    expect(jsonMock).toHaveBeenCalled();
  }

  static getResponseData(jsonMock: jest.Mock): any {
    return jsonMock.mock.calls[0][0];
  }
}
