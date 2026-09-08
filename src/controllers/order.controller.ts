import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { AuthedRequest } from "../middleware/auth.middleware";

export async function listOrders(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { open } = req.query;
  const orders = await prisma.orders.findMany({
    where: {
      platform_id: platformId,
      ...(open === "true" ? { closed_ts: null } : {}),
    },
    include: { order_lines: true },
    orderBy: { ts: "desc" },
  });
  return res.status(200).json({ orders });
}

export async function getOrder(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const order = await prisma.orders.findFirst({
    where: { id, platform_id: platformId },
    include: { order_lines: true },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  return res.status(200).json({ order });
}

interface OrderLineInput {
  itemId: string;
  qty: number;
  note?: string;
}

export async function createOrder(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { tableName, status, lines } = req.body ?? {};
  if (typeof tableName !== "string" || !tableName.trim()) {
    return res.status(400).json({ error: "tableName is required" });
  }
  if (typeof status !== "string" || !status.trim()) {
    return res.status(400).json({ error: "status is required" });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "lines must be a non-empty array" });
  }

  const table = await prisma.tables.findFirst({
    where: { platform_id: platformId, name: tableName.trim() },
  });

  const dishIds = (lines as OrderLineInput[]).map((l) => l.itemId);
  const dishes = await prisma.menu_items.findMany({
    where: { id: { in: dishIds }, platform_id: platformId },
  });
  const dishById = new Map(dishes.map((d) => [d.id, d]));

  const resolvedLines = (lines as OrderLineInput[])
    .map((line) => {
      const dish = dishById.get(line.itemId);
      if (!dish || typeof line.qty !== "number" || line.qty <= 0) return null;
      return {
        item_id: dish.id,
        name: dish.name,
        price: dish.price,
        qty: line.qty,
        note: typeof line.note === "string" ? line.note : null,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (resolvedLines.length === 0) {
    return res.status(400).json({ error: "No valid order lines" });
  }

  const total = resolvedLines.reduce((sum, l) => sum + Number(l.price) * l.qty, 0);

  // Order codes are sequential per platform but rows can be deleted, so a plain row
  // count can collide with a still-existing higher code — derive the next number from
  // the highest existing code instead, and retry on a rare concurrent-create race.
  const MAX_ATTEMPTS = 5;
  let order;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      order = await prisma.$transaction(async (tx) => {
        const existingCodes = await tx.orders.findMany({
          where: { platform_id: platformId },
          select: { code: true },
        });
        const maxNumber = existingCodes.reduce((max, o) => {
          const n = Number(o.code.replace(/^ORD-/, ""));
          return Number.isFinite(n) && n > max ? n : max;
        }, 2400);

        return tx.orders.create({
          data: {
            platform_id: platformId,
            table_id: table?.id ?? null,
            table_name: tableName.trim(),
            code: `ORD-${maxNumber + 1}`,
            status: status.trim(),
            total,
            order_lines: { create: resolvedLines },
          },
          include: { order_lines: true },
        });
      });
      break;
    } catch (err) {
      const isUniqueCodeConflict =
        err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002";
      if (!isUniqueCodeConflict || attempt === MAX_ATTEMPTS - 1) throw err;
    }
  }

  return res.status(201).json({ order });
}

export async function updateOrderStatus(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.orders.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  const { status } = req.body ?? {};
  if (typeof status !== "string" || !status.trim()) {
    return res.status(400).json({ error: "status is required" });
  }
  const trimmedStatus = status.trim();

  const order = await prisma.orders.update({
    where: { id },
    data: {
      status: trimmedStatus,
      // "Paid" is the terminal status in every domain flow (restaurant/cafe) — closing
      // the order here means reaching it via the Orders panel's advance button alone
      // (without a separate table checkout) still moves it into history correctly.
      ...(trimmedStatus === "Paid" && !existing.closed_ts ? { closed_ts: new Date() } : {}),
    },
    include: { order_lines: true },
  });
  return res.status(200).json({ order });
}

export async function addOrderLine(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.orders.findFirst({
    where: { id, platform_id: platformId },
    include: { order_lines: true },
  });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  const { itemId } = req.body ?? {};
  if (typeof itemId !== "string") {
    return res.status(400).json({ error: "itemId is required" });
  }
  const dish = await prisma.menu_items.findFirst({ where: { id: itemId, platform_id: platformId } });
  if (!dish) return res.status(400).json({ error: "Unknown dish" });

  const order = await prisma.$transaction(async (tx) => {
    const existingLine = existing.order_lines.find((l) => l.item_id === itemId);
    if (existingLine) {
      await tx.order_lines.update({
        where: { id: existingLine.id },
        data: { qty: existingLine.qty + 1 },
      });
    } else {
      await tx.order_lines.create({
        data: { order_id: id, item_id: dish.id, name: dish.name, price: dish.price, qty: 1 },
      });
    }
    const lines = await tx.order_lines.findMany({ where: { order_id: id } });
    const total = lines.reduce((sum, l) => sum + Number(l.price) * l.qty, 0);
    return tx.orders.update({
      where: { id },
      data: { total },
      include: { order_lines: true },
    });
  });

  return res.status(200).json({ order });
}

export async function setOrderLineQty(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id, lineId } = req.params;
  const order = await prisma.orders.findFirst({ where: { id, platform_id: platformId } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const line = await prisma.order_lines.findFirst({ where: { id: lineId, order_id: id } });
  if (!line) return res.status(404).json({ error: "Order line not found" });

  const { qty } = req.body ?? {};
  if (typeof qty !== "number") {
    return res.status(400).json({ error: "qty is required" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (qty <= 0) {
      await tx.order_lines.delete({ where: { id: lineId } });
    } else {
      await tx.order_lines.update({ where: { id: lineId }, data: { qty } });
    }
    const lines = await tx.order_lines.findMany({ where: { order_id: id } });
    const total = lines.reduce((sum, l) => sum + Number(l.price) * l.qty, 0);
    return tx.orders.update({
      where: { id },
      data: { total },
      include: { order_lines: true },
    });
  });

  return res.status(200).json({ order: updated });
}

export async function deleteOrder(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { id } = req.params;
  const existing = await prisma.orders.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  await prisma.orders.delete({ where: { id } });
  return res.status(204).send();
}
