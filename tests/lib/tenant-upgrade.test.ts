import { RawDb, TENANT_SCHEMA_VERSION, TENANT_UPGRADES, upgradeTenantSchema } from '../../src/lib/tenant-upgrade';

const fakeDb = (version: number | null) => {
  const mocks = {
    $queryRawUnsafe: jest.fn<Promise<unknown>, unknown[]>(async () => (version === null ? [] : [{ schema_version: version }])),
    $executeRawUnsafe: jest.fn<Promise<number>, unknown[]>(async () => 0),
  };
  return mocks as typeof mocks & RawDb;
};

describe('upgradeTenantSchema', () => {
  it('runs each missing version in order and records it', async () => {
    const db = fakeDb(1);
    await upgradeTenantSchema(db);
    const sql = db.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(sql.slice(0, TENANT_UPGRADES[2].length)).toEqual(TENANT_UPGRADES[2]);
    expect(db.$executeRawUnsafe).toHaveBeenLastCalledWith('UPDATE "tenant_meta" SET "schema_version" = $1', TENANT_SCHEMA_VERSION);
  });

  it('does nothing on a database that is up to date', async () => {
    const db = fakeDb(TENANT_SCHEMA_VERSION);
    await upgradeTenantSchema(db);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('leaves a database without tenant_meta alone', async () => {
    const db = fakeDb(null);
    await upgradeTenantSchema(db);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('adds the category order column idempotently', () => {
    expect(TENANT_UPGRADES[2][0]).toMatch(/ADD COLUMN IF NOT EXISTS "sort_order"/);
  });
});
