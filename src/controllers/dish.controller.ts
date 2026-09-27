import { Response } from "express";
import { DishStatus } from "@prisma/client";
import { tenantDb } from "../config/tenant-db";
import { resolvePlatformId, resolvePlatformMembership } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";
import { isNonNegative, MAX_SPECIAL_TAX } from "../lib/validation";

const DISH_STATUSES = Object.values(DishStatus);
const isDishStatus = (v: unknown): v is DishStatus =>
  typeof v === "string" && (DISH_STATUSES as string[]).includes(v);

export async function listDishes(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { categoryId } = req.query;
  const dishes = await db.menu_items.findMany({
    where: {
      platform_id: platformId,
      ...(typeof categoryId === "string" ? { category_id: categoryId } : {}),
    },
    orderBy: { name: "asc" },
  });
  return res.status(200).json({ dishes });
}

export async function createDish(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { name, price, categoryId, description, taxMode, taxName, taxPct, imageUrl, isVegan, status } =
    req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!isNonNegative(price)) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }
  if (typeof categoryId !== "string" || !categoryId) {
    return res.status(400).json({ error: "category is required" });
  }
  if (!(await db.menu_categories.findFirst({ where: { id: categoryId, platform_id: platformId } }))) {
    return res.status(400).json({ error: "Unknown category" });
  }
  if (taxPct !== undefined && taxPct !== null && (!isNonNegative(taxPct) || taxPct > MAX_SPECIAL_TAX)) {
    return res.status(400).json({ error: `taxPct must be between 0 and ${MAX_SPECIAL_TAX}` });
  }
  if (status !== undefined && !isDishStatus(status)) {
    return res.status(400).json({ error: "status must be one of valid, sold_out, hidden" });
  }

  const dish = await db.menu_items.create({
    data: {
      platform_id: platformId,
      category_id: categoryId,
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      price,
      tax_mode: typeof taxMode === "string" ? taxMode : "none",
      tax_name: typeof taxName === "string" ? taxName : null,
      tax_pct: typeof taxPct === "number" ? taxPct : null,
      image_url: typeof imageUrl === "string" ? imageUrl : null,
      is_vegan: Boolean(isVegan),
      ...(isDishStatus(status) ? { status } : {}),
    },
  });
  return res.status(201).json({ dish });
}

export async function updateDish(req: AuthedRequest, res: Response) {
  const membership = await resolvePlatformMembership(req.userId as string);
  if (!membership) return res.status(404).json({ error: "No platform found for this user" });
  const { platformId } = membership;
  const db = await tenantDb(platformId);
  // Staff only mark a dish available / sold out / hidden: everything else they
  // send (price, name, tax...) is ignored, even from a direct API call.
  const body = membership.role === "OWNER" ? (req.body ?? {}) : { status: req.body?.status };

  const { id } = req.params;
  const existing = await db.menu_items.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Dish not found" });

  const {
    name,
    price,
    categoryId,
    description,
    taxMode,
    taxName,
    taxPct,
    imageUrl,
    isVegan,
    status,
  } = body;

  if (status !== undefined && !isDishStatus(status)) {
    return res.status(400).json({ error: "status must be one of valid, sold_out, hidden" });
  }
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name cannot be empty" });
  }
  if (price !== undefined && !isNonNegative(price)) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }
  // Category is mandatory: it can be changed but not removed.
  if (categoryId !== undefined) {
    if (typeof categoryId !== "string" || !categoryId) {
      return res.status(400).json({ error: "category is required" });
    }
    if (!(await db.menu_categories.findFirst({ where: { id: categoryId, platform_id: platformId } }))) {
      return res.status(400).json({ error: "Unknown category" });
    }
  }
  if (taxPct !== undefined && taxPct !== null && (!isNonNegative(taxPct) || taxPct > MAX_SPECIAL_TAX)) {
    return res.status(400).json({ error: `taxPct must be between 0 and ${MAX_SPECIAL_TAX}` });
  }

  const dish = await db.menu_items.update({
    where: { id },
    data: {
      ...(typeof name === "string" ? { name: name.trim() } : {}),
      ...(typeof price === "number" ? { price } : {}),
      ...(typeof categoryId === "string" ? { category_id: categoryId } : {}),
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof taxMode === "string" ? { tax_mode: taxMode } : {}),
      ...(taxName === null || typeof taxName === "string" ? { tax_name: taxName } : {}),
      ...(taxPct === null || typeof taxPct === "number" ? { tax_pct: taxPct } : {}),
      ...(typeof imageUrl === "string" ? { image_url: imageUrl } : {}),
      ...(typeof isVegan === "boolean" ? { is_vegan: isVegan } : {}),
      ...(isDishStatus(status) ? { status } : {}),
    },
  });
  return res.status(200).json({ dish });
}

export async function deleteDish(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.menu_items.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Dish not found" });

  await db.menu_items.update({ where: { id }, data: { status: "hidden" } });
  return res.status(204).send();
}
