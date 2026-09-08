import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { signTableToken } from "../lib/table-token";
import { AuthedRequest } from "../middleware/auth.middleware";
import { emitToPlatform } from "../realtime/socket";

export async function listTables(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const tables = await prisma.tables.findMany({
    where: { platform_id: platformId },
    orderBy: { name: "asc" },
  });
  return res.status(200).json({ tables });
}

export async function listTableQrTokens(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const tables = await prisma.tables.findMany({
    where: { platform_id: platformId },
    orderBy: { name: "asc" },
  });

  const tokens = tables.map((t) => ({
    tableId: t.id,
    tableName: t.name,
    token: signTableToken(platformId, t.id),
  }));
  return res.status(200).json({ tokens });
}

export async function createTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { name, seats, zone } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof seats !== "number" || seats <= 0) {
    return res.status(400).json({ error: "seats must be a positive number" });
  }
  if (typeof zone !== "string" || !zone.trim()) {
    return res.status(400).json({ error: "zone is required" });
  }

  const table = await prisma.tables.create({
    data: { platform_id: platformId, name: name.trim(), seats, zone: zone.trim(), state: "Free" },
  });
  return res.status(201).json({ table });
}

export async function updateTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const { name, seats, zone } = req.body ?? {};
  const table = await prisma.tables.update({
    where: { id },
    data: {
      ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
      ...(typeof seats === "number" && seats > 0 ? { seats } : {}),
      ...(typeof zone === "string" && zone.trim() ? { zone: zone.trim() } : {}),
    },
  });
  return res.status(200).json({ table });
}

export async function deleteTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const [openOrder, activeBooking] = await Promise.all([
    prisma.orders.findFirst({ where: { table_id: id, closed_ts: null } }),
    prisma.bookings.findFirst({ where: { table_id: id } }),
  ]);
  if (openOrder || activeBooking) {
    return res.status(409).json({ error: "Table has an open order or active booking" });
  }

  await prisma.tables.delete({ where: { id } });
  return res.status(204).send();
}

export async function seatTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const table = await prisma.tables.update({
    where: { id },
    data: { state: "Seated", seated_at: new Date() },
  });
  emitToPlatform(platformId, "table:updated", { table });
  return res.status(200).json({ table });
}

export async function checkoutTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const table = await prisma.$transaction(async (tx) => {
    await tx.orders.updateMany({
      where: { table_id: id, closed_ts: null },
      data: { status: "Paid", closed_ts: new Date() },
    });
    return tx.tables.update({
      where: { id },
      data: { state: "Finished", seated_at: null },
    });
  });
  // updateMany doesn't return rows, and listeners (staff panels, the guest's
  // order-history view) only need to know this table's open orders are now
  // closed — not each order's full new state.
  emitToPlatform(platformId, "table:checked_out", { tableId: id, tableName: table.name });
  emitToPlatform(platformId, "table:updated", { table });
  return res.status(200).json({ table });
}

export async function freeTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const table = await prisma.$transaction(async (tx) => {
    await tx.bookings.updateMany({
      where: { table_id: id },
      data: { table_id: null },
    });
    return tx.tables.update({
      where: { id },
      data: { state: "Free", seated_at: null },
    });
  });
  emitToPlatform(platformId, "table:updated", { table });
  return res.status(200).json({ table });
}
