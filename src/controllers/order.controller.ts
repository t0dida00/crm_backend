import { Response } from "express";
import prisma from "../config/prisma";
import { resolvePlatformId } from "../lib/platform-context";
import { OrderPlacementError, placeOrderForTable } from "../lib/order-placement";
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

export async function createOrder(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });

  const { tableName, status, lines } = req.body ?? {};
  try {
    const { order, created } = await placeOrderForTable(platformId, tableName, status, lines ?? []);
    return res.status(created ? 201 : 200).json({ order });
  } catch (err) {
    if (err instanceof OrderPlacementError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
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
