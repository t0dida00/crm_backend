import { Response } from "express";
import { Prisma } from "@prisma/client";
import { tenantDb } from "../config/tenant-db";
import { resolvePlatformId } from "../lib/platform-context";
import { OrderPlacementError, placeOrderForTable } from "../lib/order-placement";
import { AuthedRequest } from "../middleware/auth.middleware";
import { emitToPlatform } from "../realtime/socket";

// Closed orders only grow, so the unfiltered list returns every open order but
// just the most recently closed ones — loading a platform's whole history (with
// lines) in one response can exceed Node's max string size and crash the server.
const HISTORY_LIMIT = 500;

export async function listOrders(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const openOrders = await db.orders.findMany({
    where: { platform_id: platformId, closed_ts: null },
    include: { order_lines: true },
    orderBy: { ts: "desc" },
  });
  if (req.query.open === "true") return res.status(200).json({ orders: openOrders });

  const closedOrders = await db.orders.findMany({
    where: { platform_id: platformId, closed_ts: { not: null } },
    include: { order_lines: true },
    orderBy: { closed_ts: "desc" },
    take: HISTORY_LIMIT,
  });
  return res.status(200).json({ orders: [...openOrders, ...closedOrders] });
}

const MAX_PAGE_SIZE = 100;

function parsePositiveInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parses an epoch-ms query param into a Date, or null if absent/invalid. */
function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Paginated order history, one entry per session — the same grouping the UI
 * uses: closed orders collapse by `session_id` (or stand alone when they have
 * none), and with `status=all` each open order is its own entry too. Entries are
 * sorted newest first by their latest order `ts`; `q` matches order code or table
 * name; `from` (epoch ms) keeps only orders checked out since then (open orders,
 * with `status=all`, by when they were placed). Paging happens in SQL so a platform's history never loads in full.
 */
export async function listOrderHistory(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(parsePositiveInt(req.query.pageSize, 20), MAX_PAGE_SIZE);
  const includeOpen = req.query.status === "all";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const from = parseTimestamp(req.query.from);

  const sessionKey = Prisma.sql`CASE WHEN closed_ts IS NULL THEN id ELSE COALESCE(session_id, id) END`;
  const filters = Prisma.join(
    [
      Prisma.sql`platform_id = ${platformId}::uuid`,
      ...(includeOpen ? [] : [Prisma.sql`closed_ts IS NOT NULL`]),
      ...(q ? [Prisma.sql`(code ILIKE ${pattern} OR table_name ILIKE ${pattern})`] : []),
      ...(from
        ? [includeOpen ? Prisma.sql`COALESCE(closed_ts, ts) >= ${from}` : Prisma.sql`closed_ts >= ${from}`]
        : []),
    ],
    " AND ",
  );

  const [rows, countRows] = await Promise.all([
    db.$queryRaw<{ key: string }[]>`
      SELECT ${sessionKey} AS key
      FROM orders WHERE ${filters}
      GROUP BY 1
      ORDER BY MAX(ts) DESC, 1
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `,
    db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT ${sessionKey}) AS total FROM orders WHERE ${filters}
    `,
  ]);
  const keys = rows.map((r) => r.key);

  const orders = keys.length
    ? await db.orders.findMany({
        where: {
          platform_id: platformId,
          OR: [{ id: { in: keys } }, { session_id: { in: keys }, closed_ts: { not: null } }],
        },
        include: { order_lines: true },
        orderBy: { ts: "desc" },
      })
    : [];

  const byKey = new Map<string, typeof orders>(keys.map((k) => [k, []]));
  for (const order of orders) {
    const key = order.closed_ts ? (order.session_id ?? order.id) : order.id;
    byKey.get(key)?.push(order);
  }

  return res.status(200).json({
    sessions: keys.map((k) => byKey.get(k) ?? []).filter((s) => s.length > 0),
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  });
}

/**
 * Dashboard figures for orders placed (`ts`) within [from, to] — counts, takings
 * and bestsellers are aggregated in SQL rather than over a client-side order
 * list, which only holds recent history.
 */
export async function getOrderStats(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const from = parseTimestamp(req.query.from);
  const to = parseTimestamp(req.query.to);
  const where = {
    platform_id: platformId,
    ...(from || to ? { ts: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const lineFilters = Prisma.join(
    [
      Prisma.sql`o.platform_id = ${platformId}::uuid`,
      ...(from ? [Prisma.sql`o.ts >= ${from}`] : []),
      ...(to ? [Prisma.sql`o.ts <= ${to}`] : []),
    ],
    " AND ",
  );

  const [totals, recent, bestsellers, oldest] = await Promise.all([
    db.orders.aggregate({ where, _count: { _all: true }, _sum: { total: true } }),
    db.orders.findMany({ where, include: { order_lines: true }, orderBy: { ts: "desc" }, take: 8 }),
    db.$queryRaw<{ item_id: string; name: string; qty: bigint; takings: Prisma.Decimal }[]>`
      SELECT l.item_id, MAX(l.name) AS name, SUM(l.qty) AS qty, SUM(l.qty * l.price) AS takings
      FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE ${lineFilters}
      GROUP BY l.item_id
      ORDER BY qty DESC
      LIMIT 10
    `,
    db.orders.findFirst({ where: { platform_id: platformId }, orderBy: { ts: "asc" }, select: { ts: true } }),
  ]);

  return res.status(200).json({
    orderCount: totals._count._all,
    takings: Number(totals._sum.total ?? 0),
    recent,
    bestsellers: bestsellers.map((b) => ({
      itemId: b.item_id,
      name: b.name,
      qty: Number(b.qty),
      takings: Number(b.takings),
    })),
    oldestTs: oldest?.ts ?? null,
  });
}

const SERIES_BUCKETS = new Set(["hour", "day", "month", "year"]);
function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Orders and takings per hour/day/month/year for the dashboard chart. Buckets are
 * computed in the caller's time zone (`tz`, IANA name) so "9:00" or "Mon" match
 * the viewer's clock; each bucket key is a local timestamp truncated to the
 * bucket, formatted `YYYY-MM-DDTHH`. Empty buckets are omitted.
 */
export async function getOrderSeries(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const bucket = typeof req.query.bucket === "string" ? req.query.bucket : "";
  if (!SERIES_BUCKETS.has(bucket)) {
    return res.status(400).json({ error: "bucket must be one of hour, day, month, year" });
  }
  const tz = typeof req.query.tz === "string" && req.query.tz ? req.query.tz : "UTC";
  if (!isTimeZone(tz)) return res.status(400).json({ error: "Unknown time zone" });
  const from = parseTimestamp(req.query.from);
  const to = parseTimestamp(req.query.to);
  if (!from || !to) return res.status(400).json({ error: "from and to are required" });

  const rows = await db.$queryRaw<{ bucket: string; orders: bigint; takings: Prisma.Decimal }[]>`
    SELECT to_char(date_trunc(${bucket}, ts AT TIME ZONE ${tz}), 'YYYY-MM-DD"T"HH24') AS bucket,
           COUNT(*) AS orders,
           COALESCE(SUM(total), 0) AS takings
    FROM orders
    WHERE platform_id = ${platformId}::uuid AND ts >= ${from} AND ts <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;

  return res.status(200).json({
    series: rows.map((r) => ({ bucket: r.bucket, orders: Number(r.orders), takings: Number(r.takings) })),
  });
}

export async function getOrder(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const order = await db.orders.findFirst({
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
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.orders.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  const { status } = req.body ?? {};
  if (typeof status !== "string" || !status.trim()) {
    return res.status(400).json({ error: "status is required" });
  }
  const trimmedStatus = status.trim();

  const order = await db.orders.update({
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
  await emitToPlatform(platformId, "order:updated", { order });
  return res.status(200).json({ order });
}

export async function addOrderLine(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.orders.findFirst({
    where: { id, platform_id: platformId },
    include: { order_lines: true },
  });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  const { itemId } = req.body ?? {};
  if (typeof itemId !== "string") {
    return res.status(400).json({ error: "itemId is required" });
  }
  const dish = await db.menu_items.findFirst({ where: { id: itemId, platform_id: platformId } });
  if (!dish) return res.status(400).json({ error: "Unknown dish" });

  const order = await db.$transaction(async (tx) => {
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

  await emitToPlatform(platformId, "order:updated", { order });
  return res.status(200).json({ order });
}

export async function setOrderLineQty(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id, lineId } = req.params;
  const order = await db.orders.findFirst({ where: { id, platform_id: platformId } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const line = await db.order_lines.findFirst({ where: { id: lineId, order_id: id } });
  if (!line) return res.status(404).json({ error: "Order line not found" });

  const { qty } = req.body ?? {};
  if (typeof qty !== "number") {
    return res.status(400).json({ error: "qty is required" });
  }

  const updated = await db.$transaction(async (tx) => {
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

  await emitToPlatform(platformId, "order:updated", { order: updated });
  return res.status(200).json({ order: updated });
}

export async function deleteOrder(req: AuthedRequest, res: Response) {
  const platformId = await resolvePlatformId(req.userId as string);
  if (!platformId) return res.status(404).json({ error: "No platform found for this user" });
  const db = await tenantDb(platformId);

  const { id } = req.params;
  const existing = await db.orders.findFirst({ where: { id, platform_id: platformId } });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  await db.orders.delete({ where: { id } });
  await emitToPlatform(platformId, "order:deleted", { id });
  return res.status(204).send();
}
