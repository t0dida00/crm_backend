import { Response } from "express";
import { tenantDb } from "../config/tenant-db";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

/** The owner's order (sort_order), then name for categories that share a position. */
export const CATEGORY_ORDER = [{ sort_order: "asc" as const }, { name: "asc" as const }];

export async function listCategories(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const categories = await db.menu_categories.findMany({
    where: { platform_id: platformId },
    orderBy: CATEGORY_ORDER,
  });
  return res.status(200).json({ categories });
}

export async function createCategory(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  // A new category goes to the end of the menu.
  const last = await db.menu_categories.aggregate({
    where: { platform_id: platformId },
    _max: { sort_order: true },
  });
  const category = await db.menu_categories.create({
    data: { platform_id: platformId, name: name.trim(), sort_order: (last._max.sort_order ?? -1) + 1 },
  });
  return res.status(201).json({ category });
}

export async function updateCategory(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.menu_categories.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Category not found" });

  const { name, isActive } = req.body ?? {};
  const category = await db.menu_categories.update({
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
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.menu_categories.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Category not found" });

  // Dishes may be referenced by historical order_lines (NoAction FK), so soft-delete
  // them (status="hidden", category_id cleared) instead of a hard delete — mirrors
  // the dish DELETE endpoint and unblocks the category FK.
  await db.$transaction([
    db.menu_items.updateMany({
      where: { category_id: id },
      data: { status: "hidden", category_id: null },
    }),
    db.menu_categories.delete({ where: { id } }),
  ]);
  return res.status(204).send();
}

/**
 * Saves the menu's category order: `ids` lists every one of the business's
 * categories, first to last. A list that misses or repeats a category, or
 * names another business's, is refused so no category is lost from the order.
 */
export async function reorderCategories(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string") || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "ids must list each category once" });
  }
  const existing = await db.menu_categories.findMany({ where: { platform_id: platformId }, select: { id: true } });
  const known = new Set(existing.map((c) => c.id));
  if (ids.length !== known.size || !ids.every((id: string) => known.has(id))) {
    return res.status(400).json({ error: "ids must list every category of this business exactly once" });
  }

  await db.$transaction(
    ids.map((id: string, index: number) =>
      db.menu_categories.update({ where: { id }, data: { sort_order: index } }),
    ),
  );
  const categories = await db.menu_categories.findMany({ where: { platform_id: platformId }, orderBy: CATEGORY_ORDER });
  return res.status(200).json({ categories });
}
