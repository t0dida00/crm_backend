import prisma from "../config/prisma";
import { emitToPlatform } from "../realtime/socket";

interface OrderLineInput {
  itemId: string;
  qty: number;
  note?: string;
}

export class OrderPlacementError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Every order placement creates its own distinct order — repeat rounds at the
 * same table do NOT merge into a prior open order. Placing an order still seats
 * the table if it isn't already. Shared by the staff-authenticated and
 * public/guest order endpoints — the caller has already established
 * `platformId` is valid.
 */
export async function placeOrderForTable(
  platformId: string,
  tableName: string,
  status: string,
  lines: OrderLineInput[],
) {
  if (typeof tableName !== "string" || !tableName.trim()) {
    throw new OrderPlacementError(400, "tableName is required");
  }
  if (typeof status !== "string" || !status.trim()) {
    throw new OrderPlacementError(400, "status is required");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new OrderPlacementError(400, "lines must be a non-empty array");
  }

  const table = await prisma.tables.findFirst({
    where: { platform_id: platformId, name: tableName.trim() },
  });

  // Every order belongs to the table's currently-open session — the first
  // order since the last checkout starts a new one. A partial unique index
  // (one_open_session_per_table) is the source of truth for that invariant;
  // on a rare concurrent-order race where two requests both try to open a
  // session, the loser's insert violates it and we just re-read the winner's row.
  let sessionId: string | null = null;
  if (table) {
    const openSession = await prisma.table_sessions.findFirst({
      where: { table_id: table.id, closed_at: null },
    });
    if (openSession) {
      sessionId = openSession.id;
    } else {
      try {
        const created = await prisma.table_sessions.create({
          data: { platform_id: platformId, table_id: table.id, table_name: table.name },
        });
        sessionId = created.id;
      } catch (err) {
        const isUniqueConflict =
          err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002";
        if (!isUniqueConflict) throw err;
        const winner = await prisma.table_sessions.findFirst({
          where: { table_id: table.id, closed_at: null },
        });
        sessionId = winner?.id ?? null;
      }
    }
  }

  const dishIds = lines.map((l) => l.itemId);
  const dishes = await prisma.menu_items.findMany({
    where: {
      id: { in: dishIds },
      platform_id: platformId,
      status: "valid",
      OR: [{ category_id: null }, { menu_categories: { is_active: true } }],
    },
  });
  const dishById = new Map(dishes.map((d) => [d.id, d]));

  const resolvedLines = lines
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
    throw new OrderPlacementError(400, "No valid order lines");
  }

  const total = resolvedLines.reduce((sum, l) => sum + Number(l.price) * l.qty, 0);

  // Snapshot the platform's current tax rate onto the order at creation time —
  // a later change in Settings must never alter how a past order displays.
  const preferences = await prisma.platform_preferences.findUnique({
    where: { platform_id: platformId },
  });
  const taxRate = preferences?.common_tax_rate ?? 0;

  // Order codes are sequential per platform but rows can be deleted, so a plain row
  // count can collide with a still-existing higher code — derive the next number from
  // the highest existing code instead, and retry on a rare concurrent-create race.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        const existingCodes = await tx.orders.findMany({
          where: { platform_id: platformId },
          select: { code: true },
        });
        const maxNumber = existingCodes.reduce((max, o) => {
          const n = Number(o.code.replace(/^ORD-/, ""));
          return Number.isFinite(n) && n > max ? n : max;
        }, 2400);

        if (table && table.state !== "Seated") {
          await tx.tables.update({
            where: { id: table.id },
            data: { state: "Seated", seated_at: new Date() },
          });
        }

        return tx.orders.create({
          data: {
            platform_id: platformId,
            table_id: table?.id ?? null,
            session_id: sessionId,
            table_name: tableName.trim(),
            code: `ORD-${maxNumber + 1}`,
            status: status.trim(),
            total,
            tax_rate: taxRate,
            order_lines: { create: resolvedLines },
          },
          include: { order_lines: true },
        });
      }, { timeout: 15000 });
      await emitToPlatform(platformId, "order:created", { order });
      return { order, created: true };
    } catch (err) {
      const isUniqueCodeConflict =
        err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002";
      if (!isUniqueCodeConflict || attempt === MAX_ATTEMPTS - 1) throw err;
    }
  }

  throw new OrderPlacementError(500, "Failed to place order");
}
