import { Client } from "pg";
import Pusher from "pusher";
import { TENANT_INIT_SQL } from "../generated/tenant-init-sql";
import { ConnectionInputError, type PusherCredentials } from "./connection-input";

/** Bump when TENANT_INIT_SQL changes in a way existing business databases need upgrading for. */
export const TENANT_SCHEMA_VERSION = 1;

const CONNECT_TIMEOUT_MS = 5000;

interface PlatformCopy {
  id: string;
  name: string;
  platform_types: { id: string; code: string; name: string };
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Opens a pg connection with a short timeout, mapping failures to a message the owner can act on. */
async function open(url: string, makeClient: (url: string) => Client): Promise<Client> {
  const client = makeClient(url);
  try {
    await client.connect();
    await client.query("SELECT 1");
    return client;
  } catch (err) {
    await client.end().catch(() => {});
    throw new ConnectionInputError(`Couldn't connect to the database: ${describe(err)}`);
  }
}

const defaultClient = (url: string) =>
  new Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: 30_000 });

/** Connects and runs `SELECT 1`; throws ConnectionInputError if it can't. */
export async function testDatabase(url: string, makeClient = defaultClient): Promise<void> {
  const client = await open(url, makeClient);
  await client.end().catch(() => {});
}

/**
 * Prepares a business's own database: creates every table, then records which
 * business it belongs to. An empty database is set up; one this business set
 * up before is accepted as is; anything else is refused, so a database with
 * someone else's tables is never written to.
 */
export async function provisionTenantDatabase(
  url: string,
  platform: PlatformCopy,
  makeClient = defaultClient,
): Promise<{ created: boolean }> {
  const client = await open(url, makeClient);
  try {
    const { rows } = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    if (Number(rows[0]?.count ?? 0) > 0) {
      const owner = await client
        .query<{ platform_id: string }>('SELECT "platform_id" FROM "tenant_meta" LIMIT 1')
        .catch(() => ({ rows: [] as { platform_id: string }[] }));
      if (owner.rows[0]?.platform_id === platform.id) return { created: false };
      throw new ConnectionInputError(
        owner.rows.length
          ? "This database belongs to another business."
          : "This database already has tables. Use an empty database.",
      );
    }

    try {
      await client.query("BEGIN");
      await client.query(TENANT_INIT_SQL);
      // A copy of the business's own rows, so foreign keys to them hold.
      await client.query('INSERT INTO "platform_types" ("id", "code", "name") VALUES ($1, $2, $3)', [
        platform.platform_types.id,
        platform.platform_types.code,
        platform.platform_types.name,
      ]);
      await client.query('INSERT INTO "platforms" ("id", "platform_type_id", "name") VALUES ($1, $2, $3)', [
        platform.id,
        platform.platform_types.id,
        platform.name,
      ]);
      await client.query('INSERT INTO "tenant_meta" ("platform_id", "schema_version") VALUES ($1, $2)', [
        platform.id,
        TENANT_SCHEMA_VERSION,
      ]);
      await client.query("COMMIT");
      return { created: true };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new ConnectionInputError(`Couldn't set up the database: ${describe(err)}`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

/** Checks Pusher credentials with a real (read-only) API call. */
export async function verifyPusher(creds: PusherCredentials, makePusher = (c: PusherCredentials) => new Pusher({ ...c, useTLS: true, timeout: CONNECT_TIMEOUT_MS })) {
  try {
    await makePusher(creds).get({ path: "/channels" });
  } catch (err) {
    throw new ConnectionInputError(`Pusher rejected these credentials: ${describe(err)}`);
  }
}
