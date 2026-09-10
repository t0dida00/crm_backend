import { Response } from "express";
import { DishStatus } from "@prisma/client";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

const DISH_STATUSES = Object.values(DishStatus);
const isDishStatus = (v: unknown): v is DishStatus =>
  typeof v === "string" && (DISH_STATUSES as string[]).includes(v);

export async function listDishes(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { categoryId } = req.query;
  const dishes = await prisma.menu_items.findMany({
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

  const { name, price, categoryId, description, taxMode, taxName, taxPct, imageUrl, isVegan, status } =
    req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof price !== "number" || price < 0) {
    return res.status(400).json({ error: "price must be a non-negative number" });
  }
  if (status !== undefined && !isDishStatus(status)) {
    return res.status(400).json({ error: "status must be one of valid, sold_out, hidden" });
  }

  const dish = await prisma.menu_items.create({
    data: {
      platform_id: platformId,
      category_id: typeof categoryId === "string" ? categoryId : null,
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
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.menu_items.findFirst({ where: { id, platform_id: platformId } });
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
  } = req.body ?? {};

  if (status !== undefined && !isDishStatus(status)) {
    return res.status(400).json({ error: "status must be one of valid, sold_out, hidden" });
  }

  const dish = await prisma.menu_items.update({
    where: { id },
    data: {
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
      ...(typeof price === "number" && price >= 0 ? { price } : {}),
      ...(categoryId === null || typeof categoryId === "string" ? { category_id: categoryId } : {}),
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

  const { id } = req.params;
  const existing = await prisma.menu_items.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Dish not found" });

  await prisma.menu_items.update({ where: { id }, data: { status: "hidden" } });
  return res.status(204).send();
}
