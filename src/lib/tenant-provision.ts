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
  /** Contact details and logo: from now on stored in the business's database. */
  profile: { phone: string | null; email: string | null; address: string | null; logo_url: string | null };
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
 * Whether a database can become this business's: "empty", or "ours" (this
 * business set it up before). Anything else throws, so a database with someone
 * else's tables is never written to. `platformId` is null before the business
 * exists, when only an empty database will do.
 */
async function inspectDatabase(client: Client, platformId: string | null): Promise<"empty" | "ours"> {
  const { rows } = await client.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  if (Number(rows[0]?.count ?? 0) === 0) return "empty";
  const owner = await client
    .query<{ platform_id: string }>('SELECT "platform_id" FROM "tenant_meta" LIMIT 1')
    .catch(() => ({ rows: [] as { platform_id: string }[] }));
  if (platformId && owner.rows[0]?.platform_id === platformId) return "ours";
  throw new ConnectionInputError(
    owner.rows.length
      ? "This database belongs to another business."
      : "This database already has tables. Use an empty database.",
  );
}

/**
 * Checks, without writing anything, that `provisionTenantDatabase` would
 * accept this database: it connects and is empty (or this business's own).
 */
export async function checkTenantDatabase(
  url: string,
  platformId: string | null,
  makeClient = defaultClient,
): Promise<void> {
  const client = await open(url, makeClient);
  try {
    await inspectDatabase(client, platformId);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Prepares a business's own database: creates every table, then records which
 * business it belongs to. An empty database is set up; one this business set
 * up before is accepted as is; anything else is refused (see inspectDatabase).
 */
export async function provisionTenantDatabase(
  url: string,
  platform: PlatformCopy,
  makeClient = defaultClient,
): Promise<{ created: boolean }> {
  const client = await open(url, makeClient);
  try {
    if ((await inspectDatabase(client, platform.id)) === "ours") {
      // Reconnecting a database this business set up before: bring its name
      // and profile up to date.
      await client.query(
        'UPDATE "platforms" SET "name" = $2, "phone" = $3, "email" = $4, "address" = $5, "logo_url" = $6 WHERE "id" = $1',
        [platform.id, platform.name, platform.profile.phone, platform.profile.email, platform.profile.address, platform.profile.logo_url],
      );
      return { created: false };
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
      await client.query(
        'INSERT INTO "platforms" ("id", "platform_type_id", "name", "phone", "email", "address", "logo_url") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          platform.id,
          platform.platform_types.id,
          platform.name,
          platform.profile.phone,
          platform.profile.email,
          platform.profile.address,
          platform.profile.logo_url,
        ],
      );
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

const PUSHER_TIMEOUT_MS = 10_000;
const PUSHER_ATTEMPTS = 2;

/** What went wrong talking to Pusher, in words the owner can act on. */
export function describePusherError(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; name?: string } };
  if (e?.status === 401 || e?.status === 403) {
    return "Pusher rejected these credentials. Check the key and secret.";
  }
  if (e?.status === 404) return "Pusher couldn't find this app. Check the app ID and cluster.";
  if (e?.status) return `Pusher answered with an error (${e.status}). Try again in a moment.`;
  const cause = e?.error?.name === "AbortError" ? "it took too long to answer" : describe(e?.error ?? err);
  return `Couldn't reach Pusher (${cause}). Check your internet connection and the cluster, then try again.`;
}

/**
 * Checks Pusher credentials with a real (read-only) API call. A network
 * failure is retried once; an answer from Pusher (e.g. 401) is not.
 */
export async function verifyPusher(
  creds: PusherCredentials,
  makePusher = (c: PusherCredentials) => new Pusher({ ...c, useTLS: true, timeout: PUSHER_TIMEOUT_MS }),
) {
  const pusher = makePusher(creds);
  for (let attempt = 1; ; attempt++) {
    try {
      await pusher.get({ path: "/channels" });
      return;
    } catch (err) {
      const answered = typeof (err as { status?: number })?.status === "number";
      if (answered || attempt >= PUSHER_ATTEMPTS) throw new ConnectionInputError(describePusherError(err));
    }
  }
}
