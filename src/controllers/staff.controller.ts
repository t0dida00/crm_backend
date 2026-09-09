import { Response } from "express";
import bcrypt from "bcrypt";
import prisma from "../config/prisma";
import { resolvePlatformMembership } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

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
  users: { id: string; email: string | null; full_name: string; is_active: boolean };
}) => ({
  id: pu.id,
  userId: pu.users.id,
  email: pu.users.email,
  fullName: pu.users.full_name,
  role: pu.role,
  isActive: pu.is_active,
  createdAt: pu.created_at,
});

export async function listStaff(req: AuthedRequest, res: Response) {
  const membership = await requireOwner(req);
  if (!membership) return res.status(403).json({ error: "Owner access required" });

  const platformUsers = await prisma.platform_users.findMany({
    where: { platform_id: membership.platformId, role: "STAFF" },
    include: { users: true },
    orderBy: { created_at: "asc" },
  });

  return res.status(200).json({ staff: platformUsers.map(toStaffRecord) });
}

export async function createStaff(req: AuthedRequest, res: Response) {
  const membership = await requireOwner(req);
  if (!membership) return res.status(403).json({ error: "Owner access required" });

  const { email, password, fullName } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ error: "email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "fullName is required" });
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
  });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: email.trim(), password_hash, full_name: fullName.trim(), is_active: true },
    });
    return tx.platform_users.create({
      data: { platform_id: membership.platformId, user_id: user.id, role: "STAFF", is_active: true },
      include: { users: true },
    });
  });

  return res.status(201).json({ staff: toStaffRecord(result) });
}

export async function updateStaff(req: AuthedRequest, res: Response) {
  const membership = await requireOwner(req);
  if (!membership) return res.status(403).json({ error: "Owner access required" });

  const { id } = req.params;
  const existing = await prisma.platform_users.findFirst({
    where: { id, platform_id: membership.platformId, role: "STAFF" },
    include: { users: true },
  });
  if (!existing) return res.status(404).json({ error: "Staff account not found" });

  const { fullName, email, password, isActive } = req.body ?? {};
  if (fullName !== undefined && (typeof fullName !== "string" || !fullName.trim())) {
    return res.status(400).json({ error: "fullName cannot be empty" });
  }
  if (email !== undefined && (typeof email !== "string" || !email.trim())) {
    return res.status(400).json({ error: "email cannot be empty" });
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (isActive !== undefined && typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive must be a boolean" });
  }

  if (email !== undefined) {
    const emailTaken = await prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" }, id: { not: existing.users.id } },
    });
    if (emailTaken) return res.status(409).json({ error: "An account with this email already exists" });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.users.id },
      data: {
        ...(typeof fullName === "string" ? { full_name: fullName.trim() } : {}),
        ...(typeof email === "string" ? { email: email.trim() } : {}),
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
