import { Response } from "express";
import prisma from "../config/prisma";
import { AuthedRequest } from "../middleware/auth.middleware";
import { emitToPlatform } from "../realtime/socket";

export async function getMyPlatform(req: AuthedRequest, res: Response) {
  const platformUser = await prisma.platform_users.findUnique({
    where: { user_id: req.userId },
    include: { platforms: { include: { platform_types: true } } },
  });

  if (!platformUser || !platformUser.is_active) {
    return res.status(404).json({ error: "No platform found for this user" });
  }

  return res.status(200).json({
    platform: platformUser.platforms,
    role: platformUser.role,
  });
}

export async function createPlatform(req: AuthedRequest, res: Response) {
  const { name, platformTypeCode, phone, email, address } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (typeof platformTypeCode !== "string" || !platformTypeCode.trim()) {
    return res.status(400).json({ error: "platformTypeCode is required" });
  }

  const existing = await prisma.platform_users.findUnique({
    where: { user_id: req.userId },
  });
  if (existing) {
    return res.status(409).json({ error: "User already belongs to a platform" });
  }

  const platformType = await prisma.platform_types.findUnique({
    where: { code: platformTypeCode.trim().toUpperCase() },
  });
  if (!platformType) {
    return res.status(400).json({ error: "Unknown platform type" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const platform = await tx.platforms.create({
      data: {
        platform_type_id: platformType.id,
        name: name.trim(),
        phone: phone || null,
        email: email || null,
        address: address || null,
      },
    });

    await tx.platform_users.create({
      data: {
        platform_id: platform.id,
        user_id: req.userId as string,
        role: "OWNER",
      },
    });

    return platform;
  });

  return res.status(201).json({ platform: result, role: "OWNER" });
}

export async function updateMyPlatform(req: AuthedRequest, res: Response) {
  const platformUser = await prisma.platform_users.findUnique({
    where: { user_id: req.userId },
  });
  if (!platformUser || !platformUser.is_active) {
    return res.status(404).json({ error: "No platform found for this user" });
  }

  const { name, phone, address } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name cannot be empty" });
  }

  const platform = await prisma.platforms.update({
    where: { id: platformUser.platform_id },
    data: {
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
      ...(typeof phone === "string" ? { phone: phone.trim() || null } : {}),
      ...(typeof address === "string" ? { address: address.trim() || null } : {}),
    },
  });

  await emitToPlatform(platform.id, "platform:updated", { platform });
  return res.status(200).json({ platform });
}
