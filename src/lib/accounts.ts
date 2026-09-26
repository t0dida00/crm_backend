import type { PrismaClient, User } from "@prisma/client";
import prisma from "../config/prisma";
import { tenantDb } from "../config/tenant-db";
import { getConnection } from "./platform-connections";

/**
 * Where accounts live:
 * - Owners, and staff of businesses on the shared database: central `users` /
 *   `platform_users`.
 * - Staff of a business that connected its own database: that database's
 *   `users` / `platform_users`, found through the central `staff_directory`.
 *
 * A business's own database is controlled by its owner, so nothing read from
 * it may choose the business or the role: the business always comes from the
 * directory, and accounts found there are always STAFF.
 */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function hasOwnDatabase(platformId: string): Promise<boolean> {
  return !!(await getConnection(platformId)).databaseUrl;
}

export interface Membership {
  platformId: string;
  role: string;
  isActive: boolean;
}

/** The business and role for a signed-in user id, from wherever the account lives. */
export async function findMembership(userId: string): Promise<Membership | null> {
  const central = await prisma.platform_users.findUnique({ where: { user_id: userId } });
  if (central) {
    // Staff left on the shared database after their business connected its
    // own: those accounts stop working (the owner recreates staff there).
    const stale = central.role === "STAFF" && (await hasOwnDatabase(central.platform_id));
    return { platformId: central.platform_id, role: central.role, isActive: central.is_active && !stale };
  }

  const entry = await prisma.staff_directory.findUnique({ where: { user_id: userId } });
  if (!entry) return null;
  const db = await tenantDb(entry.platform_id);
  const own = await db.platform_users.findUnique({ where: { user_id: userId } });
  if (!own) return null;
  return { platformId: entry.platform_id, role: "STAFF", isActive: own.is_active };
}

/** The account for a login email: a business database's staff first, then central. */
export async function findAccountByEmail(email: string): Promise<{ user: User; db: PrismaClient } | null> {
  const normalized = normalizeEmail(email);
  const entry = await prisma.staff_directory.findUnique({ where: { email: normalized } });
  if (entry) {
    const db = await tenantDb(entry.platform_id);
    const user = await db.user.findUnique({ where: { id: entry.user_id } });
    if (user) return { user, db };
  }
  const user = await prisma.user.findFirst({ where: { email: { equals: normalized, mode: "insensitive" } } });
  return user ? { user, db: prisma } : null;
}

/**
 * Whether an email can be used for a new or renamed account. `staleUserId` is
 * a leftover shared-database staff account of this business (see
 * findMembership) that the new account replaces; the caller deletes it.
 */
export async function checkEmailAvailable(
  email: string,
  { platformId, exceptUserId }: { platformId?: string; exceptUserId?: string } = {},
): Promise<{ available: boolean; staleUserId?: string }> {
  const normalized = normalizeEmail(email);
  const entry = await prisma.staff_directory.findUnique({ where: { email: normalized } });
  if (entry && entry.user_id !== exceptUserId) return { available: false };

  const central = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" }, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    include: { platform_users: true },
  });
  if (!central) return { available: true };

  const membership = central.platform_users;
  const replaceable =
    !!platformId &&
    membership?.platform_id === platformId &&
    membership.role === "STAFF" &&
    (await hasOwnDatabase(platformId));
  return replaceable ? { available: true, staleUserId: central.id } : { available: false };
}
