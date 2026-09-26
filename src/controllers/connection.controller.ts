import { Response } from "express";
import type { platform_connections } from "@prisma/client";
import prisma from "../config/prisma";
import { AuthedRequest } from "../middleware/auth.middleware";
import { resolvePlatformMembership } from "../lib/platform-context";
import { canEncrypt, encrypt } from "../lib/crypto";
import {
  checkDatabaseUrl,
  checkPusherCredentials,
  ConnectionInputError,
} from "../lib/connection-input";
import {
  provisionTenantDatabase,
  testDatabase,
  TENANT_SCHEMA_VERSION,
  verifyPusher,
} from "../lib/tenant-provision";
import { getConnection, invalidateConnection, sharedInfraAllowed } from "../lib/platform-connections";

/** What the owner sees: never the database URL or the Pusher secret. */
export function toPublicConnections(row: platform_connections | null) {
  return {
    database:
      row?.database_url_enc && row.database_label
        ? { label: row.database_label, verifiedAt: row.database_verified_at }
        : null,
    pusher:
      row?.pusher_app_id && row.pusher_key && row.pusher_cluster && row.pusher_secret_enc
        ? { appId: row.pusher_app_id, key: row.pusher_key, cluster: row.pusher_cluster, verifiedAt: row.pusher_verified_at }
        : null,
    sharedInfraAllowed: sharedInfraAllowed(),
    canStoreCredentials: canEncrypt(),
  };
}

/** Resolves the caller's platform, or answers 404/403 itself and returns null. */
async function requireOwner(req: AuthedRequest, res: Response): Promise<string | null> {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (!membership) {
    res.status(404).json({ error: "No platform found for this user" });
    return null;
  }
  if (membership.role !== "OWNER") {
    res.status(403).json({ error: "Only the owner can manage connections" });
    return null;
  }
  return membership.platformId;
}

const CREDENTIALS_UNAVAILABLE = { error: "The server can't store credentials yet: CREDENTIALS_KEY isn't set." };

export async function getConnections(req: AuthedRequest, res: Response) {
  const platformId = await requireOwner(req, res);
  if (!platformId) return;
  const row = await prisma.platform_connections.findUnique({ where: { platform_id: platformId } });
  return res.status(200).json(toPublicConnections(row));
}

/**
 * Connects the business's own database and Pusher app together. Both are
 * checked before either is saved (Pusher first: it has no side effects; then
 * the database is connected and set up), so a failure never leaves one saved
 * without the other.
 */
export async function putConnections(req: AuthedRequest, res: Response) {
  const platformId = await requireOwner(req, res);
  if (!platformId) return;
  if (!canEncrypt()) return res.status(503).json(CREDENTIALS_UNAVAILABLE);

  try {
    const { url, label } = await checkDatabaseUrl(req.body?.databaseUrl);
    const pusher = checkPusherCredentials(req.body?.pusher);
    await verifyPusher(pusher);

    const platform = await prisma.platforms.findUniqueOrThrow({
      where: { id: platformId },
      include: { platform_types: true },
    });
    await provisionTenantDatabase(url, platform);

    const now = new Date();
    const data = {
      database_url_enc: encrypt(url),
      database_label: label,
      database_verified_at: now,
      schema_version: TENANT_SCHEMA_VERSION,
      pusher_app_id: pusher.appId,
      pusher_key: pusher.key,
      pusher_cluster: pusher.cluster,
      pusher_secret_enc: encrypt(pusher.secret),
      pusher_verified_at: now,
      updated_at: now,
    };
    const row = await prisma.platform_connections.upsert({
      where: { platform_id: platformId },
      create: { platform_id: platformId, ...data },
      update: data,
    });
    invalidateConnection(platformId);
    return res.status(200).json(toPublicConnections(row));
  } catch (err) {
    if (err instanceof ConnectionInputError) return res.status(400).json({ error: err.message });
    throw err;
  }
}

/** Re-checks the saved connections: `{ ok }` per service, or null when it isn't connected. */
export async function testConnections(req: AuthedRequest, res: Response) {
  const platformId = await requireOwner(req, res);
  if (!platformId) return;

  invalidateConnection(platformId);
  const { databaseUrl, pusher } = await getConnection(platformId);
  const check = async (run: () => Promise<void>) => {
    try {
      await run();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Check failed" };
    }
  };

  return res.status(200).json({
    database: databaseUrl ? await check(() => testDatabase(databaseUrl)) : null,
    pusher: pusher ? await check(() => verifyPusher(pusher)) : null,
  });
}
