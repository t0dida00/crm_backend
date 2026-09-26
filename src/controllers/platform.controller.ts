import { Response } from "express";
import prisma from "../config/prisma";
import { AuthedRequest } from "../middleware/auth.middleware";
import { emitToPlatform } from "../realtime/socket";
import { publicPusherConfig } from "../lib/platform-connections";
import { findMembership } from "../lib/accounts";
import { readProfile } from "../lib/business-profile";
import { tenantDb } from "../config/tenant-db";

export async function getMyPlatform(req: AuthedRequest, res: Response) {
  // Owners are in the central database; staff may be in their business's own.
  const membership = await findMembership(req.userId as string);
  if (!membership || !membership.isActive) {
    return res.status(404).json({ error: "No platform found for this user" });
  }

  const platform = await prisma.platforms.findUniqueOrThrow({
    where: { id: membership.platformId },
    include: { platform_types: true },
  });
  const [profile, pusher] = await Promise.all([
    readProfile(membership.platformId),
    publicPusherConfig(membership.platformId),
  ]);

  return res.status(200).json({ platform: { ...platform, ...profile }, role: membership.role, pusher });
}

export async function createPlatform(req: AuthedRequest, res: Response) {
  const { name, platformTypeCode, phone, email, address, logoUrl } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Name is required" });
  }
  if (typeof platformTypeCode !== "string" || !platformTypeCode.trim()) {
    return res.status(400).json({ error: "platformTypeCode is required" });
  }

  if (await findMembership(req.userId as string)) {
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
        logo_url: logoUrl || null,
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
  const membership = await findMembership(req.userId as string);
  if (!membership || !membership.isActive) {
    return res.status(404).json({ error: "No platform found for this user" });
  }
  const platformId = membership.platformId;

  const { name, phone, email, address, logoUrl, platformTypeCode } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name cannot be empty" });
  }
  // Setup's "Back" lets a new owner change restaurant/cafe after creating the business.
  let platformTypeId: string | undefined;
  if (platformTypeCode !== undefined) {
    const type =
      typeof platformTypeCode === "string"
        ? await prisma.platform_types.findUnique({ where: { code: platformTypeCode.trim().toUpperCase() } })
        : null;
    if (!type) return res.status(400).json({ error: "Unknown platform type" });
    platformTypeId = type.id;
  }

  const identity = {
    ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
    ...(platformTypeId ? { platform_type_id: platformTypeId } : {}),
  };
  const profileChanges = {
    ...(typeof phone === "string" ? { phone: phone.trim() || null } : {}),
    ...(typeof email === "string" ? { email: email.trim() || null } : {}),
    ...(typeof address === "string" ? { address: address.trim() || null } : {}),
    ...(typeof logoUrl === "string" ? { logo_url: logoUrl.trim() || null } : {}),
  };

  // Name and type stay central (they find the business); the profile goes
  // wherever the business's data lives (the same row when that's central).
  const db = await tenantDb(platformId);
  const central = await prisma.platforms.update({
    where: { id: platformId },
    data: db === prisma ? { ...identity, ...profileChanges } : identity,
    include: { platform_types: true },
  });
  if (db !== prisma) {
    await readProfile(platformId); // moves any profile still left centrally
    await db.platforms.update({
      where: { id: platformId },
      data: { ...(identity.name ? { name: identity.name } : {}), ...profileChanges },
    });
  }
  const platform = { ...central, ...(await readProfile(platformId)) };

  await emitToPlatform(platform.id, "platform:updated", { platform });
  return res.status(200).json({ platform });
}
