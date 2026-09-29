/** Bump when TENANT_INIT_SQL changes in a way existing business databases need upgrading for,
 * and add that version's statements to TENANT_UPGRADES. */
export const TENANT_SCHEMA_VERSION = 2;

/**
 * What takes a business database from the previous version to each version.
 * Every statement must be safe to run twice: an upgrade interrupted before its
 * version is recorded runs again. Keep in step with the central migrations.
 */
export const TENANT_UPGRADES: Record<number, string[]> = {
  // 20260930000000_category_sort_order
  2: [
    'ALTER TABLE "menu_categories" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0',
    `UPDATE "menu_categories" c SET "sort_order" = r.pos FROM (
       SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "platform_id" ORDER BY "name") - 1)::int AS pos
       FROM "menu_categories"
     ) r WHERE c."id" = r."id"`,
  ],
};

/** The raw-query part of a Prisma client that an upgrade needs. */
export interface RawDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/**
 * Brings a business's own database up to TENANT_SCHEMA_VERSION, one version at
 * a time, recording each in tenant_meta. A database without tenant_meta wasn't
 * set up by us and is left alone.
 */
export async function upgradeTenantSchema(db: RawDb): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ schema_version: number }[]>(
    'SELECT "schema_version" FROM "tenant_meta" LIMIT 1',
  );
  if (!rows.length) return;
  for (let version = Number(rows[0].schema_version) + 1; version <= TENANT_SCHEMA_VERSION; version++) {
    for (const sql of TENANT_UPGRADES[version] ?? []) await db.$executeRawUnsafe(sql);
    await db.$executeRawUnsafe('UPDATE "tenant_meta" SET "schema_version" = $1', version);
  }
}
