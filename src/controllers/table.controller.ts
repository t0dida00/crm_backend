import { Response } from "express";
import { isCount } from "../lib/validation";
import { tenantDb } from "../config/tenant-db";
import { resolvePlatformId } from "../lib/platform-context";
import { signTableToken } from "../lib/table-token";
import { AuthedRequest } from "../middleware/auth.middleware";
import { emitToPlatform } from "../realtime/socket";

export async function listTables(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const tables = await db.tables.findMany({
    where: { platform_id: platformId },
    orderBy: { name: "asc" },
  });
  return res.status(200).json({ tables });
}

export async function listTableQrTokens(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const tables = await db.tables.findMany({
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
  const db = await tenantDb(platformId);

  const { name, seats, zone } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!isCount(seats)) {
    return res.status(400).json({ error: "seats must be a whole number from 1" });
  }
  // Zone is optional; a table without one is stored with an empty zone.
  if (zone !== undefined && typeof zone !== "string") {
    return res.status(400).json({ error: "zone must be text" });
  }

  const table = await db.tables.create({
    data: { platform_id: platformId, name: name.trim(), seats, zone: (zone ?? "").trim(), state: "Free" },
  });
  return res.status(201).json({ table });
}

export async function updateTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const { name, seats, zone } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name cannot be empty" });
  }
  if (seats !== undefined && !isCount(seats)) {
    return res.status(400).json({ error: "seats must be a whole number from 1" });
  }
  if (zone !== undefined && typeof zone !== "string") {
    return res.status(400).json({ error: "zone must be text" });
  }
  const table = await db.tables.update({
    where: { id },
    data: {
      ...(typeof name === "string" ? { name: name.trim() } : {}),
      ...(typeof seats === "number" ? { seats } : {}),
      ...(typeof zone === "string" ? { zone: zone.trim() } : {}),
    },
  });
  return res.status(200).json({ table });
}

export async function deleteTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const [openOrder, activeBooking] = await Promise.all([
    db.orders.findFirst({ where: { table_id: id, closed_ts: null } }),
    db.bookings.findFirst({ where: { table_id: id } }),
  ]);
  if (openOrder || activeBooking) {
    return res.status(409).json({ error: "Table has an open order or active booking" });
  }

  await db.tables.delete({ where: { id } });
  return res.status(204).send();
}

export async function seatTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const table = await db.tables.update({
    where: { id },
    data: { state: "Seated", seated_at: new Date() },
  });
  await emitToPlatform(platformId, "table:updated", { table });
  return res.status(200).json({ table });
}

export async function checkoutTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const table = await db.$transaction(async (tx) => {
    const closedAt = new Date();
    await tx.orders.updateMany({
      where: { table_id: id, closed_ts: null },
      data: { status: "Paid", closed_ts: closedAt },
    });
    // Closing the session is what actually ends this dining party — the next
    // order placed at this table (once it's re-seated) opens a fresh one.
    await tx.table_sessions.updateMany({
      where: { table_id: id, closed_at: null },
      data: { closed_at: closedAt },
    });
    return tx.tables.update({
      where: { id },
      data: { state: "Finished", seated_at: null },
    });
  }, { timeout: 15000 });
  // updateMany doesn't return rows, and listeners (staff panels, the guest's
  // order-history view) only need to know this table's open orders are now
  // closed — not each order's full new state.
  await emitToPlatform(platformId, "table:checked_out", { tableId: id, tableName: table.name });
  await emitToPlatform(platformId, "table:updated", { table });
  return res.status(200).json({ table });
}

export async function freeTable(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.tables.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const table = await db.$transaction(async (tx) => {
    await tx.bookings.updateMany({
      where: { table_id: id },
      data: { table_id: null },
    });
    return tx.tables.update({
      where: { id },
      data: { state: "Free", seated_at: null },
    });
  });
  await emitToPlatform(platformId, "table:updated", { table });
  return res.status(200).json({ table });
}
