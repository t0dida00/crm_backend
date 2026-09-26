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

export async function putDatabase(req: AuthedRequest, res: Response) {
  const platformId = await requireOwner(req, res);
  if (!platformId) return;
  if (!canEncrypt()) return res.status(503).json(CREDENTIALS_UNAVAILABLE);

  try {
    const { url, label } = await checkDatabaseUrl(req.body?.url);
    const platform = await prisma.platforms.findUniqueOrThrow({
      where: { id: platformId },
      include: { platform_types: true },
    });
    await provisionTenantDatabase(url, platform);

    const data = {
      database_url_enc: encrypt(url),
      database_label: label,
      database_verified_at: new Date(),
      schema_version: TENANT_SCHEMA_VERSION,
      updated_at: new Date(),
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

export async function putPusher(req: AuthedRequest, res: Response) {
  const platformId = await requireOwner(req, res);
  if (!platformId) return;
  if (!canEncrypt()) return res.status(503).json(CREDENTIALS_UNAVAILABLE);

  try {
    const creds = checkPusherCredentials(req.body);
    await verifyPusher(creds);

    const data = {
      pusher_app_id: creds.appId,
      pusher_key: creds.key,
      pusher_cluster: creds.cluster,
      pusher_secret_enc: encrypt(creds.secret),
      pusher_verified_at: new Date(),
      updated_at: new Date(),
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
