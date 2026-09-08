import { Request, Response } from "express";
import prisma from "../config/prisma";

const DEFAULT_CURRENCY_SYMBOL = "€";
const CODE_TO_SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
const toSymbol = (currency: string) => CODE_TO_SYMBOL[currency] ?? currency;

async function loadActivePlatformOrNull(platformId: string) {
  const platform = await prisma.platforms.findUnique({ where: { id: platformId } });
  if (!platform || !platform.is_active) return null;
  return platform;
}

export async function getPublicMenu(req: Request, res: Response) {
  const { platformId } = req.params;
  const platform = await loadActivePlatformOrNull(platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const [categories, dishes] = await Promise.all([
    prisma.menu_categories.findMany({
      where: { platform_id: platformId, is_active: true },
      orderBy: { name: "asc" },
    }),
    prisma.menu_items.findMany({
      where: { platform_id: platformId, is_available: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return res.status(200).json({ categories, dishes });
}

export async function getPublicTables(req: Request, res: Response) {
  const { platformId } = req.params;
  const platform = await loadActivePlatformOrNull(platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const tables = await prisma.tables.findMany({
    where: { platform_id: platformId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return res.status(200).json({ tables });
}

export async function getPublicSettings(req: Request, res: Response) {
  const { platformId } = req.params;
  const platform = await loadActivePlatformOrNull(platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const preferences = await prisma.platform_preferences.findUnique({
    where: { platform_id: platformId },
  });

  return res.status(200).json({
    settings: {
      name: platform.name,
      currency: toSymbol(preferences?.currency ?? DEFAULT_CURRENCY_SYMBOL),
      taxRate: preferences?.common_tax_rate ?? 0,
    },
  });
}

export async function createTableRequest(req: Request, res: Response) {
  const { platformId } = req.params;
  const platform = await loadActivePlatformOrNull(platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const { tableName, type } = req.body ?? {};
  if (typeof tableName !== "string" || !tableName.trim()) {
    return res.status(400).json({ error: "tableName is required" });
  }
  if (type !== "call_staff" && type !== "checkout") {
    return res.status(400).json({ error: "type must be call_staff or checkout" });
  }

  const table = await prisma.tables.findFirst({
    where: { platform_id: platformId, name: tableName.trim() },
  });
  if (!table) return res.status(400).json({ error: "Unknown table" });

  const existing = await prisma.table_requests.findFirst({
    where: { platform_id: platformId, table_id: table.id, type, status: "pending" },
  });
  if (existing) return res.status(200).json({ request: existing });

  const request = await prisma.table_requests.create({
    data: {
      platform_id: platformId,
      table_id: table.id,
      table_name: table.name,
      type,
      status: "pending",
    },
  });

  return res.status(201).json({ request });
}
