import { Request, Response } from "express";
import prisma from "../config/prisma";
import { OrderPlacementError, placeOrderForTable } from "../lib/order-placement";
import { verifyTableToken } from "../lib/table-token";
import { emitToPlatform } from "../realtime/socket";

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
      address: platform.address,
      phone: platform.phone,
      currency: toSymbol(preferences?.currency ?? DEFAULT_CURRENCY_SYMBOL),
      taxRate: preferences?.common_tax_rate ?? 0,
    },
  });
}

export async function resolveTableQrToken(req: Request, res: Response) {
  const { token } = req.params;
  const payload = verifyTableToken(token);
  if (!payload) return res.status(404).json({ error: "Invalid or unrecognized QR code" });

  const platform = await loadActivePlatformOrNull(payload.platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const table = await prisma.tables.findFirst({
    where: { id: payload.tableId, platform_id: payload.platformId },
    select: { id: true, name: true },
  });
  if (!table) return res.status(404).json({ error: "Table not found" });

  return res.status(200).json({
    platformId: payload.platformId,
    tableId: table.id,
    tableName: table.name,
  });
}

export async function getPublicTableOrders(req: Request, res: Response) {
  const { platformId } = req.params;
  const platform = await loadActivePlatformOrNull(platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const { table: tableName } = req.query;
  if (typeof tableName !== "string" || !tableName.trim()) {
    return res.status(400).json({ error: "table is required" });
  }

  const table = await prisma.tables.findFirst({
    where: { platform_id: platformId, name: tableName.trim() },
  });
  if (!table) return res.status(200).json({ orders: [] });

  // Only orders still open for this table — once staff checks out, closed_ts is
  // set and the order stops being visible here, so a newly-seated guest never
  // sees what a previous party at the same table ordered.
  const orders = await prisma.orders.findMany({
    where: { platform_id: platformId, table_id: table.id, closed_ts: null },
    include: { order_lines: true },
    orderBy: { ts: "desc" },
  });

  return res.status(200).json({ orders });
}

export async function createPublicOrder(req: Request, res: Response) {
  const { platformId } = req.params;
  const platform = await loadActivePlatformOrNull(platformId);
  if (!platform) return res.status(404).json({ error: "Platform not found" });

  const { tableName, lines } = req.body ?? {};
  try {
    // Status is always the flow's first step here — a guest can't set it directly,
    // only staff (via the authenticated endpoint) can move an order along the flow.
    const { order, created } = await placeOrderForTable(platformId, tableName, "New", lines ?? []);
    return res.status(created ? 201 : 200).json({ order });
  } catch (err) {
    if (err instanceof OrderPlacementError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
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

  emitToPlatform(platformId, "table_request:created", { request });
  return res.status(201).json({ request });
}
