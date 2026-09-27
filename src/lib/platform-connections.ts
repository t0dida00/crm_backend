import prisma from "../config/prisma";
import { decrypt } from "./crypto";
import type { PusherCredentials, StorageConfig } from "./connection-input";

export interface ResolvedConnection {
  databaseUrl: string | null;
  pusher: PusherCredentials | null;
  storage: StorageConfig | null;
}

const NONE: ResolvedConnection = { databaseUrl: null, pusher: null, storage: null };
/** Other serverless instances pick up a changed connection within this long. */
const TTL_MS = 30_000;
const cache = new Map<string, { value: ResolvedConnection; expires: number }>();

/** Whether a business without its own database/Pusher/storage may use the shared ones. */
export const sharedInfraAllowed = () => process.env.ALLOW_SHARED_INFRA !== "false";

/** A business's decrypted database URL, Pusher credentials and storage (nulls = shared). Cached briefly. */
export async function getConnection(platformId: string): Promise<ResolvedConnection> {
  const hit = cache.get(platformId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const row = await prisma.platform_connections.findUnique({ where: { platform_id: platformId } });
  const value: ResolvedConnection = row
    ? {
        databaseUrl: row.database_url_enc ? decrypt(row.database_url_enc) : null,
        pusher:
          row.pusher_app_id && row.pusher_key && row.pusher_cluster && row.pusher_secret_enc
            ? {
                appId: row.pusher_app_id,
                key: row.pusher_key,
                cluster: row.pusher_cluster,
                secret: decrypt(row.pusher_secret_enc),
              }
            : null,
        storage: row.storage_config_enc ? (JSON.parse(decrypt(row.storage_config_enc)) as StorageConfig) : null,
      }
    : NONE;
  cache.set(platformId, { value, expires: Date.now() + TTL_MS });
  return value;
}

/** Drops this instance's cached connection after it changes. */
export function invalidateConnection(platformId: string) {
  cache.delete(platformId);
}

/**
 * The business's own Pusher key and cluster for browsers to subscribe with
 * (both are public). Null means the frontend uses the shared app from its env.
 */
export async function publicPusherConfig(platformId: string): Promise<{ key: string; cluster: string } | null> {
  const row = await prisma.platform_connections.findUnique({
    where: { platform_id: platformId },
    select: { pusher_key: true, pusher_cluster: true, pusher_secret_enc: true },
  });
  return row?.pusher_key && row.pusher_cluster && row.pusher_secret_enc
    ? { key: row.pusher_key, cluster: row.pusher_cluster }
    : null;
}

/** The name of the business's own database (e.g. "crm_platform_test"), or null
 * when it uses the shared one. Only the name: never the host or credentials. */
export async function databaseName(platformId: string): Promise<string | null> {
  const row = await prisma.platform_connections.findUnique({
    where: { platform_id: platformId },
    select: { database_label: true, database_url_enc: true },
  });
  if (!row?.database_url_enc || !row.database_label) return null;
  const name = row.database_label.split("/").pop();
  return name || null;
}
