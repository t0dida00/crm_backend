jest.mock('../../src/realtime/socket', () => ({ emitToPlatform: jest.fn() }));
const mockDb = {
  tables: { findFirst: jest.fn() },
  table_sessions: { findFirst: jest.fn(), create: jest.fn() },
  menu_items: { findMany: jest.fn() },
  platform_preferences: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../../src/config/tenant-db', () => ({ tenantDb: async () => mockDb }));

import { emitToPlatform } from '../../src/realtime/socket';
import { placeOrderForTable } from '../../src/lib/order-placement';

const tx = {
  $queryRaw: jest.fn(),
  tables: { update: jest.fn() },
  orders: { create: jest.fn() },
};

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.table_sessions.findFirst.mockResolvedValue({ id: 's1' });
  mockDb.menu_items.findMany.mockResolvedValue([{ id: 'd1', name: 'Cola', price: 3 }]);
  mockDb.platform_preferences.findUnique.mockResolvedValue({ common_tax_rate: 0 });
  mockDb.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.$queryRaw.mockResolvedValue([{ max: null }]);
  tx.orders.create.mockResolvedValue({ id: 'o1', code: 'ORD-2401', order_lines: [] });
  tx.tables.update.mockResolvedValue({ id: 't1', name: 'Table 3', state: 'Seated' });
});

const place = () => placeOrderForTable('p1', 'Table 3', 'Received', [{ itemId: 'd1', qty: 1 }]);

describe('placeOrderForTable real-time events', () => {
  it('announces the order and, when it seats the table, the seated table', async () => {
    mockDb.tables.findFirst.mockResolvedValue({ id: 't1', name: 'Table 3', state: 'Free' });
    await place();
    expect(emitToPlatform).toHaveBeenCalledWith('p1', 'order:created', { order: expect.objectContaining({ id: 'o1' }) });
    expect(emitToPlatform).toHaveBeenCalledWith('p1', 'table:updated', {
      table: { id: 't1', name: 'Table 3', state: 'Seated' },
    });
  });

  it("doesn't announce the table when it was already seated", async () => {
    mockDb.tables.findFirst.mockResolvedValue({ id: 't1', name: 'Table 3', state: 'Seated' });
    await place();
    expect(tx.tables.update).not.toHaveBeenCalled();
    expect(emitToPlatform).toHaveBeenCalledTimes(1);
    expect(emitToPlatform).toHaveBeenCalledWith('p1', 'order:created', expect.anything());
  });
});
