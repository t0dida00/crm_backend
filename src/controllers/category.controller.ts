import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

export async function listCategories(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const categories = await prisma.menu_categories.findMany({
    where: { platform_id: platformId },
    orderBy: { name: "asc" },
  });
  return res.status(200).json({ categories });
}

export async function createCategory(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const category = await prisma.menu_categories.create({
    data: { platform_id: platformId, name: name.trim() },
  });
  return res.status(201).json({ category });
}

export async function updateCategory(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.menu_categories.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Category not found" });

  const { name, isActive } = req.body ?? {};
  const category = await prisma.menu_categories.update({
    where: { id },
    data: {
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
      ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
    },
  });
  return res.status(200).json({ category });
}

export async function deleteCategory(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.menu_categories.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Category not found" });

  // Dishes may be referenced by historical order_lines (NoAction FK), so soft-delete
  // them (is_available=false, category_id cleared) instead of a hard delete — mirrors
  // the dish DELETE endpoint and unblocks the category FK.
  await prisma.$transaction([
    prisma.menu_items.updateMany({
      where: { category_id: id },
      data: { is_available: false, category_id: null },
    }),
    prisma.menu_categories.delete({ where: { id } }),
  ]);
  return res.status(204).send();
}
