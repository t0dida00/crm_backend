import { provisionTenantDatabase } from '../../src/lib/tenant-provision';

const platform = { id: 'p1', name: 'Casa', platform_types: { id: 't1', code: 'CAFE', name: 'Cafe' } };

/** A pg Client stand-in: answers queries by matching SQL text. */
function fakeClient(answers: { tables: number; owner?: string; failOn?: RegExp; connectError?: Error }) {
  const queries: string[] = [];
  const client = {
    connect: jest.fn(async () => {
      if (answers.connectError) throw answers.connectError;
    }),
    end: jest.fn(async () => {}),
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (answers.failOn?.test(sql)) throw new Error('boom');
      if (sql.includes('information_schema.tables')) return { rows: [{ count: String(answers.tables) }] };
      if (sql.includes('FROM "tenant_meta"')) {
        if (answers.owner === undefined) throw new Error('relation "tenant_meta" does not exist');
        return { rows: [{ platform_id: answers.owner }] };
      }
      return { rows: [] };
    }),
  };
  return { client, queries, make: () => client as never };
}

describe('provisionTenantDatabase', () => {
  it('sets up an empty database in one transaction and marks its owner', async () => {
    const { client, queries, make } = fakeClient({ tables: 0 });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).resolves.toEqual({ created: true });
    expect(queries[2]).toBe('BEGIN');
    expect(queries[3]).toContain('CREATE TABLE "menu_items"');
    expect(queries.some((q) => q.includes('INSERT INTO "tenant_meta"'))).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(client.end).toHaveBeenCalled();
  });

  it('accepts a database this business already set up', async () => {
    const { queries, make } = fakeClient({ tables: 16, owner: 'p1' });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).resolves.toEqual({ created: false });
    expect(queries).not.toContain('BEGIN');
  });

  it("refuses another business's database", async () => {
    const { make } = fakeClient({ tables: 16, owner: 'p2' });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(/another business/);
  });

  it('refuses a database that already has unrelated tables', async () => {
    const { make } = fakeClient({ tables: 3 });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(/already has tables/);
  });

  it('rolls back when setup fails', async () => {
    const { queries, make } = fakeClient({ tables: 0, failOn: /INSERT INTO "platforms"/ });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(/Couldn't set up/);
    expect(queries.at(-1)).toBe('ROLLBACK');
  });

  it('explains a connection failure', async () => {
    const { client, make } = fakeClient({ tables: 0, connectError: new Error('password authentication failed') });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(
      "Couldn't connect to the database: password authentication failed",
    );
    expect(client.end).toHaveBeenCalled();
  });
});
