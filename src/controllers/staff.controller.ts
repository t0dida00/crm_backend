import { Response } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import prisma from "../config/prisma";
import { tenantDb } from "../config/tenant-db";
import { checkEmailAvailable, hasOwnDatabase, normalizeEmail } from "../lib/accounts";
import { resolvePlatformMembership } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

const MAX_STAFF_PER_PLATFORM = 5;

// Staff accounts live with the business's other data: its own database once
// connected (plus a central staff_directory entry so login can find them),
// otherwise the shared database. tenantDb() returns the right one.

async function requireOwner(req: AuthedRequest) {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (!membership || membership.role !== "OWNER") return null;
  return membership;
}

const toStaffRecord = (pu: {
  id: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  users: { id: string; email: string | null; phone: string | null; full_name: string; is_active: boolean };
}) => ({
  id: pu.id,
  userId: pu.users.id,
  email: pu.users.email,
  phone: pu.users.phone,
  fullName: pu.users.full_name,
  role: pu.role,
  isActive: pu.is_active,
  createdAt: pu.created_at,
});

export async function listStaff(req: AuthedRequest, res: Response) {
  const membership = await requireOwner(req);
  if (!membership) return res.status(403).json({ error: "Owner access required" });

  const db = await tenantDb(membership.platformId);
  const platformUsers = await db.platform_users.findMany({
    where: { platform_id: membership.platformId, role: "STAFF" },
    include: { users: true },
    orderBy: { created_at: "asc" },
  });

  return res.status(200).json({
    staff: platformUsers.map(toStaffRecord),
    limit: MAX_STAFF_PER_PLATFORM,
  });
}

export async function createStaff(req: AuthedRequest, res: Response) {
  const membership = await requireOwner(req);
  if (!membership) return res.status(403).json({ error: "Owner access required" });

  const db = await tenantDb(membership.platformId);
  const ownDatabase = await hasOwnDatabase(membership.platformId);
  const staffCount = await db.platform_users.count({
    where: { platform_id: membership.platformId, role: "STAFF" },
  });
  if (staffCount >= MAX_STAFF_PER_PLATFORM) {
    return res.status(409).json({
      error: `Maximum of ${MAX_STAFF_PER_PLATFORM} staff accounts reached. Remove an existing account to add a new one.`,
    });
  }

  const { email, password, fullName, phone } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "fullName is required" });
  }
  if (phone !== undefined && typeof phone !== "string") {
    return res.status(400).json({ error: "phone must be a string" });
  }

  const { available, staleUserId } = await checkEmailAvailable(email, { platformId: membership.platformId });
  if (!available) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const userId = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const password_hash = await bcrypt.hash(password, 10);
  const create = () =>
    db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: userId,
          email: normalizedEmail,
          password_hash,
          full_name: fullName.trim(),
          phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
          is_active: true,
        },
      });
      return tx.platform_users.create({
        data: { platform_id: membership.platformId, user_id: user.id, role: "STAFF", is_active: true },
        include: { users: true },
      });
    });

  if (!ownDatabase) {
    return res.status(201).json({ staff: toStaffRecord(await create()) });
  }

  // The account left on the shared database when the business moved is
  // replaced by this one.
  if (staleUserId) await prisma.user.delete({ where: { id: staleUserId } });
  // Reserve the email centrally first, so two businesses can't take it at once.
  await prisma.staff_directory.create({
    data: { email: normalizedEmail, user_id: userId, platform_id: membership.platformId },
  });
  try {
    return res.status(201).json({ staff: toStaffRecord(await create()) });
  } catch (err) {
    await prisma.staff_directory.delete({ where: { user_id: userId } }).catch(() => {});
    throw err;
  }
}

export async function updateStaff(req: AuthedRequest, res: Response) {
  const membership = await requireOwner(req);
  if (!membership) return res.status(403).json({ error: "Owner access required" });

  const { id } = req.params;
  const db = await tenantDb(membership.platformId);
  const existing = await db.platform_users.findFirst({
    where: { id, platform_id: membership.platformId, role: "STAFF" },
    include: { users: true },
  });
  if (!existing) return res.status(404).json({ error: "Staff account not found" });

  const { fullName, email, phone, password, isActive } = req.body ?? {};
  if (fullName !== undefined && (typeof fullName !== "string" || !fullName.trim())) {
    return res.status(400).json({ error: "fullName cannot be empty" });
  }
  if (email !== undefined && (typeof email !== "string" || !email.trim())) {
    return res.status(400).json({ error: "email cannot be empty" });
  }
  if (phone !== undefined && typeof phone !== "string") {
    return res.status(400).json({ error: "phone must be a string" });
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (isActive !== undefined && typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive must be a boolean" });
  }

  const ownDatabase = await hasOwnDatabase(membership.platformId);
  if (email !== undefined) {
    const { available } = await checkEmailAvailable(email, { exceptUserId: existing.users.id });
    if (!available) return res.status(409).json({ error: "An account with this email already exists" });
    if (ownDatabase) {
      await prisma.staff_directory.update({
        where: { user_id: existing.users.id },
        data: { email: normalizeEmail(email) },
      });
    }
  }

  const result = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.users.id },
      data: {
        ...(typeof fullName === "string" ? { full_name: fullName.trim() } : {}),
        ...(typeof email === "string" ? { email: ownDatabase ? normalizeEmail(email) : email.trim() } : {}),
        ...(typeof phone === "string" ? { phone: phone.trim() || null } : {}),
        ...(typeof password === "string" ? { password_hash: await bcrypt.hash(password, 10) } : {}),
      },
    });
    return tx.platform_users.update({
      where: { id },
      data: { ...(typeof isActive === "boolean" ? { is_active: isActive } : {}) },
      include: { users: true },
    });
  });

  return res.status(200).json({ staff: toStaffRecord(result) });
}
