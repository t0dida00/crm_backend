import { Response } from "express";
import type { platform_connections } from "@prisma/client";
import prisma from "../config/prisma";
import { AuthedRequest } from "../middleware/auth.middleware";
import { resolvePlatformMembership } from "../lib/platform-context";
import { canEncrypt, encrypt } from "../lib/crypto";
import {
  checkDatabaseUrl,
  checkPusherCredentials,
  checkStorageConfig,
  ConnectionInputError,
  storageLabel,
} from "../lib/connection-input";
import { verifyStorage } from "../lib/storage";
import {
  checkTenantDatabase,
  provisionTenantDatabase,
  testDatabase,
  TENANT_SCHEMA_VERSION,
  verifyPusher,
} from "../lib/tenant-provision";
import { getConnection, invalidateConnection, sharedInfraAllowed } from "../lib/platform-connections";
import { EMPTY_PROFILE, readProfile } from "../lib/business-profile";

/** What the owner sees: never the database URL, the Pusher secret or storage keys. */
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
    storage:
      row?.storage_config_enc && row.storage_provider && row.storage_label
        ? { provider: row.storage_provider, label: row.storage_label, verifiedAt: row.storage_verified_at }
        : null,
    sharedInfraAllowed: sharedInfraAllowed(),
    canStoreCredentials: canEncrypt(),
  };
}

const NOT_OWNER = { error: "Only the owner can manage connections" };

/** Resolves the caller's platform, or answers 404/403 itself and returns null. */
async function requireOwner(req: AuthedRequest, res: Response): Promise<string | null> {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (!membership) {
    res.status(404).json({ error: "No platform found for this user" });
    return null;
  }
  if (membership.role !== "OWNER") {
    res.status(403).json(NOT_OWNER);
    return null;
  }
  return membership.platformId;
}

/**
 * Like requireOwner, but also lets through a new owner who hasn't created
 * their business yet (onboarding asks for connections first): `{ platformId:
 * null }`. Answers 403 itself for staff and returns null.
 */
async function requireOwnerOrNewUser(req: AuthedRequest, res: Response): Promise<{ platformId: string | null } | null> {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (membership && membership.role !== "OWNER") {
    res.status(403).json(NOT_OWNER);
    return null;
  }
  return { platformId: membership?.platformId ?? null };
}

/** Validates the PUT/check body's shape: `{ databaseUrl, pusher, storage }`. Throws ConnectionInputError. */
async function readConnectionsInput(body: Record<string, unknown> | undefined) {
  const database = await checkDatabaseUrl(body?.databaseUrl);
  const pusher = checkPusherCredentials(body?.pusher);
  const storage = await checkStorageConfig(body?.storage);
  return { database, pusher, storage };
}

const CREDENTIALS_UNAVAILABLE = { error: "The server can't store credentials yet: CREDENTIALS_KEY isn't set." };

/** What's connected. Before the business exists, nothing is (but the server's options still apply). */
export async function getConnections(req: AuthedRequest, res: Response) {
  const caller = await requireOwnerOrNewUser(req, res);
  if (!caller) return;
  const row = caller.platformId
    ? await prisma.platform_connections.findUnique({ where: { platform_id: caller.platformId } })
    : null;
  return res.status(200).json(toPublicConnections(row));
}

/**
 * Runs every check PUT does (Pusher, storage's test file, and that the
 * database connects and is empty, or already this business's) but saves and
 * sets up nothing. Onboarding uses it before the business exists; the PUT
 * that follows checks everything again.
 */
export async function checkConnections(req: AuthedRequest, res: Response) {
  const caller = await requireOwnerOrNewUser(req, res);
  if (!caller) return;
  try {
    const { database, pusher, storage } = await readConnectionsInput(req.body);
    await verifyPusher(pusher);
    await verifyStorage(storage);
    await checkTenantDatabase(database.url, caller.platformId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof ConnectionInputError) return res.status(400).json({ error: err.message });
    throw err;
  }
}

/**
 * Connects the business's own database, Pusher app and image storage
 * together. All three are checked before any is saved (Pusher first: it has
 * no side effects; then storage, whose test file is deleted again; then the
 * database is connected and set up), so a failure never leaves one saved
 * without the others.
 */
export async function putConnections(req: AuthedRequest, res: Response) {
  const platformId = await requireOwner(req, res);
  if (!platformId) return;
  if (!canEncrypt()) return res.status(503).json(CREDENTIALS_UNAVAILABLE);

  try {
    const {
      database: { url, label },
      pusher,
      storage,
    } = await readConnectionsInput(req.body);
    await verifyPusher(pusher);
    await verifyStorage(storage);

    const platform = await prisma.platforms.findUniqueOrThrow({
      where: { id: platformId },
      include: { platform_types: true },
    });
    // The profile moves with the business's data, from wherever it is now.
    const profile = await readProfile(platformId);
    await provisionTenantDatabase(url, { ...platform, profile });

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
      storage_provider: storage.provider,
      storage_label: storageLabel(storage),
      storage_config_enc: encrypt(JSON.stringify(storage)),
      storage_verified_at: now,
      updated_at: now,
    };
    const row = await prisma.platform_connections.upsert({
      where: { platform_id: platformId },
      create: { platform_id: platformId, ...data },
      update: data,
    });
    invalidateConnection(platformId);
    // The central row keeps only what's needed to find the business.
    await prisma.platforms.update({ where: { id: platformId }, data: EMPTY_PROFILE });
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
  const { databaseUrl, pusher, storage } = await getConnection(platformId);
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
    storage: storage ? await check(() => verifyStorage(storage)) : null,
  });
}
